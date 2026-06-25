import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  Inject,
  Logger,
} from '@nestjs/common';
import {
  NeedLogin,
  CanRole,
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response } from 'express';
import { existsSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import { docs } from '@server/database/schema';
import { count } from 'drizzle-orm';
import { SystemConfigService } from '../system-config/system-config.service';
import type { PreviewStatusResponse } from '@shared/api.interface';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

@Controller('api/preview/help-center')
export class PreviewController {
  private readonly logger = new Logger(PreviewController.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private async getPreviewDir(): Promise<string> {
    const config = await this.systemConfigService.getConfig();
    const stagingDeployDir = config.stagingDeployDir || '/home/workspace/staging-deploy';
    return path.join(stagingDeployDir, 'api-preview');
  }

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Get('status')
  async getStatus(): Promise<PreviewStatusResponse> {
    const previewDir = await this.getPreviewDir();
    const indexFile = path.join(previewDir, 'index.html');
    const deployed = existsSync(indexFile);

    const docCountResult = await this.db
      .select({ count: count() })
      .from(docs);
    const docCount = parseInt(String(docCountResult[0]?.count ?? '0'), 10);

    let updatedAt: string | null = null;
    if (deployed) {
      try {
        const stat = statSync(indexFile);
        updatedAt = stat.mtime.toISOString();
      } catch {
        updatedAt = null;
      }
    }

    return {
      deployed,
      docCount,
      previewUrl: '/api/preview/help-center/',
      updatedAt,
    };
  }

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Get('render/:path(*)')
  async renderWithAssets(
    @Param('path') filePath: string,
    @Req() req: Request,
  ): Promise<{ html: string }> {
    const previewDir = await this.getPreviewDir();
    if (!existsSync(previewDir)) {
      return { html: '<html><body><h3>预览环境尚未部署，请先生成草稿预览</h3></body></html>' };
    }
    const normalized = filePath || 'index.html';
    let resolved = path.resolve(previewDir, normalized);
    if (!resolved.startsWith(previewDir)) {
      return { html: '<html><body><h3>Forbidden</h3></body></html>' };
    }
    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      resolved = path.join(resolved, 'index.html');
    } else if (!resolved.endsWith('.html') && !existsSync(resolved)) {
      const withHtml = resolved + '.html';
      if (existsSync(withHtml)) resolved = withHtml;
    }
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      const rootIndex = path.join(previewDir, 'index.html');
      const introIndex = path.join(previewDir, 'docs', 'intro', 'index.html');
      if (existsSync(rootIndex)) {
        resolved = rootIndex;
      } else if (existsSync(introIndex)) {
        resolved = introIndex;
      } else {
        return { html: '<html><body><h3>Not found</h3></body></html>' };
      }
    }
    const rawHtml = readFileSync(resolved, 'utf-8');
    const html = await this.inlineAssets(rawHtml, previewDir, req);
    return { html };
  }

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Get(':path(*)')
  serveFile(@Param('path') filePath: string, @Req() req: Request, @Res() res: Response): void {
    this.handleServe(filePath, req, res);
  }

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Get()
  serveRoot(@Req() req: Request, @Res() res: Response): void {
    this.handleServe('', req, res);
  }

  private getAppPrefix(req: Request): string {
    const forwardedPrefix = req.headers['x-forwarded-prefix'];
    if (typeof forwardedPrefix === 'string' && forwardedPrefix) {
      return forwardedPrefix.replace(/\/+$/, '');
    }
    const rawBasePath = process.env.CLIENT_BASE_PATH;
    if (rawBasePath && rawBasePath !== '/') {
      return rawBasePath.replace(/\/+$/, '');
    }
    return '';
  }

  private handleServe(filePath: string, req: Request, res: Response): void {
    this.getPreviewDir().then((previewDir) => {
      if (!existsSync(previewDir)) {
        res.status(404).json({
          error: '预览环境尚未部署，请先在发布中心执行"发布到预览环境"',
        });
        return;
      }

      const normalized = filePath || 'index.html';
      const resolved = path.resolve(previewDir, normalized);

      if (!resolved.startsWith(previewDir)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (existsSync(resolved) && statSync(resolved).isFile()) {
        this.sendFile(resolved, req, res);
        return;
      }

      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        const indexFile = path.join(resolved, 'index.html');
        if (existsSync(indexFile)) {
          this.sendFile(indexFile, req, res);
          return;
        }
      }

      const withHtml = resolved.endsWith('.html') ? resolved : resolved + '.html';
      if (existsSync(withHtml) && statSync(withHtml).isFile()) {
        this.sendFile(withHtml, req, res);
        return;
      }

      const rootIndex = path.join(previewDir, 'index.html');
      const introIndex = path.join(previewDir, 'docs', 'intro', 'index.html');
      if (existsSync(rootIndex)) {
        this.sendFile(rootIndex, req, res);
      } else if (existsSync(introIndex)) {
        this.sendFile(introIndex, req, res);
      } else {
        res.status(404).json({ error: 'Not found' });
      }
    }).catch((err: unknown) => {
      this.logger.error(`Preview serve error: ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  private async inlineAssets(html: string, previewDir: string, req: Request): Promise<string> {
    const appPrefix = this.getAppPrefix(req);
    let result = html;
    if (appPrefix) {
      result = result.replace(
        /\/api\/preview\/help-center/g,
        `${appPrefix}/api/preview/help-center`,
      );
    }
    const linkRegex = /<link[^>]*>/gi;
    result = result.replace(linkRegex, (match: string) => {
      if (!/rel=["']?stylesheet["']?/i.test(match)) return match;
      const hrefMatch = match.match(/href=["']?([^"'\s>]+)["']?/i);
      if (!hrefMatch) return match;
      const cssPath = this.resolveAssetPath(hrefMatch[1], previewDir, appPrefix);
      if (cssPath && existsSync(cssPath)) {
        try {
          const css = readFileSync(cssPath, 'utf-8');
          return `<style>${css}</style>`;
        } catch { return match; }
      }
      return match;
    });
    const jsRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    result = result.replace(jsRegex, (match: string, attrs: string) => {
      const srcMatch = attrs.match(/src=["']?([^"'\s>]+)["']?/i);
      if (!srcMatch) return match;
      const jsPath = this.resolveAssetPath(srcMatch[1], previewDir, appPrefix);
      if (jsPath && existsSync(jsPath)) {
        try {
          const js = readFileSync(jsPath, 'utf-8');
          const deferAttr = attrs.includes('defer') ? ' defer' : '';
          return `<script${deferAttr}>${js}<\/script>`;
        } catch { return match; }
      }
      return match;
    });
    return result;
  }

  private resolveAssetPath(url: string, previewDir: string, appPrefix: string): string | null {
    const prefix = `${appPrefix}/api/preview/help-center/`;
    if (url.startsWith(prefix)) {
      return path.join(previewDir, url.slice(prefix.length));
    }
    if (url.startsWith('/api/preview/help-center/')) {
      return path.join(previewDir, url.slice('/api/preview/help-center/'.length));
    }
    return null;
  }

  private sendFile(filePath: string, req: Request, res: Response): void {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (ext === '.html') {
      try {
        let content = readFileSync(filePath, 'utf-8');
        const appPrefix = this.getAppPrefix(req);
        if (appPrefix) {
          content = content.replace(
            /\/api\/preview\/help-center\//g,
            `${appPrefix}/api/preview/help-center/`,
          );
        }
        res.send(content);
      } catch {
        res.status(500).send('Error reading file');
      }
      return;
    }

    try {
      const buffer = readFileSync(filePath);
      res.send(buffer);
    } catch {
      res.status(500).send('Error reading file');
    }
  }
}
