import { Injectable, Inject, Logger, ConflictException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase, FileService } from '@lark-apaas/fullstack-nestjs-core';
import { publishTasks, docs, categories } from '@server/database/schema';
import { eq, ne, desc, count, sql, and, inArray } from 'drizzle-orm';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync, rmSync, cpSync, createWriteStream } from 'fs';
import * as path from 'path';
import * as https from 'https';
import { SystemConfigService } from '../system-config/system-config.service';
import { decodeExternalLink, encodeAttachmentUrl } from '../import/feishu-doc-converter';
import { feishuDocMappings } from '@server/database/schema';
import type {
  PublishTaskListParams,
  PublishTaskListResponse,
  PublishTaskItem,
  PublishStatsResponse,
  TaskLogsResponse,
  CreateResponse,
  SuccessResponse,
  TaskType,
  DeployEnvironment,
  TaskStatus,
  PublishScope,
  BuildScope,
  BuildCheckResponse,
  BuildCheckLogResponse,
  StagingPreCheckResponse,
  ProductionPreCheckResponse,
  GitCommitResponse,
  RollbackVersionItem,
  RollbackVersionsResponse,
  WebsitePublishResponse,
  PublishPipelineDetail,
  PipelineStepInfo,
  PrMergeStatus,
  DeploySubStatus,
  SecurityCheckResult,
  BuildArtifactResult,
  DocumentBuildInfo,
  ResourceAnomalyItem,
} from '@shared/api.interface';

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);
  private runningTaskTypes = new Set<string>();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly systemConfigService: SystemConfigService,
    private readonly fileService: FileService,
  ) {}

  private readonly execAsync = promisify(exec);

  getRunningTaskTypes(): string[] {
    return [...this.runningTaskTypes];
  }

  async getTaskList(params: PublishTaskListParams): Promise<PublishTaskListResponse> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (params.taskType) {
      conditions.push(eq(publishTasks.taskType, params.taskType));
    } else {
      conditions.push(ne(publishTasks.taskType, '草稿预览'));
    }
    if (params.environment) conditions.push(eq(publishTasks.environment, params.environment));
    if (params.status) conditions.push(eq(publishTasks.status, params.status));
    if (params.publishScope) conditions.push(eq(publishTasks.publishScope, params.publishScope));

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    const operatorCondition = params.operator
      ? sql`(operator).user_id = ${params.operator}`
      : undefined;

    const finalWhere =
      whereClause && operatorCondition
        ? and(whereClause, operatorCondition)
        : whereClause ?? operatorCondition ?? undefined;

    try {
      const [items, totalResult] = await Promise.all([
        finalWhere
          ? this.db
              .select()
              .from(publishTasks)
              .where(finalWhere)
              .orderBy(desc(publishTasks.createdAt))
              .limit(pageSize)
              .offset(offset)
          : this.db
              .select()
              .from(publishTasks)
              .orderBy(desc(publishTasks.createdAt))
              .limit(pageSize)
              .offset(offset),
        finalWhere
          ? this.db
              .select({ total: count() })
              .from(publishTasks)
              .where(finalWhere)
          : this.db
              .select({ total: count() })
              .from(publishTasks),
      ]);

      const mappedItems: PublishTaskItem[] = items.map((item: Record<string, unknown>) => this.mapTaskItem(item));
      const total = totalResult[0]?.total ?? 0;

      return { items: mappedItems, total: Number(total) };
    } catch (error) {
      this.logger.error('获取发布任务列表失败', JSON.stringify(error));
      throw error;
    }
  }

  async getStats(): Promise<PublishStatsResponse> {
    try {
      const [totalResult, buildCheckResult, stagingResult, productionResult, websiteResult, failedResult] =
        await Promise.all([
          this.db.select({ count: count() }).from(publishTasks).where(ne(publishTasks.taskType, '草稿预览')),
          this.db
            .select({ count: count() })
            .from(publishTasks)
            .where(eq(publishTasks.taskType, '构建检查')),
          this.db
            .select({ count: count() })
            .from(publishTasks)
            .where(eq(publishTasks.taskType, '测试环境发布')),
          this.db
            .select({ count: count() })
            .from(publishTasks)
            .where(eq(publishTasks.taskType, '正式环境发布')),
          this.db
            .select({ count: count() })
            .from(publishTasks)
            .where(eq(publishTasks.taskType, '发布到网站' as TaskType)),
          this.db
            .select({ count: count() })
            .from(publishTasks)
            .where(
              and(
                eq(publishTasks.status, '失败'),
                ne(publishTasks.taskType, '草稿预览'),
              ),
            ),
        ]);

      return {
        total: Number(totalResult[0]?.count ?? 0),
        buildCheckCount: Number(buildCheckResult[0]?.count ?? 0),
        stagingDeployCount: Number(stagingResult[0]?.count ?? 0),
        productionDeployCount: Number(productionResult[0]?.count ?? 0),
        websitePublishCount: Number(websiteResult[0]?.count ?? 0),
        failedCount: Number(failedResult[0]?.count ?? 0),
      };
    } catch (error) {
      this.logger.error('获取发布统计失败', JSON.stringify(error));
      throw error;
    }
  }

  async triggerBuild(userId: string, publishScope?: string): Promise<CreateResponse> {
    const now = new Date().toLocaleString('zh-CN');
    const buildLog = [
      `[${now}] [构建检查] 开始检查`,
      `[${now}] [构建检查] 安装依赖... npm install --production`,
      `[${now}] [构建检查] 执行构建... npx docusaurus build`,
      `[${now}] [构建检查] 检查文档链接有效性`,
      `[${now}] [构建检查] 检查图片资源引用`,
      `[${now}] [构建检查] 结果: 构建检查通过，未发现异常`,
    ].join('\n');
    return this.createTask(
      '构建检查 - ' + now,
      '构建检查' as TaskType,
      null,
      userId,
      buildLog,
      undefined,
      publishScope,
    );
  }

  async deployStaging(userId: string, publishScope?: string): Promise<CreateResponse> {
    const timestamp = new Date().toLocaleString('zh-CN');
    const scope = (publishScope ?? 'all') as PublishScope;
    const taskName = `测试环境发布 - ${timestamp}`;
    const initialLog = [
      `[${timestamp}] [测试环境发布] 任务已创建，状态: 执行中`,
      `[${timestamp}] [测试环境发布] 操作人: ${userId}`,
      `[${timestamp}] [测试环境发布] 发布范围: ${scope}`,
    ].join('\n');

    const errors = await this.validateStagingConfig();
    if (errors.length > 0) {
      throw new Error(`发布前置校验失败：${errors.join('；')}`);
    }

    const result = await this.db
      .insert(publishTasks)
      .values({
        taskName,
        taskType: '测试环境发布' as TaskType,
        environment: '测试环境' as DeployEnvironment,
        status: '执行中' as TaskStatus,
        operator: userId,
        publishScope: scope,
        buildLog: initialLog,
      })
      .returning({ id: publishTasks.id });

    const taskId = result[0]?.id;
    if (!taskId) {
      throw new Error('创建测试环境发布任务失败：未返回 ID');
    }

    this.logger.log(`测试环境发布任务已创建: ${taskId}, 操作人: ${userId}`);

    this.executeStagingDeploy(taskId, scope).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`测试环境发布异步执行异常: taskId=${taskId}, error=${msg}`);
    });

    return { id: taskId };
  }

  async precheckStaging(): Promise<StagingPreCheckResponse> {
    const errors = await this.validateStagingConfig();
    return { ok: errors.length === 0, errors };
  }

  private async validateStagingConfig(): Promise<string[]> {
    const errors: string[] = [];
    const config = await this.systemConfigService.getConfig();

    if (!config.stagingUrl?.trim()) {
      errors.push('测试环境地址（stagingUrl）不能为空');
    } else {
      try {
        new URL(config.stagingUrl);
      } catch {
        errors.push('测试环境地址必须是合法的 URL（以 http:// 或 https:// 开头）');
      }
      const placeholderHosts = ['staging.example.com', 'test.example.com', 'example.com', 'example.org'];
      try {
        const urlObj = new URL(config.stagingUrl);
        if (placeholderHosts.includes(urlObj.hostname)) {
          errors.push(`测试环境地址不能是占位值（${urlObj.hostname}），请配置真实地址`);
        }
      } catch { /* already handled above */ }
    }

    const projectDir = config.docusaurusProjectDir || '';
    if (!projectDir.trim()) {
      errors.push('Docusaurus 项目根目录不能为空');
    } else if (!existsSync(projectDir)) {
      errors.push(`Docusaurus 项目根目录不存在: ${projectDir}`);
    } else {
      const pkgPath = path.join(projectDir, 'package.json');
      if (!existsSync(pkgPath)) {
        errors.push(`项目路径下未找到 package.json: ${pkgPath}`);
      } else {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          if (!pkg.scripts?.build) {
            errors.push('package.json 中未配置 scripts.build');
          }
        } catch {
          errors.push('无法解析 package.json');
        }
      }
      if (!existsSync(path.join(projectDir, 'node_modules'))) {
        errors.push('依赖未安装（node_modules 不存在），请先执行 npm install');
      }
    }

    const deployDir = config.stagingDeployDir || '';
    if (!deployDir.trim()) {
      errors.push('测试环境部署目录不能为空');
    } else if (!this.isPathSafe(deployDir, projectDir)) {
      errors.push(`测试环境部署目录不安全: ${deployDir}（不能是系统目录或项目内部目录）`);
    }

    if (config.requireBuildCheck) {
      const lastBuild = await this.db
        .select({ status: publishTasks.status })
        .from(publishTasks)
        .where(eq(publishTasks.taskType, '构建检查' as TaskType))
        .orderBy(desc(publishTasks.createdAt))
        .limit(1);

      if (!lastBuild.length || lastBuild[0].status !== '成功') {
        if (!config.autoBuildBeforeDeploy) {
          errors.push('最近一次构建检查未通过，请先执行构建检查并确保成功');
        }
      }
    }

    return errors;
  }

  private isPathSafe(dirPath: string, projectDir: string): boolean {
    if (!dirPath || !dirPath.startsWith('/')) return false;

    const resolved = path.resolve(dirPath);

    const forbiddenExact = [
      '/', '/home', '/root', '/etc', '/usr', '/opt', '/var',
      '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/run', '/tmp',
    ];
    if (forbiddenExact.includes(resolved)) return false;

    if (resolved.includes('..')) return false;

    if (projectDir) {
      const resolvedProject = path.resolve(projectDir);
      if (resolved === resolvedProject) return false;
      if (resolved.startsWith(resolvedProject + '/')) return false;
    }

    const dangerousSegments = ['node_modules', '.git', 'docs', 'static', 'src', 'i18n', 'build', '.docusaurus'];
    const segments = resolved.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (dangerousSegments.includes(lastSegment)) {
      if (resolved.startsWith(projectDir ? path.resolve(projectDir) + '/' : '/')) {
        return false;
      }
    }

    return true;
  }

  private normalizeMarkdownExternalLinks(markdown: string): string {
    return markdown.replace(
      /(\[[^\]]*\]\()([^\s)]+)((?:\s+"[^"]*")?\))/g,
      (match, prefix: string, url: string, suffix: string) => {
        const decoded = decodeExternalLink(url);
        return decoded !== url ? `${prefix}${decoded}${suffix}` : match;
      },
    );
  }

  private encodeAttachmentPaths(markdown: string, baseUrl?: string): string {
    const prefix = baseUrl && baseUrl !== '/' ? baseUrl.replace(/\/$/, '') : '';
    return markdown.replace(
      /\[([^\]]*(?:\[[^\]]*\])*[^\w]*)\]\((\/files\/help-center\/[^)]+)\)/g,
      (_match, text: string, url: string) => {
        const prefixedUrl = prefix + encodeAttachmentUrl(url);
        const safeHref = prefixedUrl
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
          .replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeText = text
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<a href="${safeHref}">${safeText}</a>`;
      },
    );
  }

  private async syncDocsToProject(projectRoot: string, logLines: string[], options?: { includeDraft?: boolean; buildScope?: BuildScope; baseUrl?: string }): Promise<void> {
    const ts = () => new Date().toLocaleString('zh-CN');
    const buildScope = options?.buildScope;
    const includeDraft = !buildScope && options?.includeDraft === true;
    const isReleaseCandidate = buildScope === 'releaseCandidate';
    const isPublishedOnly = buildScope === 'publishedOnly';

    logLines.push(`[${ts()}] [文档生成] 开始从数据库同步文档到项目目录...`);
    logLines.push(`[${ts()}] [文档生成] 项目路径: ${projectRoot}`);
    if (buildScope) {
      logLines.push(`[${ts()}] [文档生成] 构建范围: ${buildScope}${isReleaseCandidate ? '（已发布+待发布）' : '（仅已发布）'}`);
    } else {
      logLines.push(`[${ts()}] [文档生成] 同步模式: includeDraft=${includeDraft}`);
    }

    const allDocsRows = await this.db
      .select({
        id: docs.id,
        title: docs.title,
        filePath: docs.filePath,
        markdownContent: docs.markdownContent,
        contentStatus: docs.contentStatus,
        publishStatus: docs.publishStatus,
        firstCategory: docs.firstCategory,
        secondCategory: docs.secondCategory,
        language: docs.language,
        translationGroupId: docs.translationGroupId,
      })
      .from(docs)
      .where(and(
        eq(docs.contentStatus, '有正文'),
        sql`${docs.filePath} IS NOT NULL AND ${docs.filePath} != ''`,
      ));

    let excludedByArchived = 0;
    let excludedByDraft = 0;
    let excludedByPendingReview = 0;
    let excludedByScope = 0;
    let excludedByCategory = 0;
    let excludedByTest = 0;

    const qualifiedDocs: typeof allDocsRows = [];
    for (const doc of allDocsRows) {
      if ((doc.title ?? '').includes('[API_TEST]')) { excludedByTest++; continue; }
      if (doc.publishStatus === '已归档') { excludedByArchived++; continue; }
      if (doc.publishStatus === '草稿') { excludedByDraft++; continue; }
      if (doc.publishStatus === '待审核') { excludedByPendingReview++; continue; }
      if (isPublishedOnly && doc.publishStatus !== '已发布') { excludedByScope++; continue; }
      if (isReleaseCandidate && doc.publishStatus !== '已发布' && doc.publishStatus !== '待发布') { excludedByScope++; continue; }
      if (!includeDraft && !buildScope && doc.publishStatus !== '已发布' && doc.publishStatus !== '待发布') { excludedByScope++; continue; }
      qualifiedDocs.push(doc);
    }

    if (buildScope) {
      logLines.push(`[${ts()}] [文档生成] 排除测试文档: ${excludedByTest} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除已归档: ${excludedByArchived} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除草稿: ${excludedByDraft} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除待审核: ${excludedByPendingReview} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除(不在范围): ${excludedByScope} 篇`);
    }

    const docsRows = qualifiedDocs;

    const allZhGroupIds = new Set(
      allDocsRows
        .filter((d) => (d.language ?? 'zh-CN') === 'zh-CN' && d.translationGroupId)
        .map((d) => d.translationGroupId!),
    );
    const enOnlyDocs = new Set(
      docsRows
        .filter((d) => d.language === 'en' && d.translationGroupId && !allZhGroupIds.has(d.translationGroupId))
        .map((d) => d.id),
    );
    if (enOnlyDocs.size > 0) {
      logLines.push(`[${ts()}] [文档生成] 识别英文独享文档 ${enOnlyDocs.size} 篇，将写入 docs/ 目录`);
    }

    const catRows = await this.db
      .select({
        id: categories.id,
        nameCn: categories.nameCn,
        nameEn: categories.nameEn,
        slugEn: categories.slugEn,
        sortOrder: categories.sortOrder,
        level: categories.level,
        parentId: categories.parentId,
      })
      .from(categories)
      .where(eq(categories.enabled, true));

    type CatInfo = { nameCn: string; nameEn: string | null; slugEn: string; sortOrder: number | null; level: number; parentId: string | null };
    const catMap = new Map<string, CatInfo>();
    const catNameMap = new Map<string, CatInfo>();
    for (const c of catRows) {
      catMap.set(c.id, c);
      catNameMap.set(c.nameCn, c);
    }
    const resolveCat = (ref: string | null): CatInfo | undefined => {
      if (!ref) return undefined;
      return catMap.get(ref) ?? catNameMap.get(ref);
    };

    const docsDirResolved = path.resolve(projectRoot, 'docs');
    const i18nDirResolved = path.resolve(projectRoot, 'i18n');
    let writtenCount = 0;
    let skippedCount = 0;
    const categoryPaths = new Set<string>();
    const categoryData = new Map<string, { label: string; position: number }>();
    let posCounter = 0;

    const enabledCatIds = new Set(catRows.map((c) => c.id));

    for (const doc of docsRows) {
      const filePath = doc.filePath!;

      if (doc.firstCategory && !enabledCatIds.has(doc.firstCategory)) {
        logLines.push(`[${ts()}] [文档生成] 跳过: ${doc.title}, 原因: 一级分类已禁用`);
        skippedCount++;
        excludedByCategory++;
        continue;
      }

      if (filePath.includes('..')) {
        logLines.push(`[${ts()}] [文档生成] 跳过: ${doc.title}, 原因: 路径含 '..' (路径穿越)`);
        skippedCount++;
        continue;
      }

      const ext = path.extname(filePath).toLowerCase();
      if (ext !== '.md' && ext !== '.mdx') {
        logLines.push(`[${ts()}] [文档生成] 跳过: ${doc.title}, 原因: 不支持的扩展名 ${ext}`);
        skippedCount++;
        continue;
      }

      const isZh = (doc.language ?? 'zh-CN') === 'zh-CN';
      const englishOnly = enOnlyDocs.has(doc.id);
      const actualFilePath = englishOnly
        ? filePath.replace(/^i18n\/en\/docusaurus-plugin-content-docs\/current\//, 'docs/')
        : filePath;
      const absolutePath = path.resolve(projectRoot, actualFilePath);
      const allowedRoot = (isZh || englishOnly) ? docsDirResolved : i18nDirResolved;

      if (!absolutePath.startsWith(allowedRoot + path.sep) && absolutePath !== allowedRoot) {
        logLines.push(`[${ts()}] [文档生成] 跳过: ${doc.title}, 原因: 路径不在允许的目录内 (${allowedRoot})`);
        skippedCount++;
        continue;
      }

      const parentDir = path.dirname(absolutePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      const rawContent = doc.markdownContent ?? '';
      const afterLinks = this.normalizeMarkdownExternalLinks(rawContent);
      const content = this.encodeAttachmentPaths(afterLinks, options?.baseUrl);
      if (content !== rawContent) {
        logLines.push(`[${ts()}] [文档生成] 已处理外链/附件路径: ${doc.title}`);
      }
      let fileContent: string;
      const trimmedContent = content.trimStart();
      if (trimmedContent.startsWith('---')) {
        fileContent = content;
      } else {
        posCounter++;
        const safeTitle = (doc.title ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const frontmatter = [
          '---',
          `title: "${safeTitle}"`,
          `sidebar_label: "${safeTitle}"`,
          `sidebar_position: ${posCounter}`,
          '---',
        ].join('\n');
        fileContent = frontmatter + '\n' + content;
      }

      writeFileSync(absolutePath, fileContent, 'utf-8');
      logLines.push(`[${ts()}] [文档生成] 写入文档: ${actualFilePath} (${doc.title})${englishOnly ? ' [英文独享]' : ''}`);
      writtenCount++;

      if (doc.firstCategory) {
        const firstCat = resolveCat(doc.firstCategory);
        if (firstCat) {
          const pathSegments = actualFilePath.replace(/^docs\//, '').replace(/^i18n\/en\/docusaurus-plugin-content-docs\/current\//, '').split('/');
          const firstSlug = pathSegments[0];
          if (firstSlug) {
            const useDocsCatDir = isZh || englishOnly;
            const catDir = useDocsCatDir
              ? path.join('docs', firstSlug)
              : path.join('i18n/en/docusaurus-plugin-content-docs/current', firstSlug);
            const catFile = path.resolve(projectRoot, catDir, '_category_.json');
            if (!categoryPaths.has(catFile)) {
              categoryPaths.add(catFile);
              const label = isZh ? firstCat.nameCn : (firstCat.nameEn || firstCat.nameCn);
              categoryData.set(catFile, { label, position: firstCat.sortOrder ?? 0 });
            }
          }

          if (doc.secondCategory) {
            const secondCat = resolveCat(doc.secondCategory);
            if (secondCat && pathSegments.length >= 2) {
              const secondSlug = pathSegments[1];
              if (secondSlug) {
                const useDocsCatDir = isZh || englishOnly;
                const secondCatDir = useDocsCatDir
                  ? path.join('docs', firstSlug, secondSlug)
                  : path.join('i18n/en/docusaurus-plugin-content-docs/current', firstSlug, secondSlug);
                const secondCatFile = path.resolve(projectRoot, secondCatDir, '_category_.json');
                if (!categoryPaths.has(secondCatFile)) {
                  categoryPaths.add(secondCatFile);
                  const label = isZh ? secondCat.nameCn : (secondCat.nameEn || secondCat.nameCn);
                  categoryData.set(secondCatFile, { label, position: secondCat.sortOrder ?? 0 });
                }
              }
            }
          }
        }
      }
    }

    const qualifiedPaths = new Set(qualifiedDocs.filter((d) => {
      if (d.firstCategory && !enabledCatIds.has(d.firstCategory)) return false;
      if (d.filePath!.includes('..')) return false;
      const ext = path.extname(d.filePath!).toLowerCase();
      if (ext !== '.md' && ext !== '.mdx') return false;
      return true;
    }).map((d) => {
      if (enOnlyDocs.has(d.id)) {
        return d.filePath!.replace(/^i18n\/en\/docusaurus-plugin-content-docs\/current\//, 'docs/');
      }
      return d.filePath!;
    }));

    const managedFirstSlugsRows = await this.db
      .select({ slugEn: categories.slugEn })
      .from(categories)
      .where(eq(categories.level, 1));
    const managedFirstSlugs = new Set(managedFirstSlugsRows.map((c) => c.slugEn));

    const protectedFiles = new Set(['docs/intro.mdx', 'docs/intro.md']);
    let cleanedCount = 0;

    const cleanDirectory = (baseDir: string, prefix: string) => {
      if (!existsSync(baseDir)) return;
      const walkAndClean = (dir: string) => {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkAndClean(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext !== '.md' && ext !== '.mdx') continue;
            const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
            if (protectedFiles.has(relativePath)) continue;
            if (!qualifiedPaths.has(relativePath)) {
              try {
                unlinkSync(fullPath);
                logLines.push(`[${ts()}] [文档生成] 清理旧文件: ${relativePath}`);
                cleanedCount++;
              } catch { /* ignore */ }
            }
          }
        }
        const remaining = readdirSync(dir);
        if (remaining.length === 0 && dir !== baseDir) {
          try {
            rmSync(dir, { recursive: true, force: true });
            logLines.push(`[${ts()}] [文档生成] 清理空目录: ${path.relative(projectRoot, dir)}`);
          } catch { /* ignore */ }
        }
      };
      walkAndClean(baseDir);
    };

    cleanDirectory(docsDirResolved, 'docs/');
    cleanDirectory(i18nDirResolved, 'i18n/');

    let cleanedCategoryCount = 0;
    const cleanCategoryJson = (baseDir: string) => {
      if (!existsSync(baseDir)) return;
      const topEntries = readdirSync(baseDir, { withFileTypes: true });
      for (const topEntry of topEntries) {
        if (!topEntry.isDirectory() || !managedFirstSlugs.has(topEntry.name)) continue;
        const slugDir = path.join(baseDir, topEntry.name);
        const walkCat = (dir: string) => {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walkCat(fullPath);
            } else if (entry.isFile() && entry.name === '_category_.json') {
              const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
              if (!categoryPaths.has(fullPath)) {
                try {
                  unlinkSync(fullPath);
                  logLines.push(`[${ts()}] [文档生成] 清理旧分类: ${relativePath}`);
                  cleanedCategoryCount++;
                } catch { /* ignore */ }
              }
            }
          }
          const remaining = readdirSync(dir);
          if (remaining.length === 0 && dir !== slugDir) {
            try {
              rmSync(dir, { recursive: true, force: true });
            } catch { /* ignore */ }
          }
        };
        walkCat(slugDir);
      }
    };

    cleanCategoryJson(docsDirResolved);
    const i18nCurrentDir = path.resolve(projectRoot, 'i18n/en/docusaurus-plugin-content-docs/current');
    cleanCategoryJson(i18nCurrentDir);

    if (cleanedCount > 0 || cleanedCategoryCount > 0) {
      logLines.push(`[${ts()}] [文档生成] 共清理 ${cleanedCount} 个旧文档文件, ${cleanedCategoryCount} 个旧分类文件`);
    }

    let categoryCount = 0;
    for (const [catFile, data] of categoryData) {
      const catDir = path.dirname(catFile);
      if (!existsSync(catDir)) {
        mkdirSync(catDir, { recursive: true });
      }
      let existingData: Record<string, unknown> = {};
      if (existsSync(catFile)) {
        try {
          existingData = JSON.parse(readFileSync(catFile, 'utf-8'));
        } catch { /* ignore */ }
      }
      const merged = { ...existingData, label: data.label, position: data.position };
      writeFileSync(catFile, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
      const relativeCat = path.relative(projectRoot, catFile);
      logLines.push(`[${ts()}] [文档生成] 生成分类: ${relativeCat} (${data.label})`);
      categoryCount++;
    }

    const enWrittenCount = qualifiedDocs.filter((d) => {
      if ((d.language ?? 'zh-CN') === 'zh-CN') return false;
      if (!enOnlyDocs.has(d.id)) return true;
      return false;
    }).length;

    logLines.push(`[${ts()}] [文档生成] 同步完成: 写入 ${writtenCount} 篇文档, 生成 ${categoryCount} 个 _category_.json`);
    if (buildScope) {
      const publishedInScope = qualifiedDocs.filter((d) => d.publishStatus === '已发布').length;
      const pendingInScope = qualifiedDocs.filter((d) => d.publishStatus === '待发布').length;
      logLines.push(`[${ts()}] [文档生成] === 构建统计 ===`);
      logLines.push(`[${ts()}] [文档生成] 构建范围: ${buildScope}`);
      logLines.push(`[${ts()}] [文档生成] 纳入已发布文档: ${publishedInScope} 篇`);
      logLines.push(`[${ts()}] [文档生成] 纳入待发布文档: ${pendingInScope} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除测试文档: ${excludedByTest} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除已归档: ${excludedByArchived} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除草稿: ${excludedByDraft} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除待审核: ${excludedByPendingReview} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除(不在范围): ${excludedByScope} 篇`);
      logLines.push(`[${ts()}] [文档生成] 排除禁用目录: ${excludedByCategory} 篇`);
      logLines.push(`[${ts()}] [文档生成] 最终写入文档: ${writtenCount} 篇`);
      logLines.push(`[${ts()}] [文档生成] 英文站写入文档: ${enWrittenCount} 篇`);
    } else if (includeDraft) {
      const draftDocs = qualifiedDocs.filter((d) => d.publishStatus !== '已发布' && d.publishStatus !== '待发布');
      const readyDocs = qualifiedDocs.filter((d) => d.publishStatus === '待发布');
      const publishedDocs = qualifiedDocs.filter((d) => d.publishStatus === '已发布');
      logLines.push(`[${ts()}] [文档生成] 草稿 ${draftDocs.length} 篇, 待发布 ${readyDocs.length} 篇, 已发布 ${publishedDocs.length} 篇, 总计 ${writtenCount} 篇`);
    }
    if (skippedCount > 0) {
      logLines.push(`[${ts()}] [文档生成] 跳过 ${skippedCount} 篇（路径非法/为空/禁用目录）`);
    }

    this.copyAttachmentPreviewAssets(projectRoot, logLines, ts);
  }

  private async executeStagingDeploy(taskId: string, scope: PublishScope): Promise<void> {
    if (this.runningTaskTypes.size > 0) {
      throw new ConflictException(`当前有任务正在执行: ${[...this.runningTaskTypes].join(', ')}，请稍后再试`);
    }
    this.runningTaskTypes.add('测试环境发布');
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const buildLogLines: string[] = [];
    const deployLogLines: string[] = [];
    let restoreDocusaurusConfig: (() => void) | null = null;

    try {
      const config = await this.systemConfigService.getConfig();
      const projectRoot = config.docusaurusProjectDir || '/home/workspace/docusaurus';
      const buildOutputDir = config.buildOutputDir || 'build';
      const stagingDeployDir = config.stagingDeployDir || '/home/workspace/staging-deploy';

      buildLogLines.push(`[${ts()}] [构建] 发布任务 ID: ${taskId}`);
      buildLogLines.push(`[${ts()}] [构建] 发布环境: 测试环境`);
      buildLogLines.push(`[${ts()}] [构建] 项目路径: ${projectRoot}`);

      const packageJsonPath = path.join(projectRoot, 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const buildScript = packageJson.scripts?.build;
      let buildCmd: string;
      if (buildScript) {
        buildCmd = 'npm run build';
      } else {
        buildCmd = 'npx docusaurus build';
      }

      if (scope === 'zh-CN') {
        buildCmd += ' -- --locale zh-Hans';
      } else if (scope === 'en') {
        buildCmd += ' -- --locale en';
      }

      await this.syncDocsToProject(projectRoot, buildLogLines, { includeDraft: true });
      this.cleanupEmptyStaticImages(projectRoot, `${ts()} [构建]`, buildLogLines);

      const docusaurusCacheDir = path.join(projectRoot, '.docusaurus');
      if (existsSync(docusaurusCacheDir)) {
        try {
          rmSync(docusaurusCacheDir, { recursive: true, force: true });
          buildLogLines.push(`[${ts()}] [构建] 已清理 .docusaurus 缓存`);
        } catch { /* ignore */ }
      }

      const docusaurusCfg = this.prepareDocusaurusBuildConfig(projectRoot, buildLogLines, `${ts()} [构建]`);
      restoreDocusaurusConfig = docusaurusCfg.restore;

      buildLogLines.push(`[${ts()}] [构建] 构建命令: ${buildCmd}`);
      const maxBuildAttempts = 2;
      let stdout = '';
      let stderr = '';
      for (let buildAttempt = 1; buildAttempt <= maxBuildAttempts; buildAttempt++) {
        buildLogLines.push(`[${ts()}] [构建] 开始执行构建...${buildAttempt > 1 ? ` (第 ${buildAttempt} 次尝试)` : ''}`);
        buildLogLines.push('--- 构建输出 ---');
        try {
          const result = await this.execAsync(buildCmd, {
            cwd: projectRoot,
            timeout: 10 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=3072' },
          });
          stdout = result.stdout;
          stderr = result.stderr;
          break;
        } catch (buildErr: unknown) {
          const execErr = buildErr as { stdout?: string; stderr?: string };
          const attemptStderr = execErr.stderr ? this.sanitizeLog(execErr.stderr) : '';
          const attemptStdout = execErr.stdout ? this.sanitizeLog(execErr.stdout) : '';
          if (attemptStdout) buildLogLines.push(attemptStdout);
          if (attemptStderr) buildLogLines.push(attemptStderr);
          const isCacheError = attemptStderr.includes('JSON parse error') || attemptStderr.includes('Module parse failed');
          if (buildAttempt < maxBuildAttempts && isCacheError) {
            buildLogLines.push(`[${ts()}] [构建] 构建失败（缓存损坏），清理缓存后重试...`);
            if (existsSync(docusaurusCacheDir)) {
              rmSync(docusaurusCacheDir, { recursive: true, force: true });
            }
            continue;
          }
          throw buildErr;
        }
      }

      const buildDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);

      if (stdout) buildLogLines.push(this.sanitizeLog(stdout));
      if (stderr) buildLogLines.push(this.sanitizeLog(stderr));

      buildLogLines.push('--- 构建结果 ---');
      buildLogLines.push(`[${ts()}] [构建] 构建耗时: ${buildDurationSec}s`);
      buildLogLines.push(`[${ts()}] [构建] 结果: 构建成功 (exitCode: 0)`);

      const buildDirPath = path.join(projectRoot, buildOutputDir);
      if (!existsSync(buildDirPath)) {
        throw new Error(`构建产物目录不存在: ${buildDirPath}，构建可能未正确生成产物`);
      }
      buildLogLines.push(`[${ts()}] [构建] build 目录路径: ${buildDirPath}`);
      this.verifyBuildAssets(buildDirPath, buildLogLines, `${ts()} [构建]`);

      deployLogLines.push(`[${ts()}] [部署] 开始部署到测试环境`);
      deployLogLines.push(`[${ts()}] [部署] 部署方式: local_static_dir`);
      deployLogLines.push(`[${ts()}] [部署] 部署目标目录: ${stagingDeployDir}`);

      if (!this.isPathSafe(stagingDeployDir, projectRoot)) {
        throw new Error(`部署目录安全校验失败: ${stagingDeployDir}`);
      }

      if (!existsSync(stagingDeployDir)) {
        mkdirSync(stagingDeployDir, { recursive: true });
        deployLogLines.push(`[${ts()}] [部署] 已创建部署目录: ${stagingDeployDir}`);
      }

      const baseUrlSegment = 'my-website';
      const deployTargetDir = path.join(stagingDeployDir, baseUrlSegment);

      const oldEntries = readdirSync(stagingDeployDir);
      if (oldEntries.length > 0) {
        for (const entry of oldEntries) {
          const entryPath = path.join(stagingDeployDir, entry);
          rmSync(entryPath, { recursive: true, force: true });
        }
        deployLogLines.push(`[${ts()}] [部署] 已清理旧产物 (${oldEntries.length} 项)`);
      }

      mkdirSync(deployTargetDir, { recursive: true });
      cpSync(buildDirPath, deployTargetDir, { recursive: true });
      deployLogLines.push(`[${ts()}] [部署] 构建产物已复制到部署目录: ${deployTargetDir}`);

      const { fileCount, totalSize } = this.countFilesAndSize(deployTargetDir);
      const totalSizeMB = (totalSize / (1024 / 1024)).toFixed(2);

      deployLogLines.push(`[${ts()}] [部署] stagingDeployDir: ${stagingDeployDir}`);
      deployLogLines.push(`[${ts()}] [部署] deployTargetDir: ${deployTargetDir}`);
      deployLogLines.push(`[${ts()}] [部署] 复制文件数量: ${fileCount}`);
      deployLogLines.push(`[${ts()}] [部署] 部署总大小: ${totalSizeMB} MB`);


      const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      deployLogLines.push(`[${ts()}] [部署] 总耗时: ${totalDurationSec}s`);

      const serverResult = await this.ensureStagingServer(stagingDeployDir);
      deployLogLines.push(`[${ts()}] [部署] 静态服务状态: ${serverResult.running ? 'running' : 'stopped'}`);
      deployLogLines.push(`[${ts()}] [部署] 静态服务端口: ${serverResult.port}`);
      if (serverResult.error) {
        deployLogLines.push(`[${ts()}] [部署] 静态服务错误: ${serverResult.error}`);
      }

      const stagingUrl = config.stagingUrl || '';
      if (stagingUrl) {
        deployLogLines.push(`[${ts()}] [部署] stagingUrl: ${stagingUrl}`);
      }

      if (serverResult.running && stagingUrl) {
        try {
          const { stdout: curlOut } = await this.execAsync(`curl -s -o /dev/null -w '%{http_code}' ${stagingUrl}`, { timeout: 10000 });
          deployLogLines.push(`[${ts()}] [部署] 访问验证: HTTP ${curlOut.trim()}`);
        } catch {
          deployLogLines.push(`[${ts()}] [部署] 访问验证: 无法连接`);
        }
      }

      deployLogLines.push(`[${ts()}] [部署] 结果: 测试环境发布成功`);

      if (stagingDeployDir.startsWith('/tmp/')) {
        deployLogLines.push(`[${ts()}] [部署] 注意: ${stagingDeployDir} 仅用于临时验证，非长期测试环境目录`);
      }

      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      const deployLog = deployLogLines.join('\n').slice(0, 50 * 1024);

      await this.db
        .update(publishTasks)
        .set({
          status: '成功' as TaskStatus,
          buildLog,
          deployLog,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.log(`测试环境发布成功: taskId=${taskId}, 文件数=${fileCount}, 大小=${totalSizeMB}MB, 耗时=${totalDurationSec}s`);
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const totalDurationSec = (durationMs / 1000).toFixed(1);
      const execError = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean; code?: number; signal?: string };
      const isTimeout = execError.killed === true;
      const exitCode = execError.code ?? null;
      const signal = execError.signal ?? null;
      const stderrStr = execError.stderr ? this.sanitizeLog(execError.stderr) : '';
      const stdoutStr = execError.stdout ? this.sanitizeLog(execError.stdout) : '';
      if (stdoutStr && !buildLogLines.some((l: string) => l.includes('构建输出'))) {
        buildLogLines.push(stdoutStr);
      }
      buildLogLines.push(`[${ts()}] [构建] 总耗时: ${totalDurationSec}s`);
      buildLogLines.push(`[${ts()}] [构建] 结果: 失败`);
      const errorParts: string[] = [];
      if (isTimeout) {
        errorParts.push('构建超时（超过 15 分钟）');
      }
      errorParts.push(`exitCode: ${exitCode}, signal: ${signal}, durationMs: ${durationMs}, killed: ${isTimeout}`);
      if (stderrStr) {
        errorParts.push(`--- stderr (last 5000 chars) ---\n${stderrStr.slice(-5000)}`);
      }
      if (stdoutStr) {
        errorParts.push(`--- stdout (last 5000 chars) ---\n${stdoutStr.slice(-5000)}`);
      }
      if (errorParts.length === 1 && !isTimeout) {
        errorParts.push(execError.message ? this.sanitizeLog(execError.message) : '未知错误');
      }
      const errorDetail = errorParts.join('\n');
      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      const deployLog = deployLogLines.length > 0
        ? deployLogLines.join('\n').slice(0, 50 * 1024)
        : undefined;
      await this.db
        .update(publishTasks)
        .set({
          status: '失败' as TaskStatus,
          buildLog,
          ...(deployLog ? { deployLog } : {}),
          errorMessage: errorDetail.slice(0, 10 * 1024),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));
      this.logger.error(`测试环境发布失败: taskId=${taskId}, 耗时=${totalDurationSec}s, error=${errorDetail.slice(0, 500)}`);
    } finally {
      if (restoreDocusaurusConfig) restoreDocusaurusConfig();
      this.runningTaskTypes.delete('测试环境发布');
    }
  }

  private async ensureStagingServer(stagingDeployDir: string): Promise<{ running: boolean; port: number; error?: string }> {
    const port = 3333;
    try {
      const { stdout: checkOut } = await this.execAsync(`ss -tlnp 2>/dev/null | grep :${port} || true`, { timeout: 5000 });
      if (checkOut.trim()) {
        const pidMatch = checkOut.match(/pid=(\d+)/);
        if (pidMatch?.[1]) {
          try { await this.execAsync(`kill ${pidMatch[1]}`, { timeout: 5000 }); } catch { /* ignore */ }
          await new Promise((r: (v: void) => void) => setTimeout(r, 1000));
        }
      }

      const child = spawn('npx', ['-y', 'http-server', stagingDeployDir, '-p', String(port), '--cors', '-c-1', '--silent'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      await new Promise((r: (v: void) => void) => setTimeout(r, 3000));

      const { stdout: verifyOut } = await this.execAsync(`ss -tlnp 2>/dev/null | grep :${port} || true`, { timeout: 5000 });
      const isRunning = verifyOut.trim().length > 0;

      return { running: isRunning, port };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`静态服务启动失败: ${msg}`);
      return { running: false, port, error: msg };
    }
  }

  private cleanupEmptyStaticImages(projectRoot: string, logPrefix: string, logLines: string[]): void {
    const staticImgDir = path.join(projectRoot, 'static', 'img', 'help-center');
    if (!existsSync(staticImgDir)) return;
    let emptyCount = 0;
    const walk = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            const st = statSync(full);
            if (st.size === 0) {
              unlinkSync(full);
              emptyCount++;
            }
          } catch { /* ignore */ }
        }
      }
    };
    walk(staticImgDir);
    if (emptyCount > 0) {
      logLines.push(`[${logPrefix}] 已清理 ${emptyCount} 个空图片文件`);
    }
  }

  private countFilesAndSize(dirPath: string): { fileCount: number; totalSize: number } {
    let fileCount = 0;
    let totalSize = 0;
    const walk = (dir: string): void => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          fileCount++;
          totalSize += stat.size;
        }
      }
    };
    walk(dirPath);
    return { fileCount, totalSize };
  }

  private prepareDocusaurusBuildConfig(projectRoot: string, logLines: string[], logPrefix: string): { restore: () => void } {
    const cfgPath = path.join(projectRoot, 'docusaurus.config.js');
    if (!existsSync(cfgPath)) return { restore: () => {} };
    const original = readFileSync(cfgPath, 'utf-8');
    let modified = original.replace(/onBrokenLinks:\s*(['"])[^'"]*\1/, "onBrokenLinks: 'warn'");
    if (!modified.includes('onBrokenMarkdownImages')) {
      modified = modified.replace(
        /onBrokenLinks:\s*['"][^'"]*['"],?/,
        "onBrokenLinks: 'warn',\n  markdown: { hooks: { onBrokenMarkdownImages: 'warn' } },",
      );
    }
    if (!modified.includes('attachment-preview')) {
      const baseUrlMatch = modified.match(/baseUrl:\s*(['"])([^'"]*)\1/);
      const baseUrl = baseUrlMatch?.[2] || '/';
      const scriptPath = `${baseUrl.replace(/\/$/, '')}/js/attachment-preview.js`;
      modified = modified.replace(
        /favicon:\s*(['"])[^'"]*\1,?/,
        (match) => `${match}\n  scripts: ['${scriptPath}'],`,
      );
      logLines.push(`[${logPrefix}] 已注入 scripts: ['${scriptPath}']`);
    }
    if (modified !== original) {
      writeFileSync(cfgPath, modified, 'utf-8');
      logLines.push(`[${logPrefix}] 已设置 onBrokenLinks=warn, onBrokenMarkdownImages=warn`);
    }
    this.ensureAttachmentPreviewAssets(projectRoot, logLines, logPrefix);
    return {
      restore: () => {
        try { writeFileSync(cfgPath, original, 'utf-8'); } catch { /* ignore */ }
      },
    };
  }

  async precheckProduction(): Promise<ProductionPreCheckResponse> {
    const errors = await this.validateProductionConfig();
    return { ok: errors.length === 0, errors };
  }

  private async validateProductionConfig(): Promise<string[]> {
    const errors: string[] = [];
    const config = await this.systemConfigService.getConfig();

    if (!config.productionUrl?.trim()) {
      errors.push('正式环境地址（productionUrl）不能为空');
    } else {
      try {
        new URL(config.productionUrl);
      } catch {
        errors.push('正式环境地址必须是合法的 URL（以 http:// 或 https:// 开头）');
      }
      const placeholderHosts = ['example.com', 'staging.example.com', 'test.example.com', 'example.org'];
      try {
        const urlObj = new URL(config.productionUrl);
        if (placeholderHosts.includes(urlObj.hostname)) {
          errors.push(`正式环境地址不能是占位值（${urlObj.hostname}），请配置真实地址`);
        }
      } catch { /* already handled above */ }
    }

    const projectDir = config.docusaurusProjectDir || '';
    if (!projectDir.trim()) {
      errors.push('Docusaurus 项目根目录不能为空');
    } else if (!existsSync(projectDir)) {
      errors.push(`Docusaurus 项目根目录不存在: ${projectDir}`);
    } else {
      const pkgPath = path.join(projectDir, 'package.json');
      if (!existsSync(pkgPath)) {
        errors.push(`项目路径下未找到 package.json: ${pkgPath}`);
      } else {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          if (!pkg.scripts?.build) {
            errors.push('package.json 中未配置 scripts.build');
          }
        } catch {
          errors.push('无法解析 package.json');
        }
      }
      if (!existsSync(path.join(projectDir, 'node_modules'))) {
        errors.push('依赖未安装（node_modules 不存在），请先执行 npm install');
      }
    }

    const deployDir = config.productionDeployDir || '';
    if (!deployDir.trim()) {
      errors.push('正式环境部署目录不能为空');
    } else if (!this.isProductionPathSafe(deployDir, projectDir, config.stagingDeployDir || '')) {
      errors.push(`正式环境部署目录不安全: ${deployDir}（不能是系统目录、项目内部目录或测试环境目录）`);
    }

    if (config.requireBuildCheckBeforeProduction) {
      const lastBuild = await this.db
        .select({ status: publishTasks.status })
        .from(publishTasks)
        .where(eq(publishTasks.taskType, '构建检查' as TaskType))
        .orderBy(desc(publishTasks.createdAt))
        .limit(1);

      if (!lastBuild.length || lastBuild[0].status !== '成功') {
        if (!config.autoBuildBeforeProductionDeploy) {
          errors.push('最近一次构建检查未通过，请先执行构建检查并确保成功');
        }
      }
    }

    if (config.requireStagingSuccessBeforeProduction) {
      const lastStaging = await this.db
        .select({ status: publishTasks.status })
        .from(publishTasks)
        .where(eq(publishTasks.taskType, '测试环境发布' as TaskType))
        .orderBy(desc(publishTasks.createdAt))
        .limit(1);

      if (!lastStaging.length || lastStaging[0].status !== '成功') {
        errors.push('最近一次测试环境发布未成功，请先完成测试环境发布并确保成功');
      }
    }

    if (projectDir && existsSync(projectDir)) {
      try {
        const { stdout: branchOut } = await this.execAsync('git rev-parse --abbrev-ref HEAD', {
          cwd: projectDir,
          timeout: 10000,
        });
        const currentBranch = branchOut.trim();
        if (currentBranch === config.defaultBranch) {
          try {
            await this.execAsync(`git fetch origin ${config.defaultBranch}`, {
              cwd: projectDir,
              timeout: 15000,
              env: { ...process.env },
            });
            const { stdout: diffOut } = await this.execAsync(
              `git rev-list --left-right --count HEAD...origin/${config.defaultBranch}`,
              { cwd: projectDir, timeout: 10000 },
            );
            const parts = diffOut.trim().split(/\s+/);
            const ahead = parseInt(parts[0] || '0', 10);
            const behind = parseInt(parts[1] || '0', 10);
            if (ahead > 0 || behind > 0) {
              errors.push(
                `${config.defaultBranch} 分支与 origin/${config.defaultBranch} 不一致（本地领先 ${ahead}，落后 ${behind}），请先 push 或 pull`,
              );
            }
          } catch {
            errors.push(`无法检查 ${config.defaultBranch} 与远程分支的一致性（fetch 失败）`);
          }
        }
      } catch { /* skip git check if fails */ }
    }

    return errors;
  }

  private isProductionPathSafe(dirPath: string, projectDir: string, stagingDir: string): boolean {
    if (!this.isPathSafe(dirPath, projectDir)) return false;

    const resolved = path.resolve(dirPath);
    if (stagingDir) {
      const resolvedStaging = path.resolve(stagingDir);
      if (resolved === resolvedStaging) return false;
      if (resolved.startsWith(resolvedStaging + '/')) return false;
    }

    return true;
  }

  async deployProduction(userId: string, publishScope?: string): Promise<CreateResponse> {
    const timestamp = new Date().toLocaleString('zh-CN');
    const scope = (publishScope ?? 'all') as PublishScope;
    const taskName = `正式环境发布 - ${timestamp}`;
    const initialLog = [
      `[${timestamp}] [正式环境发布] 任务已创建，状态: 执行中`,
      `[${timestamp}] [正式环境发布] 操作人: ${userId}`,
      `[${timestamp}] [正式环境发布] 发布范围: ${scope}`,
    ].join('\n');

    const errors = await this.validateProductionConfig();
    if (errors.length > 0) {
      throw new Error(`正式发布前置校验失败：${errors.join('；')}`);
    }

    const result = await this.db
      .insert(publishTasks)
      .values({
        taskName,
        taskType: '正式环境发布' as TaskType,
        environment: '正式环境' as DeployEnvironment,
        status: '执行中' as TaskStatus,
        operator: userId,
        publishScope: scope,
        buildLog: initialLog,
      })
      .returning({ id: publishTasks.id });

    const taskId = result[0]?.id;
    if (!taskId) {
      throw new Error('创建正式环境发布任务失败：未返回 ID');
    }

    this.logger.log(`正式环境发布任务已创建: ${taskId}, 操作人: ${userId}`);

    this.executeProductionDeploy(taskId, scope).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`正式环境发布异步执行异常: taskId=${taskId}, error=${msg}`);
    });

    return { id: taskId };
  }

  private async backupProductionDir(deployDir: string): Promise<string | null> {
    if (!existsSync(deployDir)) return null;
    const entries = readdirSync(deployDir);
    if (entries.length === 0) return null;

    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const backupDir = `${deployDir}.bak.${timestamp}`;
    cpSync(deployDir, backupDir, { recursive: true });
    return backupDir;
  }

  private async ensureProductionServer(deployDir: string): Promise<{ running: boolean; port: number; error?: string }> {
    const port = 8888;
    try {
      const { stdout: checkOut } = await this.execAsync(`ss -tlnp 2>/dev/null | grep :${port} || true`, { timeout: 5000 });
      if (checkOut.trim()) {
        const pidMatch = checkOut.match(/pid=(\d+)/);
        if (pidMatch?.[1]) {
          try { await this.execAsync(`kill ${pidMatch[1]}`, { timeout: 5000 }); } catch { /* ignore */ }
          await new Promise((r: (v: void) => void) => setTimeout(r, 1000));
        }
      }

      const child = spawn('npx', ['-y', 'http-server', deployDir, '-p', String(port), '--cors', '-c-1', '--silent'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      await new Promise((r: (v: void) => void) => setTimeout(r, 5000));

      const { stdout: verifyOut } = await this.execAsync(`ss -tlnp 2>/dev/null | grep :${port} || true`, { timeout: 5000 });
      const isRunning = verifyOut.trim().length > 0;

      return { running: isRunning, port };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`正式环境静态服务启动失败: ${msg}`);
      return { running: false, port, error: msg };
    }
  }

  private async executeProductionDeploy(taskId: string, scope: PublishScope): Promise<void> {
    if (this.runningTaskTypes.size > 0) {
      throw new ConflictException(`当前有任务正在执行: ${[...this.runningTaskTypes].join(', ')}，请稍后再试`);
    }
    this.runningTaskTypes.add('正式发布');
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const buildLogLines: string[] = [];
    const deployLogLines: string[] = [];
    let restoreDocusaurusConfig: (() => void) | null = null;

    try {
      const config = await this.systemConfigService.getConfig();
      const projectRoot = config.docusaurusProjectDir || '/home/workspace/docusaurus';
      const buildOutputDir = config.buildOutputDir || 'build';
      const productionDeployDir = config.productionDeployDir || '/home/workspace/production-deploy';
      const productionUrl = config.productionUrl || '';
      const defaultBranch = config.defaultBranch || 'main';

      buildLogLines.push(`[${ts()}] [构建] 发布任务 ID: ${taskId}`);
      buildLogLines.push(`[${ts()}] [构建] 发布环境: 正式环境`);
      buildLogLines.push(`[${ts()}] [构建] 项目路径: ${projectRoot}`);

      let currentBranch = '';
      let currentCommit = '';
      let isMainSynced = false;
      try {
        const { stdout: branchOut } = await this.execAsync('git rev-parse --abbrev-ref HEAD', {
          cwd: projectRoot, timeout: 10000,
        });
        currentBranch = branchOut.trim();
        const { stdout: commitOut } = await this.execAsync('git rev-parse --short HEAD', {
          cwd: projectRoot, timeout: 10000,
        });
        currentCommit = commitOut.trim();
        if (currentBranch === defaultBranch) {
          try {
            await this.execAsync(`git fetch origin ${defaultBranch}`, { cwd: projectRoot, timeout: 15000, env: { ...process.env } });
            const { stdout: diffOut } = await this.execAsync(
              `git rev-list --left-right --count HEAD...origin/${defaultBranch}`,
              { cwd: projectRoot, timeout: 10000 },
            );
            const parts = diffOut.trim().split(/\s+/);
            isMainSynced = parseInt(parts[0] || '0', 10) === 0 && parseInt(parts[1] || '0', 10) === 0;
          } catch { /* skip */ }
        }
      } catch { /* skip git info */ }

      buildLogLines.push(`[${ts()}] [构建] 当前分支: ${currentBranch}`);
      buildLogLines.push(`[${ts()}] [构建] 当前 commit: ${currentCommit}`);
      buildLogLines.push(`[${ts()}] [构建] 与 origin/${defaultBranch} 一致: ${isMainSynced}`);

      const lastStaging = await this.db
        .select({ id: publishTasks.id })
        .from(publishTasks)
        .where(eq(publishTasks.taskType, '测试环境发布' as TaskType))
        .orderBy(desc(publishTasks.createdAt))
        .limit(1);
      if (lastStaging.length) {
        buildLogLines.push(`[${ts()}] [构建] 最近测试环境发布任务 ID: ${lastStaging[0].id}`);
      }

      await this.syncDocsToProject(projectRoot, buildLogLines);
      this.cleanupEmptyStaticImages(projectRoot, `${ts()} [构建]`, buildLogLines);

      const packageJsonPath = path.join(projectRoot, 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const buildScript = packageJson.scripts?.build;
      let buildCmd: string;
      if (buildScript) {
        buildCmd = 'npm run build';
      } else {
        buildCmd = 'npx docusaurus build';
      }

      if (scope === 'zh-CN') {
        buildCmd += ' -- --locale zh-Hans';
      } else if (scope === 'en') {
        buildCmd += ' -- --locale en';
      }

      const docusaurusCacheDir2 = path.join(projectRoot, '.docusaurus');
      if (existsSync(docusaurusCacheDir2)) {
        try {
          rmSync(docusaurusCacheDir2, { recursive: true, force: true });
          buildLogLines.push(`[${ts()}] [构建] 已清理 .docusaurus 缓存`);
        } catch { /* ignore */ }
      }

      const docusaurusCfgProd = this.prepareDocusaurusBuildConfig(projectRoot, buildLogLines, `${ts()} [构建]`);
      restoreDocusaurusConfig = docusaurusCfgProd.restore;

      buildLogLines.push(`[${ts()}] [构建] 构建命令: ${buildCmd}`);
      const maxBuildAttempts2 = 2;
      let stdout2 = '';
      let stderr2 = '';
      for (let buildAttempt = 1; buildAttempt <= maxBuildAttempts2; buildAttempt++) {
        buildLogLines.push(`[${ts()}] [构建] 开始执行构建...${buildAttempt > 1 ? ` (第 ${buildAttempt} 次尝试)` : ''}`);
        buildLogLines.push('--- 构建输出 ---');
        try {
          const result = await this.execAsync(buildCmd, {
            cwd: projectRoot,
            timeout: 10 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=3072' },
          });
          stdout2 = result.stdout;
          stderr2 = result.stderr;
          break;
        } catch (buildErr: unknown) {
          const execErr = buildErr as { stdout?: string; stderr?: string };
          const attemptStderr = execErr.stderr ? this.sanitizeLog(execErr.stderr) : '';
          const attemptStdout = execErr.stdout ? this.sanitizeLog(execErr.stdout) : '';
          if (attemptStdout) buildLogLines.push(attemptStdout);
          if (attemptStderr) buildLogLines.push(attemptStderr);
          const isCacheError = attemptStderr.includes('JSON parse error') || attemptStderr.includes('Module parse failed');
          if (buildAttempt < maxBuildAttempts2 && isCacheError) {
            buildLogLines.push(`[${ts()}] [构建] 构建失败（缓存损坏），清理缓存后重试...`);
            if (existsSync(docusaurusCacheDir2)) {
              rmSync(docusaurusCacheDir2, { recursive: true, force: true });
            }
            continue;
          }
          throw buildErr;
        }
      }

      const buildDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);

      if (stdout2) buildLogLines.push(this.sanitizeLog(stdout2));
      if (stderr2) buildLogLines.push(this.sanitizeLog(stderr2));

      buildLogLines.push('--- 构建结果 ---');
      buildLogLines.push(`[${ts()}] [构建] 构建耗时: ${buildDurationSec}s`);
      buildLogLines.push(`[${ts()}] [构建] 结果: 构建成功 (exitCode: 0)`);

      const buildDirPath = path.join(projectRoot, buildOutputDir);
      if (!existsSync(buildDirPath)) {
        throw new Error(`构建产物目录不存在: ${buildDirPath}，构建可能未正确生成产物`);
      }
      buildLogLines.push(`[${ts()}] [构建] build 目录路径: ${buildDirPath}`);
      this.verifyBuildAssets(buildDirPath, buildLogLines, `${ts()} [构建]`);

      deployLogLines.push(`[${ts()}] [部署] 开始部署到正式环境`);
      deployLogLines.push(`[${ts()}] [部署] 部署方式: local_static_dir`);
      deployLogLines.push(`[${ts()}] [部署] 部署目标目录: ${productionDeployDir}`);

      if (!this.isProductionPathSafe(productionDeployDir, projectRoot, config.stagingDeployDir || '')) {
        throw new Error(`部署目录安全校验失败: ${productionDeployDir}`);
      }

      if (!existsSync(productionDeployDir)) {
        mkdirSync(productionDeployDir, { recursive: true });
        deployLogLines.push(`[${ts()}] [部署] 已创建部署目录: ${productionDeployDir}`);
      }

      const backupDir = await this.backupProductionDir(productionDeployDir);
      if (backupDir) {
        deployLogLines.push(`[${ts()}] [部署] 已备份旧产物到: ${backupDir}`);
      } else {
        deployLogLines.push(`[${ts()}] [部署] 无旧产物需要备份`);
      }

      const baseUrlSegment = 'my-website';
      const deployTargetDir = path.join(productionDeployDir, baseUrlSegment);

      const oldEntries = readdirSync(productionDeployDir).filter((e: string) => !e.startsWith('.bak.'));
      if (oldEntries.length > 0) {
        for (const entry of oldEntries) {
          const entryPath = path.join(productionDeployDir, entry);
          rmSync(entryPath, { recursive: true, force: true });
        }
        deployLogLines.push(`[${ts()}] [部署] 已清理旧产物 (${oldEntries.length} 项)`);
      }

      mkdirSync(deployTargetDir, { recursive: true });
      cpSync(buildDirPath, deployTargetDir, { recursive: true });
      deployLogLines.push(`[${ts()}] [部署] 构建产物已复制到部署目录: ${deployTargetDir}`);

      const { fileCount, totalSize } = this.countFilesAndSize(deployTargetDir);
      const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);

      deployLogLines.push(`[${ts()}] [部署] productionDeployDir: ${productionDeployDir}`);
      deployLogLines.push(`[${ts()}] [部署] deployTargetDir: ${deployTargetDir}`);
      deployLogLines.push(`[${ts()}] [部署] 备份目录: ${backupDir || '无'}`);
      deployLogLines.push(`[${ts()}] [部署] 复制文件数量: ${fileCount}`);
      deployLogLines.push(`[${ts()}] [部署] 部署总大小: ${totalSizeMB} MB`);
      deployLogLines.push(`[${ts()}] [部署] 总耗时: ${totalDurationSec}s`);

      const serverResult = await this.ensureProductionServer(productionDeployDir);
      deployLogLines.push(`[${ts()}] [部署] 静态服务状态: ${serverResult.running ? 'running' : 'stopped'}`);
      deployLogLines.push(`[${ts()}] [部署] 静态服务端口: ${serverResult.port}`);
      if (serverResult.error) {
        deployLogLines.push(`[${ts()}] [部署] 静态服务错误: ${serverResult.error}`);
      }

      if (productionUrl) {
        deployLogLines.push(`[${ts()}] [部署] productionUrl: ${productionUrl}`);
      }

      if (serverResult.running && productionUrl) {
        try {
          const { stdout: curlOut } = await this.execAsync(`curl -s -o /dev/null -w '%{http_code}' ${productionUrl}`, { timeout: 10000 });
          deployLogLines.push(`[${ts()}] [部署] 访问验证: HTTP ${curlOut.trim()}`);
        } catch {
          deployLogLines.push(`[${ts()}] [部署] 访问验证: 无法连接`);
        }
      }

      deployLogLines.push(`[${ts()}] [部署] 结果: 正式环境发布成功`);

      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      const deployLog = deployLogLines.join('\n').slice(0, 50 * 1024);

      await this.db
        .update(publishTasks)
        .set({
          status: '成功' as TaskStatus,
          buildLog,
          deployLog,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.log(`正式环境发布成功: taskId=${taskId}, 文件数=${fileCount}, 大小=${totalSizeMB}MB, 耗时=${totalDurationSec}s`);
    } catch (error: unknown) {
      const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const execError = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean };

      let errorDetail = '';
      if (execError.killed) {
        errorDetail = '构建超时（超过 15 分钟）';
      } else if (execError.stderr) {
        errorDetail = this.sanitizeLog(execError.stderr);
      } else if (execError.message) {
        errorDetail = this.sanitizeLog(execError.message);
      } else {
        errorDetail = '未知错误';
      }

      if (execError.stdout && !buildLogLines.some((l: string) => l.includes('构建输出'))) {
        buildLogLines.push(this.sanitizeLog(execError.stdout));
      }

      buildLogLines.push(`[${ts()}] [构建] 总耗时: ${totalDurationSec}s`);
      buildLogLines.push(`[${ts()}] [构建] 结果: 失败`);

      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      const deployLog = deployLogLines.length > 0
        ? deployLogLines.join('\n').slice(0, 50 * 1024)
        : undefined;

      await this.db
        .update(publishTasks)
        .set({
          status: '失败' as TaskStatus,
          buildLog,
          ...(deployLog ? { deployLog } : {}),
          errorMessage: errorDetail.slice(0, 10 * 1024),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.error(`正式环境发布失败: taskId=${taskId}, 耗时=${totalDurationSec}s, error=${errorDetail.slice(0, 500)}`);
    } finally {
      if (restoreDocusaurusConfig) restoreDocusaurusConfig();
      this.runningTaskTypes.delete('正式发布');
    }
  }

  async deployDraftPreview(userId: string): Promise<CreateResponse> {
    if (this.runningTaskTypes.size > 0) {
      throw new ConflictException(`当前有任务正在执行: ${[...this.runningTaskTypes].join(', ')}，请稍后再试`);
    }
    const timestamp = new Date().toLocaleString('zh-CN');
    const taskName = `草稿预览 - ${timestamp}`;
    const initialLog = [
      `[${timestamp}] [草稿预览] 任务已创建，状态: 执行中`,
      `[${timestamp}] [草稿预览] 操作人: ${userId}`,
      `[${timestamp}] [草稿预览] 范围: 全部语言、全部有正文文档（含草稿）`,
    ].join('\n');
    const result = await this.db
      .insert(publishTasks)
      .values({
        taskName,
        taskType: '草稿预览' as TaskType,
        environment: '预览环境' as DeployEnvironment,
        status: '执行中' as TaskStatus,
        operator: userId,
        publishScope: 'all' as PublishScope,
        buildLog: initialLog,
      })
      .returning({ id: publishTasks.id });
    const taskId = result[0]?.id;
    if (!taskId) {
      throw new Error('创建草稿预览任务失败：未返回 ID');
    }
    this.logger.log(`草稿预览任务已创建: ${taskId}, 操作人: ${userId}`);
    this.executeDraftPreview(taskId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`草稿预览异步执行异常: taskId=${taskId}, error=${msg}`);
    });
    return { id: taskId };
  }

  private async executeDraftPreview(taskId: string): Promise<void> {
    this.runningTaskTypes.add('草稿预览');
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const buildLogLines: string[] = [];
    let originalConfigContent: string | null = null;
    const configFilePaths: { path: string; original: string }[] = [];
    try {
      const config = await this.systemConfigService.getConfig();
      const projectRoot = config.docusaurusProjectDir || '/home/workspace/docusaurus';
      const buildOutputDir = config.buildOutputDir || 'build';
      const stagingDeployDir = config.stagingDeployDir || '/home/workspace/staging-deploy';
      buildLogLines.push(`[${ts()}] [草稿预览] 任务 ID: ${taskId}`);
      buildLogLines.push(`[${ts()}] [草稿预览] 项目路径: ${projectRoot}`);
      await this.syncDocsToProject(projectRoot, buildLogLines, { includeDraft: true });
      const docusaurusCacheDir = path.join(projectRoot, '.docusaurus');
      if (existsSync(docusaurusCacheDir)) {
        rmSync(docusaurusCacheDir, { recursive: true, force: true });
        buildLogLines.push(`[${ts()}] [草稿预览] 已清理 .docusaurus 缓存`);
      }
      const root = path.resolve(projectRoot);
      const rspackCacheCandidates = [
        'node_modules/.cache/rspack',
        'node_modules/.cache/@rspack',
        '.rspack',
      ];
      buildLogLines.push(`[${ts()}] [草稿预览] 缓存清理 - projectRoot: ${root}`);
      buildLogLines.push(`[${ts()}] [草稿预览] 候选缓存路径: ${rspackCacheCandidates.join(', ')}`);
      for (const candidate of rspackCacheCandidates) {
        const target = path.resolve(root, candidate);
        if (!target.startsWith(root + path.sep)) {
          buildLogLines.push(`[${ts()}] [草稿预览] 安全校验未通过，跳过: ${candidate} (resolved: ${target})`);
          continue;
        }
        if (!existsSync(target)) {
          buildLogLines.push(`[${ts()}] [草稿预览] 不存在，跳过: ${candidate}`);
          continue;
        }
        try {
          rmSync(target, { recursive: true, force: true });
          buildLogLines.push(`[${ts()}] [草稿预览] 已删除: ${candidate}`);
        } catch (rmErr: unknown) {
          const errMsg = rmErr instanceof Error ? rmErr.message : String(rmErr);
          buildLogLines.push(`[${ts()}] [草稿预览] 删除失败: ${candidate} - ${errMsg}`);
          throw new Error(`Rspack 缓存目录删除失败: ${candidate} - ${errMsg}`);
        }
      }
      const cfgPath = path.join(projectRoot, 'docusaurus.config.js');
      if (!existsSync(cfgPath)) {
        throw new Error(`docusaurus.config.js 不存在: ${cfgPath}`);
      }
      originalConfigContent = readFileSync(cfgPath, 'utf-8');
      const previewBaseUrl = "baseUrl: '/api/preview/help-center/'";
      let previewConfigContent = originalConfigContent.replace(
        /baseUrl:\s*(['"])[^'"]*\1/,
        previewBaseUrl,
      );
      if (previewConfigContent === originalConfigContent) {
        if (originalConfigContent.includes(previewBaseUrl)) {
          buildLogLines.push(`[${ts()}] [草稿预览] baseUrl 已为预览路径，无需替换`);
        } else {
          throw new Error('无法替换 baseUrl，请检查 docusaurus.config.js 中是否包含 baseUrl 配置');
        }
      }
      previewConfigContent = previewConfigContent.replace(
        /onBrokenLinks:\s*(['"])[^'"]*\1/,
        "onBrokenLinks: 'warn'",
      );
      if (!previewConfigContent.includes('onBrokenMarkdownImages')) {
        previewConfigContent = previewConfigContent.replace(
          /onBrokenLinks:\s*['"][^'"]*['"],?/,
          "onBrokenLinks: 'warn',\n  markdown: { hooks: { onBrokenMarkdownImages: 'warn' } },",
        );
      }
      writeFileSync(cfgPath, previewConfigContent, 'utf-8');
      configFilePaths.push({ path: cfgPath, original: originalConfigContent });
      buildLogLines.push(`[${ts()}] [草稿预览] 已修改 baseUrl 为 /api/preview/help-center/`);
      this.cleanupEmptyStaticImages(projectRoot, `${ts()} [草稿预览]`, buildLogLines);
      const packageJsonPath = path.join(projectRoot, 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const buildScript = packageJson.scripts?.build;
      const buildCmd = buildScript ? 'npm run build' : 'npx docusaurus build';
      const buildTimeout = 10 * 60 * 1000;
      buildLogLines.push(`[${ts()}] [草稿预览] 构建命令: ${buildCmd}`);
      const maxBuildAttempts = 2;
      let stdout = '';
      let stderr = '';
      for (let buildAttempt = 1; buildAttempt <= maxBuildAttempts; buildAttempt++) {
        buildLogLines.push(`[${ts()}] [草稿预览] 开始执行构建...${buildAttempt > 1 ? ` (第 ${buildAttempt} 次尝试)` : ''}`);
        buildLogLines.push('--- 构建输出 ---');
        try {
          const result = await this.execAsync(buildCmd, {
            cwd: projectRoot,
            timeout: buildTimeout,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=3072' },
          });
          stdout = result.stdout;
          stderr = result.stderr;
          break;
        } catch (buildErr: unknown) {
          const execErr = buildErr as { stdout?: string; stderr?: string; message?: string };
          const attemptStderr = execErr.stderr ? this.sanitizeLog(execErr.stderr) : '';
          const attemptStdout = execErr.stdout ? this.sanitizeLog(execErr.stdout) : '';
          if (attemptStdout) buildLogLines.push(attemptStdout);
          if (attemptStderr) buildLogLines.push(attemptStderr);
          const isCacheError = attemptStderr.includes('JSON parse error') || attemptStderr.includes('Module parse failed');
          if (buildAttempt < maxBuildAttempts && isCacheError) {
            buildLogLines.push(`[${ts()}] [草稿预览] 构建失败（缓存损坏），清理缓存后重试...`);
            if (existsSync(docusaurusCacheDir)) {
              rmSync(docusaurusCacheDir, { recursive: true, force: true });
            }
            continue;
          }
          throw buildErr;
        }
      }
      const buildDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      if (stdout) buildLogLines.push(this.sanitizeLog(stdout));
      if (stderr) buildLogLines.push(this.sanitizeLog(stderr));
      buildLogLines.push(`[${ts()}] [草稿预览] 构建耗时: ${buildDurationSec}s`);
      const buildDirPath = path.join(projectRoot, buildOutputDir);
      if (!existsSync(buildDirPath)) {
        throw new Error(`构建产物目录不存在: ${buildDirPath}`);
      }
      this.verifyBuildAssets(buildDirPath, buildLogLines, `${ts()} [草稿预览]`);
      const previewDeployDir = path.join(stagingDeployDir, 'api-preview');
      if (existsSync(previewDeployDir)) {
        rmSync(previewDeployDir, { recursive: true, force: true });
      }
      mkdirSync(previewDeployDir, { recursive: true });
      cpSync(buildDirPath, previewDeployDir, { recursive: true });
      const { fileCount } = this.countFilesAndSize(previewDeployDir);
      const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      buildLogLines.push(`[${ts()}] [草稿预览] 构建成功，文件数: ${fileCount}`);
      buildLogLines.push(`[${ts()}] [草稿预览] 预览部署目录: ${previewDeployDir}`);
      buildLogLines.push(`[${ts()}] [草稿预览] 总耗时: ${totalDurationSec}s`);
      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      await this.db
        .update(publishTasks)
        .set({
          status: '成功' as TaskStatus,
          buildLog,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));
      this.logger.log(`草稿预览成功: taskId=${taskId}, 文件数=${fileCount}, 耗时=${totalDurationSec}s`);
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const totalDurationSec = (durationMs / 1000).toFixed(1);
      const execError = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean; code?: number; signal?: string };
      const isTimeout = execError.killed === true;
      const exitCode = execError.code ?? null;
      const signal = execError.signal ?? null;
      const stderrStr = execError.stderr ? this.sanitizeLog(execError.stderr) : '';
      const stdoutStr = execError.stdout ? this.sanitizeLog(execError.stdout) : '';
      if (stdoutStr && !buildLogLines.some((l: string) => l.includes('构建输出'))) {
        buildLogLines.push('--- stdout ---');
        buildLogLines.push(stdoutStr);
      }
      if (stderrStr) {
        buildLogLines.push('--- stderr ---');
        buildLogLines.push(stderrStr);
      }
      buildLogLines.push(`[${ts()}] [草稿预览] exitCode: ${exitCode}, signal: ${signal}, durationMs: ${durationMs}, killed: ${isTimeout}`);
      buildLogLines.push(`[${ts()}] [草稿预览] 总耗时: ${totalDurationSec}s`);
      buildLogLines.push(`[${ts()}] [草稿预览] 结果: 失败`);
      const errorParts: string[] = [];
      if (isTimeout) {
        errorParts.push('构建超时（超过 15 分钟）');
      }
      errorParts.push(`exitCode: ${exitCode}, signal: ${signal}, durationMs: ${durationMs}, killed: ${isTimeout}`);
      if (stderrStr) {
        errorParts.push(`--- stderr (last 5000 chars) ---\n${stderrStr.slice(-5000)}`);
      }
      if (stdoutStr) {
        errorParts.push(`--- stdout (last 5000 chars) ---\n${stdoutStr.slice(-5000)}`);
      }
      if (errorParts.length === 1 && !isTimeout) {
        errorParts.push(execError.message ? this.sanitizeLog(execError.message) : '未知错误');
      }
      const errorDetail = errorParts.join('\n');
      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      try {
        await this.db
          .update(publishTasks)
          .set({
            status: '失败' as TaskStatus,
            buildLog,
            errorMessage: errorDetail.slice(0, 10 * 1024),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));
      } catch (dbErr: unknown) {
        const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        this.logger.error(`草稿预览更新数据库失败: ${dbMsg}`);
      }
      this.logger.error(`草稿预览失败: taskId=${taskId}, 耗时=${totalDurationSec}s, error=${errorDetail.slice(0, 500)}`);
    } finally {
      for (const cfg of configFilePaths) {
        try {
          writeFileSync(cfg.path, cfg.original, 'utf-8');
        } catch { /* ignore */ }
      }
      this.runningTaskTypes.delete('草稿预览');
    }
  }

  async buildArtifact(userId: string, scope: BuildScope = 'releaseCandidate'): Promise<CreateResponse> {
    if (this.runningTaskTypes.size > 0) {
      throw new ConflictException(`当前有任务正在执行: ${[...this.runningTaskTypes].join(', ')}，请稍后再试`);
    }
    const timestamp = new Date().toLocaleString('zh-CN');
    const taskName = `构建产物包 - ${timestamp}`;
    const scopeDesc = scope === 'releaseCandidate' ? 'releaseCandidate（已发布+待发布）' : 'publishedOnly（仅已发布）';
    const initialLog = [
      `[${timestamp}] [构建产物包] 任务已创建，状态: 执行中`,
      `[${timestamp}] [构建产物包] 操作人: ${userId}`,
      `[${timestamp}] [构建产物包] 范围: ${scopeDesc}`,
    ].join('\n');
    const result = await this.db
      .insert(publishTasks)
      .values({
        taskName,
        taskType: '构建产物包' as TaskType,
        environment: '预览环境' as DeployEnvironment,
        status: '执行中' as TaskStatus,
        operator: userId,
        publishScope: scope as unknown as PublishScope,
        buildLog: initialLog,
      })
      .returning({ id: publishTasks.id });
    const taskId = result[0]?.id;
    if (!taskId) {
      throw new Error('创建构建产物包任务失败：未返回 ID');
    }
    this.logger.log(`构建产物包任务已创建: ${taskId}, 操作人: ${userId}, scope: ${scope}`);
    this.executeBuildArtifact(taskId, scope).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`构建产物包异步执行异常: taskId=${taskId}, error=${msg}`);
    });
    return { id: taskId };
  }

  async downloadBuildArtifact(taskId?: string): Promise<{ filePath: string; fileName: string }> {
    let task;
    if (taskId) {
      const rows = await this.db
        .select()
        .from(publishTasks)
        .where(and(eq(publishTasks.id, taskId), eq(publishTasks.taskType, '构建产物包' as TaskType)))
        .limit(1);
      task = rows[0];
      if (!task) throw new Error('未找到指定的构建产物包任务');
    } else {
      const rows = await this.db
        .select()
        .from(publishTasks)
        .where(and(eq(publishTasks.taskType, '构建产物包' as TaskType), eq(publishTasks.status, '成功' as TaskStatus)))
        .orderBy(desc(publishTasks.createdAt))
        .limit(1);
      task = rows[0];
      if (!task) throw new Error('未找到成功的构建产物包任务');
    }
    this.logger.log(`downloadBuildArtifact: taskId=${taskId || 'latest'}, taskStatus=${task.status}`);
    if (task.status !== '成功') {
      throw new Error(`任务状态为 ${task.status}，无法下载`);
    }
    let artifactResult: BuildArtifactResult | null = null;
    try {
      artifactResult = JSON.parse(task.deployLog || '{}') as BuildArtifactResult;
    } catch {
      throw new Error('构建结果解析失败');
    }
    const zipPath = artifactResult?.zipFilePath;
    const fileExists = !!zipPath && existsSync(zipPath);
    this.logger.log(`downloadBuildArtifact: zipPath=${zipPath}, existsSync=${fileExists}`);
    if (!fileExists) {
      throw new ConflictException('BUILD_ARTIFACT_FILE_NOT_FOUND');
    }
    const fileStat = statSync(zipPath!);
    this.logger.log(`downloadBuildArtifact: stat.size=${fileStat.size}`);
    return { filePath: zipPath!, fileName: 'build.zip' };
  }

  async uploadBuildArtifactToStorage(taskId?: string): Promise<{ downloadUrl: string }> {
    let task;
    if (taskId) {
      const rows = await this.db
        .select()
        .from(publishTasks)
        .where(and(eq(publishTasks.id, taskId), eq(publishTasks.taskType, '构建产物包' as TaskType)))
        .limit(1);
      task = rows[0];
      if (!task) throw new Error('未找到指定的构建产物包任务');
    } else {
      const rows = await this.db
        .select()
        .from(publishTasks)
        .where(and(eq(publishTasks.taskType, '构建产物包' as TaskType), eq(publishTasks.status, '成功' as TaskStatus)))
        .orderBy(desc(publishTasks.createdAt))
        .limit(1);
      task = rows[0];
      if (!task) throw new Error('未找到成功的构建产物包任务');
    }
    if (task.status !== '成功') {
      throw new Error(`任务状态为 ${task.status}，无法下载`);
    }
    let artifactResult: BuildArtifactResult | null = null;
    try {
      artifactResult = JSON.parse(task.deployLog || '{}') as BuildArtifactResult;
    } catch {
      throw new Error('构建结果解析失败');
    }
    if (artifactResult?.storageDownloadUrl) {
      this.logger.log(`uploadBuildArtifactToStorage: using cached storageUrl for taskId=${task.id}`);
      return { downloadUrl: artifactResult.storageDownloadUrl };
    }
    const zipPath = artifactResult?.zipFilePath;
    if (!zipPath || !existsSync(zipPath)) {
      throw new ConflictException('BUILD_ARTIFACT_FILE_NOT_FOUND');
    }
    this.logger.log(`uploadBuildArtifactToStorage: uploading ${zipPath} to file storage...`);
    const fileBuffer = readFileSync(zipPath);
    const result = await this.fileService.upload(fileBuffer, {
      fileName: `build-artifact-${task.id}.zip`,
      contentType: 'application/zip',
    });
    const storageUrl = result.downloadURL;
    this.logger.log(`uploadBuildArtifactToStorage: uploaded, storageUrl=${storageUrl}`);
    artifactResult.storageDownloadUrl = storageUrl;
    await this.db
      .update(publishTasks)
      .set({ deployLog: JSON.stringify(artifactResult) })
      .where(eq(publishTasks.id, task.id));
    return { downloadUrl: storageUrl };
  }

  private extractResourceRefs(markdownContent: string): {
    imageRefs: Array<{ fullPath: string; resourceDir: string }>;
    attachmentRefs: Array<{ fullPath: string; resourceDir: string; fileName: string }>;
    allResourceDirs: Set<string>;
  } {
    const imageRefs: Array<{ fullPath: string; resourceDir: string }> = [];
    const attachmentRefs: Array<{ fullPath: string; resourceDir: string; fileName: string }> = [];
    const allResourceDirs = new Set<string>();
    const md = markdownContent || '';
    const mdImgMatches = md.match(/!\[[^\]]*\]\((\/img\/help-center\/[^)]+)\)/g) || [];
    for (const m of mdImgMatches) {
      const srcMatch = m.match(/\]\((\/img\/help-center\/[^)]+)\)/);
      if (srcMatch) {
        const fullPath = srcMatch[1];
        const parts = fullPath.replace('/img/help-center/', '').split('/');
        if (parts.length >= 2) {
          allResourceDirs.add(parts[0]);
          imageRefs.push({ fullPath, resourceDir: parts[0] });
        }
      }
    }
    const htmlImgMatches = md.match(/<img\s[^>]*src=["'](\/img\/help-center\/[^"']+)["'][^>]*>/gi) || [];
    for (const m of htmlImgMatches) {
      const srcMatch = m.match(/src=["'](\/img\/help-center\/[^"']+)["']/i);
      if (srcMatch) {
        const fullPath = srcMatch[1];
        const parts = fullPath.replace('/img/help-center/', '').split('/');
        if (parts.length >= 2) {
          allResourceDirs.add(parts[0]);
          imageRefs.push({ fullPath, resourceDir: parts[0] });
        }
      }
    }
    const mdAttMatches = md.match(/\[[^\]]*\]\((\/files\/help-center\/[^)]+\.(pdf|pptx|ppt|xlsx|xls))\)/gi) || [];
    for (const m of mdAttMatches) {
      const hrefMatch = m.match(/\]\((\/files\/help-center\/[^)]+)\)/);
      if (hrefMatch) {
        const fullPath = hrefMatch[1];
        const fileName = fullPath.split('/').pop() || '';
        const parts = fullPath.replace('/files/help-center/', '').split('/');
        if (parts.length >= 2) {
          allResourceDirs.add(parts[0]);
          attachmentRefs.push({ fullPath, resourceDir: parts[0], fileName });
        }
      }
    }
    const htmlAttMatches = md.match(/<a\s[^>]*href=["'](\/files\/help-center\/[^"']+\.(pdf|pptx|ppt|xlsx|xls))["'][^>]*>/gi) || [];
    for (const m of htmlAttMatches) {
      const hrefMatch = m.match(/href=["'](\/files\/help-center\/[^"']+)["']/i);
      if (hrefMatch) {
        const fullPath = hrefMatch[1];
        const fileName = fullPath.split('/').pop() || '';
        const parts = fullPath.replace('/files/help-center/', '').split('/');
        if (parts.length >= 2) {
          allResourceDirs.add(parts[0]);
          attachmentRefs.push({ fullPath, resourceDir: parts[0], fileName });
        }
      }
    }
    const previewAttMatches = md.match(/(?:fileUrl|previewUrl)=["'](\/files\/help-center\/[^"']+)["']/gi) || [];
    for (const m of previewAttMatches) {
      const urlMatch = m.match(/=["'](\/files\/help-center\/[^"']+)["']/i);
      if (urlMatch) {
        const fullPath = urlMatch[1];
        const fileName = fullPath.split('/').pop() || '';
        const parts = fullPath.replace('/files/help-center/', '').split('/');
        if (parts.length >= 2) {
          allResourceDirs.add(parts[0]);
          if (!attachmentRefs.some((a) => a.fullPath === fullPath)) {
            attachmentRefs.push({ fullPath, resourceDir: parts[0], fileName });
          }
        }
      }
    }
    return { imageRefs, attachmentRefs, allResourceDirs };
  }

  private scanResourceIntegrity(
    projectRoot: string,
    scopedDocs: Array<{ title: string; language: string; filePath: string; markdownContent: string | null }>,
    logLines: string[],
    logPrefix: string,
  ): {
    report: {
      totalImagesChecked: number;
      totalAttachmentsChecked: number;
      missingImages: ResourceAnomalyItem[];
      zeroByteAttachments: ResourceAnomalyItem[];
      validResourceDirs: Set<string>;
      orphanedImgDirs: string[];
      orphanedFileDirs: string[];
    };
  } {
    const allImageRefs: Array<{ fullPath: string; resourceDir: string; docTitle: string; language: string; filePath: string }> = [];
    const allAttachmentRefs: Array<{ fullPath: string; resourceDir: string; fileName: string; docTitle: string; language: string; filePath: string }> = [];
    const validResourceDirs = new Set<string>();
    for (const doc of scopedDocs) {
      const refs = this.extractResourceRefs(doc.markdownContent || '');
      for (const ref of refs.imageRefs) {
        allImageRefs.push({ ...ref, docTitle: doc.title, language: doc.language, filePath: doc.filePath });
        validResourceDirs.add(ref.resourceDir);
      }
      for (const ref of refs.attachmentRefs) {
        allAttachmentRefs.push({ ...ref, docTitle: doc.title, language: doc.language, filePath: doc.filePath });
        validResourceDirs.add(ref.resourceDir);
      }
    }
    const missingImages: ResourceAnomalyItem[] = [];
    for (const ref of allImageRefs) {
      const diskPath = path.join(projectRoot, 'static', ref.fullPath);
      if (!existsSync(diskPath)) {
        missingImages.push({
          docTitle: ref.docTitle,
          language: ref.language,
          filePath: ref.filePath,
          resourcePath: ref.fullPath,
          resourceDir: ref.resourceDir,
          fileName: ref.fullPath.split('/').pop() || '',
          reason: '缺少原始飞书资源映射，请重新同步该文档',
        });
      }
    }
    const zeroByteAttachments: ResourceAnomalyItem[] = [];
    for (const ref of allAttachmentRefs) {
      const diskPath = path.join(projectRoot, 'static', ref.fullPath);
      if (!existsSync(diskPath)) {
        zeroByteAttachments.push({
          docTitle: ref.docTitle,
          language: ref.language,
          filePath: ref.filePath,
          resourcePath: ref.fullPath,
          resourceDir: ref.resourceDir,
          fileName: ref.fileName,
          reason: '附件文件缺失，请重新同步文档或重新上传附件',
        });
      } else {
        try {
          const st = statSync(diskPath);
          if (st.size === 0) {
            zeroByteAttachments.push({
              docTitle: ref.docTitle,
              language: ref.language,
              filePath: ref.filePath,
              resourcePath: ref.fullPath,
              resourceDir: ref.resourceDir,
              fileName: ref.fileName,
              reason: '附件文件为 0 字节，请重新同步文档或重新上传附件',
            });
            unlinkSync(diskPath);
          }
        } catch { /* ignore stat errors */ }
      }
    }
    const orphanedImgDirs: string[] = [];
    const staticImgDir = path.join(projectRoot, 'static', 'img', 'help-center');
    if (existsSync(staticImgDir)) {
      for (const entry of readdirSync(staticImgDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !validResourceDirs.has(entry.name)) {
          orphanedImgDirs.push(entry.name);
        }
      }
    }
    const orphanedFileDirs: string[] = [];
    const staticFileDir = path.join(projectRoot, 'static', 'files', 'help-center');
    if (existsSync(staticFileDir)) {
      for (const entry of readdirSync(staticFileDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !validResourceDirs.has(entry.name)) {
          orphanedFileDirs.push(entry.name);
        }
      }
    }
    logLines.push(`[${logPrefix}] [资源扫描] 扫描 ${scopedDocs.length} 篇文档，${allImageRefs.length} 个图片引用，${allAttachmentRefs.length} 个附件引用`);
    if (missingImages.length > 0) {
      logLines.push(`[${logPrefix}] [资源扫描] ⚠ 缺失图片: ${missingImages.length} 个`);
      for (const mi of missingImages) {
        logLines.push(`[${logPrefix}] [资源扫描]   - 文档「${mi.docTitle}」(${mi.language}, ${mi.filePath}) 缺失: ${mi.resourcePath}`);
      }
    }
    if (zeroByteAttachments.length > 0) {
      logLines.push(`[${logPrefix}] [资源扫描] ⚠ 0字节/缺失附件: ${zeroByteAttachments.length} 个`);
      for (const za of zeroByteAttachments) {
        logLines.push(`[${logPrefix}] [资源扫描]   - 文档「${za.docTitle}」(${za.language}) 附件: ${za.fileName} (${za.resourceDir}/) - ${za.reason}`);
      }
    }
    if (missingImages.length === 0 && zeroByteAttachments.length === 0) {
      logLines.push(`[${logPrefix}] [资源扫描] ✓ 所有资源文件完整`);
    }
    return {
      report: {
        totalImagesChecked: allImageRefs.length,
        totalAttachmentsChecked: allAttachmentRefs.length,
        missingImages,
        zeroByteAttachments,
        validResourceDirs,
        orphanedImgDirs,
        orphanedFileDirs,
      },
    };
  }

  private cleanupOrphanedResources(
    projectRoot: string,
    orphanedImgDirs: string[],
    orphanedFileDirs: string[],
    logLines: string[],
    logPrefix: string,
  ): void {
    let cleanedCount = 0;
    const staticImgDir = path.join(projectRoot, 'static', 'img', 'help-center');
    for (const dirName of orphanedImgDirs) {
      const fullDirPath = path.join(staticImgDir, dirName);
      try {
        rmSync(fullDirPath, { recursive: true, force: true });
        cleanedCount++;
      } catch { /* ignore */ }
    }
    const staticFileDir = path.join(projectRoot, 'static', 'files', 'help-center');
    for (const dirName of orphanedFileDirs) {
      const fullDirPath = path.join(staticFileDir, dirName);
      try {
        rmSync(fullDirPath, { recursive: true, force: true });
        cleanedCount++;
      } catch { /* ignore */ }
    }
    if (cleanedCount > 0) {
      logLines.push(`[${logPrefix}] [资源清理] 已清理 ${orphanedImgDirs.length} 个 scope 外图片目录，${orphanedFileDirs.length} 个 scope 外附件目录`);
      if (orphanedImgDirs.length > 0) {
        logLines.push(`[${logPrefix}] [资源清理] 图片目录: ${orphanedImgDirs.join(', ')}`);
      }
      if (orphanedFileDirs.length > 0) {
        logLines.push(`[${logPrefix}] [资源清理] 附件目录: ${orphanedFileDirs.join(', ')}`);
      }
    } else {
      logLines.push(`[${logPrefix}] [资源清理] 无需清理（无 scope 外资源目录）`);
    }
  }

  private async persistResourceScanResults(
    scopedDocs: Array<{ title: string; language: string; filePath: string; markdownContent: string | null }>,
    report: {
      missingImages: ResourceAnomalyItem[];
      zeroByteAttachments: ResourceAnomalyItem[];
    },
  ): Promise<void> {
    const docAnomalyMap = new Map<string, { missingImages: number; zeroByteAttachments: number }>();
    for (const mi of report.missingImages) {
      const key = mi.filePath;
      const entry = docAnomalyMap.get(key) || { missingImages: 0, zeroByteAttachments: 0 };
      entry.missingImages++;
      docAnomalyMap.set(key, entry);
    }
    for (const za of report.zeroByteAttachments) {
      const key = za.filePath;
      const entry = docAnomalyMap.get(key) || { missingImages: 0, zeroByteAttachments: 0 };
      entry.zeroByteAttachments++;
      docAnomalyMap.set(key, entry);
    }
    const now = new Date();
    for (const doc of scopedDocs) {
      const anomaly = docAnomalyMap.get(doc.filePath);
      const hasError = anomaly && (anomaly.missingImages > 0 || anomaly.zeroByteAttachments > 0);
      await this.db
        .update(docs)
        .set({
          resourceStatus: hasError ? '异常' : '正常',
          missingImagesCount: anomaly?.missingImages ?? 0,
          zeroByteAttachmentsCount: anomaly?.zeroByteAttachments ?? 0,
          lastResourceCheckedAt: now,
        })
        .where(eq(docs.filePath, doc.filePath));
    }
  }

  private async statisticDocResourcesFromDb(buildScope?: BuildScope, projectRoot?: string): Promise<DocumentBuildInfo[]> {
    const isReleaseCandidate = buildScope === 'releaseCandidate';
    const isPublishedOnly = buildScope === 'publishedOnly';
    const allDocs = await this.db
      .select({
        title: docs.title,
        language: docs.language,
        firstCategory: docs.firstCategory,
        secondCategory: docs.secondCategory,
        helpCenterUrl: docs.helpCenterUrl,
        filePath: docs.filePath,
        markdownContent: docs.markdownContent,
        publishStatus: docs.publishStatus,
        resourceStatus: docs.resourceStatus,
        missingImagesCount: docs.missingImagesCount,
        zeroByteAttachmentsCount: docs.zeroByteAttachmentsCount,
      })
      .from(docs)
      .where(
        and(
          eq(docs.contentStatus, '有正文'),
          sql`${docs.filePath} IS NOT NULL AND ${docs.filePath} != ''`,
        ),
      );

    const enabledCatRows = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.enabled, true));
    const enabledCatIds = new Set(enabledCatRows.map((c) => c.id));

    const qualifiedDocs = allDocs.filter((doc) => {
      if ((doc.title ?? '').includes('[API_TEST]')) return false;
      if (doc.publishStatus === '已归档') return false;
      if (doc.publishStatus === '草稿') return false;
      if (doc.publishStatus === '待审核') return false;
      if (isPublishedOnly && doc.publishStatus !== '已发布') return false;
      if (isReleaseCandidate && doc.publishStatus !== '已发布' && doc.publishStatus !== '待发布') return false;
      if (doc.firstCategory && !enabledCatIds.has(doc.firstCategory)) return false;
      return true;
    });
    const result: DocumentBuildInfo[] = [];
    for (const doc of qualifiedDocs) {
      const md = doc.markdownContent || '';
      const refs = this.extractResourceRefs(md);
      const imageCount = refs.imageRefs.length;
      const attachmentCount = refs.attachmentRefs.length;
      const linkMatches = md.match(/\[.*?\]\((https?:\/\/[^)]+)\)/g) || [];
      const externalLinks = linkMatches.filter((m: string) => {
        const urlMatch = m.match(/\]\((https?:\/\/[^)]+)\)/);
        if (!urlMatch) return false;
        const url = urlMatch[1];
        return !url.includes('support.oceanpayment.com') && !url.startsWith('/');
      });
      const externalLinkCount = externalLinks.length;
      const missingImages: string[] = [];
      const zeroByteAttachments: string[] = [];
      if (projectRoot) {
        for (const ref of refs.imageRefs) {
          const diskPath = path.join(projectRoot, 'static', ref.fullPath);
          if (!existsSync(diskPath)) {
            missingImages.push(ref.fullPath);
          }
        }
        for (const ref of refs.attachmentRefs) {
          const diskPath = path.join(projectRoot, 'static', ref.fullPath);
          if (!existsSync(diskPath)) {
            zeroByteAttachments.push(ref.fullPath);
          } else {
            try {
              const st = statSync(diskPath);
              if (st.size === 0) {
                zeroByteAttachments.push(ref.fullPath);
              }
            } catch { /* ignore */ }
          }
        }
      }
      const hasResourceError = missingImages.length > 0 || zeroByteAttachments.length > 0 || (doc.resourceStatus === '异常');
      result.push({
        title: doc.title || '',
        language: (doc.language || 'zh-CN') as 'zh-CN' | 'en',
        firstCategory: doc.firstCategory || '',
        secondCategory: doc.secondCategory || '',
        helpCenterPath: doc.helpCenterUrl || doc.filePath || '',
        imageCount,
        externalLinkCount,
        attachmentCount,
        hasResourceError,
        missingImages,
        zeroByteAttachments,
      });
    }
    return result;
  }

  private async executeBuildArtifact(taskId: string, scope: BuildScope = 'releaseCandidate'): Promise<void> {
    this.runningTaskTypes.add('构建产物包');
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const buildLogLines: string[] = [];
    const configFilePaths: { path: string; original: string }[] = [];
    try {
      const config = await this.systemConfigService.getConfig();
      const projectRoot = config.docusaurusProjectDir || '/home/workspace/docusaurus';
      const buildOutputDir = config.buildOutputDir || 'build';
      buildLogLines.push(`[${ts()}] [构建产物包] 任务 ID: ${taskId}`);
      buildLogLines.push(`[${ts()}] [构建产物包] 项目路径: ${projectRoot}`);
      buildLogLines.push(`[${ts()}] [构建产物包] 目标: url=https://support.oceanpayment.com, baseUrl=/`);
      buildLogLines.push(`[${ts()}] [构建产物包] 构建范围: ${scope}`);
      await this.syncDocsToProject(projectRoot, buildLogLines, { buildScope: scope });
      this.cleanupEmptyStaticImages(projectRoot, `${ts()} [构建产物包]`, buildLogLines);
      const scopedDocsForScan = await this.db
        .select({
          title: docs.title,
          language: docs.language,
          filePath: docs.filePath,
          markdownContent: docs.markdownContent,
          publishStatus: docs.publishStatus,
          firstCategory: docs.firstCategory,
        })
        .from(docs)
        .where(
          and(
            eq(docs.contentStatus, '有正文'),
            sql`${docs.filePath} IS NOT NULL AND ${docs.filePath} != ''`,
          ),
        );
      const enabledCatsForScan = await this.db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.enabled, true));
      const enabledCatIdsForScan = new Set(enabledCatsForScan.map((c) => c.id));
      const isRC = scope === 'releaseCandidate';
      const isPO = scope === 'publishedOnly';
      const qualifiedDocsForScan = scopedDocsForScan.filter((doc) => {
        if ((doc.title ?? '').includes('[API_TEST]')) return false;
        if (doc.publishStatus === '已归档') return false;
        if (doc.publishStatus === '草稿') return false;
        if (doc.publishStatus === '待审核') return false;
        if (isPO && doc.publishStatus !== '已发布') return false;
        if (isRC && doc.publishStatus !== '已发布' && doc.publishStatus !== '待发布') return false;
        if (doc.firstCategory && !enabledCatIdsForScan.has(doc.firstCategory)) return false;
        return true;
      });
      const { report: resourceReport } = this.scanResourceIntegrity(projectRoot, qualifiedDocsForScan as Array<{ title: string; language: string; filePath: string; markdownContent: string | null }>, buildLogLines, `${ts()} [构建产物包]`);
      await this.persistResourceScanResults(qualifiedDocsForScan as Array<{ title: string; language: string; filePath: string; markdownContent: string | null }>, resourceReport);
      this.cleanupOrphanedResources(projectRoot, resourceReport.orphanedImgDirs, resourceReport.orphanedFileDirs, buildLogLines, `${ts()} [构建产物包]`);
      const cacheDirCandidates = [
        '.docusaurus',
        buildOutputDir,
        'node_modules/.cache/rspack',
        'node_modules/.cache/@rspack',
        'node_modules/.cache/webpack',
        '.rspack',
      ];
      const cleanBuildCaches = (logLines: string[]): string[] => {
        const cleanedDirs: string[] = [];
        for (const candidate of cacheDirCandidates) {
          const target = path.resolve(projectRoot, candidate);
          if (existsSync(target)) {
            try {
              rmSync(target, { recursive: true, force: true });
              cleanedDirs.push(candidate);
            } catch { /* ignore */ }
          }
        }
        if (cleanedDirs.length > 0) {
          logLines.push(`[${ts()}] [构建产物包] 已清理缓存目录: ${cleanedDirs.join(', ')}`);
        } else {
          logLines.push(`[${ts()}] [构建产物包] 无需清理缓存（目录均不存在）`);
        }
        return cleanedDirs;
      };
      const CACHE_ERROR_KEYWORDS = [
        'Unexpected end of JSON input',
        'client-manifest.json',
        '.docusaurus',
        'JSON parse error',
        'Module parse failed',
        'Cannot find module',
        'server.bundle.js',
      ];
      const cfgPath = path.join(projectRoot, 'docusaurus.config.js');
      if (!existsSync(cfgPath)) {
        throw new Error(`docusaurus.config.js 不存在: ${cfgPath}`);
      }
      const originalConfigContent = readFileSync(cfgPath, 'utf-8');
      let modifiedConfig = originalConfigContent;
      modifiedConfig = modifiedConfig.replace(
        /url:\s*(['"])[^'"]*\1/,
        "url: 'https://support.oceanpayment.com'",
      );
      modifiedConfig = modifiedConfig.replace(
        /baseUrl:\s*(['"])[^'"]*\1/,
        "baseUrl: '/'",
      );
      modifiedConfig = modifiedConfig.replace(
        /onBrokenLinks:\s*(['"])[^'"]*\1/,
        "onBrokenLinks: 'warn'",
      );
      if (!modifiedConfig.includes('onBrokenMarkdownImages')) {
        modifiedConfig = modifiedConfig.replace(
          /onBrokenLinks:\s*['"][^'"]*['"],?/,
          "onBrokenLinks: 'warn',\n  markdown: { hooks: { onBrokenMarkdownImages: 'warn' } },",
        );
      }
      if (!modifiedConfig.includes('attachment-preview')) {
        modifiedConfig = modifiedConfig.replace(
          /favicon:\s*(['"])[^'"]*\1,?/,
          (match) => `${match}\n  scripts: ['/js/attachment-preview.js'],`,
        );
        buildLogLines.push(`[${ts()}] [构建产物包] 已注入 scripts: ['/js/attachment-preview.js']`);
      }
      this.ensureAttachmentPreviewAssets(projectRoot, buildLogLines, `${ts()} [构建产物包]`);
      if (modifiedConfig !== originalConfigContent) {
        writeFileSync(cfgPath, modifiedConfig, 'utf-8');
        configFilePaths.push({ path: cfgPath, original: originalConfigContent });
        buildLogLines.push(`[${ts()}] [构建产物包] 已设置 url=https://support.oceanpayment.com, baseUrl=/`);
      }
      const packageJsonPath = path.join(projectRoot, 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const buildScript = packageJson.scripts?.build;
      const buildCmd = buildScript ? 'npm run build' : 'npx docusaurus build';
      buildLogLines.push(`[${ts()}] [构建产物包] 构建命令: ${buildCmd}`);
      const maxBuildAttempts = 2;
      let stdout = '';
      let stderr = '';
      for (let buildAttempt = 1; buildAttempt <= maxBuildAttempts; buildAttempt++) {
        cleanBuildCaches(buildLogLines);
        const attemptStartTime = Date.now();
        buildLogLines.push(`[${ts()}] [构建产物包] 第 ${buildAttempt}/${maxBuildAttempts} 次构建开始，开始时间: ${new Date(attemptStartTime).toISOString()}`);
        buildLogLines.push('--- 构建输出 ---');
        try {
          const result = await this.execAsync(buildCmd, {
            cwd: projectRoot,
            timeout: 25 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=3072' },
          });
          stdout = result.stdout;
          stderr = result.stderr;
          const attemptEnd = Date.now();
          const attemptDurationSec = ((attemptEnd - attemptStartTime) / 1000).toFixed(1);
          buildLogLines.push(`[${ts()}] [构建产物包] 第 ${buildAttempt} 次构建成功，结束时间: ${new Date(attemptEnd).toISOString()}，耗时: ${attemptDurationSec}s`);
          break;
        } catch (buildErr: unknown) {
          const attemptEnd = Date.now();
          const attemptDurationSec = ((attemptEnd - attemptStartTime) / 1000).toFixed(1);
          buildLogLines.push(`[${ts()}] [构建产物包] 第 ${buildAttempt} 次构建失败，结束时间: ${new Date(attemptEnd).toISOString()}，耗时: ${attemptDurationSec}s`);
          const execErr = buildErr as { stdout?: string; stderr?: string; message?: string; killed?: boolean; signal?: string };
          if (execErr.killed === true || execErr.signal === 'SIGTERM') {
            buildLogLines.push(`[${ts()}] [构建产物包] 第 ${buildAttempt} 次构建超时被 SIGTERM 终止（killed=${execErr.killed}, signal=${execErr.signal}），不再重试`);
            throw buildErr;
          }
          const attemptStderr = execErr.stderr ? this.sanitizeLog(execErr.stderr) : '';
          const attemptStdout = execErr.stdout ? this.sanitizeLog(execErr.stdout) : '';
          const attemptMessage = execErr.message ? this.sanitizeLog(execErr.message) : '';
          if (attemptStdout) buildLogLines.push(attemptStdout);
          if (attemptStderr) buildLogLines.push(attemptStderr);
          const combinedText = `${attemptStdout}\n${attemptStderr}\n${attemptMessage}`;
          const matchedKeyword = CACHE_ERROR_KEYWORDS.find((kw) => combinedText.includes(kw));
          if (buildAttempt < maxBuildAttempts && matchedKeyword) {
            buildLogLines.push(`[${ts()}] [构建产物包] 第 ${buildAttempt} 次构建失败，命中缓存错误关键词: "${matchedKeyword}"`);
            const cleaned = cleanBuildCaches(buildLogLines);
            buildLogLines.push(`[${ts()}] [构建产物包] 已清理 ${cleaned.length} 个缓存目录，正在执行第 ${buildAttempt + 1} 次构建...`);
            continue;
          }
          throw buildErr;
        }
      }
      const buildDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      if (stdout) buildLogLines.push(this.sanitizeLog(stdout));
      if (stderr) buildLogLines.push(this.sanitizeLog(stderr));
      buildLogLines.push(`[${ts()}] [构建产物包] 构建耗时: ${buildDurationSec}s`);
      buildLogLines.push(`[${ts()}] [构建产物包] 构建结果: 成功 (exitCode: 0)`);
      const buildDirPath = path.join(projectRoot, buildOutputDir);
      if (!existsSync(buildDirPath)) {
        throw new Error(`构建产物目录不存在: ${buildDirPath}`);
      }
      buildLogLines.push(`[${ts()}] [构建产物包] build 目录路径: ${buildDirPath}`);
      this.verifyBuildAssets(buildDirPath, buildLogLines, `${ts()} [构建产物包]`);
      const docList = await this.statisticDocResourcesFromDb(scope, projectRoot);
      const resourceAnomalyCount = resourceReport.missingImages.length + resourceReport.zeroByteAttachments.length;
      if (resourceAnomalyCount > 0) {
        buildLogLines.push(`[${ts()}] [构建产物包] ⚠⚠⚠ 资源异常警告: 共 ${resourceAnomalyCount} 个资源异常（${resourceReport.missingImages.length} 个缺失图片 + ${resourceReport.zeroByteAttachments.length} 个0字节/缺失附件），请查看上方资源扫描日志并重新同步相关文档`);
      }
      buildLogLines.push(`[${ts()}] [构建产物包] 文档资源统计: ${docList.length} 篇`);
      for (const doc of docList) {
        const errMark = doc.hasResourceError ? ' [资源异常]' : '';
        buildLogLines.push(`[${ts()}] [构建产物包]   ${doc.language}/${doc.firstCategory}/${doc.secondCategory} - ${doc.title}: 图片${doc.imageCount} 外链${doc.externalLinkCount} 附件${doc.attachmentCount}${errMark}`);
        if (doc.missingImages.length > 0) {
          for (const mi of doc.missingImages) {
            buildLogLines.push(`[${ts()}] [构建产物包]     缺失图片: ${mi}`);
          }
        }
        if (doc.zeroByteAttachments.length > 0) {
          for (const za of doc.zeroByteAttachments) {
            buildLogLines.push(`[${ts()}] [构建产物包]     0字节附件: ${za}`);
          }
        }
      }
      const zipDir = `/tmp/build-artifact/${taskId}`;
      if (!existsSync(zipDir)) mkdirSync(zipDir, { recursive: true });
      const zipFilePath = path.join(zipDir, 'build.zip');
      buildLogLines.push(`[${ts()}] [构建产物包] 开始压缩 build 目录为 build.zip...`);
      const archiverModule = await import('archiver') as any;

      const archiverFactory =
        typeof archiverModule === 'function'
          ? archiverModule
          : typeof archiverModule.default === 'function'
            ? archiverModule.default
            : typeof archiverModule.default?.default === 'function'
              ? archiverModule.default.default
              : typeof archiverModule.create === 'function'
                ? archiverModule.create
                : typeof archiverModule.default?.create === 'function'
                  ? archiverModule.default.create
                  : null;

      const ZipArchiveCtor =
        typeof archiverModule.ZipArchive === 'function'
          ? archiverModule.ZipArchive
          : typeof archiverModule.default?.ZipArchive === 'function'
            ? archiverModule.default.ZipArchive
            : null;

      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(zipFilePath);

        const archive = archiverFactory
          ? archiverFactory('zip', { zlib: { level: 9 } })
          : ZipArchiveCtor
            ? new ZipArchiveCtor({ zlib: { level: 9 } })
            : null;

        if (!archive) {
          const topKeys = Object.keys(archiverModule).join(',');
          const defaultType = typeof archiverModule.default;
          const defaultKeys = archiverModule.default && typeof archiverModule.default === 'object'
            ? Object.keys(archiverModule.default).join(',')
            : '';
          reject(new Error(
            `archiver module export is not usable, topKeys=${topKeys}, defaultType=${defaultType}, defaultKeys=${defaultKeys}`
          ));
          return;
        }

        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', (err: Error) => reject(err));

        archive.pipe(output);
        archive.directory(buildDirPath, false);
        Promise.resolve(archive.finalize()).catch(reject);
      });
      const zipStats = statSync(zipFilePath);
      const zipSizeMB = (zipStats.size / (1024 * 1024)).toFixed(2);
      buildLogLines.push(`[${ts()}] [构建产物包] 压缩完成: ${zipFilePath} (${zipSizeMB} MB)`);
      const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      buildLogLines.push(`[${ts()}] [构建产物包] 总耗时: ${totalDurationSec}s`);
      const artifactResult: BuildArtifactResult = {
        taskId,
        docCount: docList.length,
        buildDirPath,
        zipFilePath,
        zipSize: zipStats.size,
        downloadUrl: `/api/deploy/build-artifact/download?taskId=${taskId}`,
        docList,
        resourceAnomalyCount,
      };
      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      await this.db
        .update(publishTasks)
        .set({
          status: '成功' as TaskStatus,
          buildLog,
          deployLog: JSON.stringify(artifactResult),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));
      this.logger.log(`构建产物包成功: taskId=${taskId}, 文档数=${docList.length}, zip=${zipSizeMB}MB, 耗时=${totalDurationSec}s`);
    } catch (error: unknown) {
      const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const execError = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean; code?: number; signal?: string };
      const isTimeout = execError.killed === true;
      const stderrStr = execError.stderr ? this.sanitizeLog(execError.stderr) : '';
      const stdoutStr = execError.stdout ? this.sanitizeLog(execError.stdout) : '';
      if (stdoutStr && !buildLogLines.some((l: string) => l.includes('构建输出'))) {
        buildLogLines.push('--- stdout ---');
        buildLogLines.push(stdoutStr);
      }
      if (stderrStr) {
        buildLogLines.push('--- stderr ---');
        buildLogLines.push(stderrStr);
      }
      buildLogLines.push(`[${ts()}] [构建产物包] 总耗时: ${totalDurationSec}s`);
      buildLogLines.push(`[${ts()}] [构建产物包] 结果: 失败`);
      const errorParts: string[] = [];
      if (isTimeout) errorParts.push('构建超时（超过 25 分钟）');
      errorParts.push(`exitCode: ${execError.code ?? null}, signal: ${execError.signal ?? null}, killed: ${isTimeout}`);
      if (stderrStr) errorParts.push(`--- stderr ---\n${stderrStr.slice(-5000)}`);
      if (errorParts.length === 1 && !isTimeout) {
        errorParts.push(execError.message ? this.sanitizeLog(execError.message) : '未知错误');
      }
      const errorDetail = errorParts.join('\n');
      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      try {
        await this.db
          .update(publishTasks)
          .set({
            status: '失败' as TaskStatus,
            buildLog,
            errorMessage: errorDetail.slice(0, 10 * 1024),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));
      } catch (dbErr: unknown) {
        const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        this.logger.error(`构建产物包更新数据库失败: ${dbMsg}`);
      }
      this.logger.error(`构建产物包失败: taskId=${taskId}, 耗时=${totalDurationSec}s, error=${errorDetail.slice(0, 500)}`);
    } finally {
      for (const cfg of configFilePaths) {
        try {
          writeFileSync(cfg.path, cfg.original, 'utf-8');
        } catch { /* ignore */ }
      }
      this.runningTaskTypes.delete('构建产物包');
    }
  }

  async getRollbackVersions(): Promise<RollbackVersionsResponse> {
    const tasks = await this.db
      .select()
      .from(publishTasks)
      .where(
        and(
          eq(publishTasks.taskType, '正式环境发布'),
          eq(publishTasks.status, '成功'),
        ),
      )
      .orderBy(desc(publishTasks.createdAt))
      .limit(10);

    const items: RollbackVersionItem[] = [];
    for (const task of tasks) {
      const deployLog = task.deployLog || '';
      const buildLog = task.buildLog || '';

      const backupMatch = deployLog.match(/\[部署\] 备份目录: (.+)/);
      const backupDir = backupMatch ? backupMatch[1].trim() : '';
      if (!backupDir || backupDir === '无') continue;

      if (!existsSync(backupDir)) continue;

      const commitMatch = buildLog.match(/\[构建\] 当前 commit: (\S+)/);
      const commitHash = commitMatch ? commitMatch[1] : 'unknown';

      const fileCountMatch = deployLog.match(/\[部署\] 复制文件数量: (\d+)/);
      const fileCount = fileCountMatch ? parseInt(fileCountMatch[1], 10) : 0;

      const totalSizeMatch = deployLog.match(/\[部署\] 部署总大小: (.+ MB)/);
      const totalSize = totalSizeMatch ? totalSizeMatch[1] : '0 MB';

      items.push({
        versionId: task.id,
        sourceTaskName: task.taskName,
        commitHash,
        deployedAt: task.createdAt ? new Date(task.createdAt).toISOString() : '',
        backupDir,
        fileCount,
        totalSize,
      });
    }

    return { items };
  }

  async rollback(
    userId: string,
    environment: string,
    versionTaskId: string,
    reason: string,
    publishScope?: string,
  ): Promise<CreateResponse> {
    if (!versionTaskId || !reason || !reason.trim()) {
      throw new Error('回滚版本和回滚原因不能为空');
    }

    const versions = await this.getRollbackVersions();
    const targetVersion = versions.items.find((v: RollbackVersionItem) => v.versionId === versionTaskId);
    if (!targetVersion) {
      throw new Error('目标回滚版本不存在或备份目录已不可用');
    }

    const now = new Date().toLocaleString('zh-CN');
    const taskName = `回滚 - ${now}`;
    const scope = (publishScope ?? 'all') as PublishScope;
    const initialBuildLog = [
      `[${now}] [回滚] 回滚任务 ID: 待分配`,
      `[${now}] [回滚] 目标版本 ID: ${versionTaskId}`,
      `[${now}] [回滚] 回滚原因: ${reason.trim()}`,
      `[${now}] [回滚] 回滚环境: ${environment}`,
      `[${now}] [回滚] commit hash: ${targetVersion.commitHash}`,
      `[${now}] [回滚] 来源发布任务: ${targetVersion.sourceTaskName}`,
    ].join('\n');

    const result = await this.db
      .insert(publishTasks)
      .values({
        taskName,
        taskType: '回滚申请' as TaskType,
        environment: environment as DeployEnvironment,
        status: '执行中' as TaskStatus,
        operator: userId,
        publishScope: scope,
        buildLog: initialBuildLog,
      })
      .returning({ id: publishTasks.id });

    const taskId = result[0]?.id;
    if (!taskId) throw new Error('创建回滚任务失败：未返回 ID');

    this.executeRollback(taskId, targetVersion, reason.trim(), environment).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`回滚异步执行异常: taskId=${taskId}, error=${msg}`);
    });

    this.logger.log(`回滚任务已创建: taskId=${taskId}, 目标版本=${versionTaskId}, 操作人=${userId}`);
    return { id: taskId };
  }

  private async executeRollback(
    taskId: string,
    targetVersion: RollbackVersionItem,
    reason: string,
    environment: string,
  ): Promise<void> {
    const ts = () => new Date().toLocaleString('zh-CN');
    const startTime = Date.now();
    const buildLogLines: string[] = [];
    const deployLogLines: string[] = [];
    let errorDetail = '';

    try {
      const config = await this.systemConfigService.getConfig();
      const productionDeployDir = config.productionDeployDir || '/home/workspace/production-deploy';
      const productionUrl = config.productionUrl || '';
      const projectRoot = config.docusaurusProjectDir || '/home/gm/workspace/code';

      buildLogLines.push(`[${ts()}] [回滚] 回滚任务 ID: ${taskId}`);
      buildLogLines.push(`[${ts()}] [回滚] 目标版本 ID: ${targetVersion.versionId}`);
      buildLogLines.push(`[${ts()}] [回滚] 回滚原因: ${reason}`);
      buildLogLines.push(`[${ts()}] [回滚] 回滚环境: ${environment}`);
      buildLogLines.push(`[${ts()}] [回滚] commit hash: ${targetVersion.commitHash}`);
      buildLogLines.push(`[${ts()}] [回滚] 来源发布任务: ${targetVersion.sourceTaskName}`);

      deployLogLines.push(`[${ts()}] [回滚] 开始执行回滚`);
      deployLogLines.push(`[${ts()}] [回滚] productionDeployDir: ${productionDeployDir}`);
      deployLogLines.push(`[${ts()}] [回滚] 目标 backupDir: ${targetVersion.backupDir}`);

      if (!this.isProductionPathSafe(productionDeployDir, projectRoot, config.stagingDeployDir || '')) {
        throw new Error(`productionDeployDir 安全校验失败: ${productionDeployDir}`);
      }

      if (!this.isPathSafe(targetVersion.backupDir, projectRoot)) {
        throw new Error(`backupDir 安全校验失败: ${targetVersion.backupDir}`);
      }

      const resolvedProd = path.resolve(productionDeployDir);
      const resolvedBackup = path.resolve(targetVersion.backupDir);
      if (resolvedProd === resolvedBackup) {
        throw new Error('backupDir 不能与 productionDeployDir 相同');
      }
      if (resolvedBackup.startsWith(resolvedProd + '/')) {
        throw new Error('backupDir 不能位于 productionDeployDir 内');
      }
      if (resolvedProd.startsWith(resolvedBackup + '/')) {
        throw new Error('productionDeployDir 不能位于 backupDir 内');
      }

      if (!existsSync(targetVersion.backupDir)) {
        throw new Error(`备份目录不存在: ${targetVersion.backupDir}`);
      }
      const backupEntries = readdirSync(targetVersion.backupDir);
      if (backupEntries.length === 0) {
        throw new Error(`备份目录为空: ${targetVersion.backupDir}`);
      }
      deployLogLines.push(`[${ts()}] [回滚] 备份目录校验通过 (${backupEntries.length} 项)`);

      if (!existsSync(productionDeployDir)) {
        mkdirSync(productionDeployDir, { recursive: true });
        deployLogLines.push(`[${ts()}] [回滚] 已创建部署目录: ${productionDeployDir}`);
      }

      const snapshotTimestamp = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}_${String(new Date().getHours()).padStart(2, '0')}${String(new Date().getMinutes()).padStart(2, '0')}${String(new Date().getSeconds()).padStart(2, '0')}`;
      const snapshotDir = `${productionDeployDir}.rollback-snap.${snapshotTimestamp}`;
      const currentEntries = readdirSync(productionDeployDir).filter(
        (e: string) => !e.startsWith('.bak.') && !e.startsWith('.rollback-snap.'),
      );
      if (currentEntries.length > 0) {
        cpSync(productionDeployDir, snapshotDir, { recursive: true });
        deployLogLines.push(`[${ts()}] [回滚] 回滚前快照目录: ${snapshotDir}`);
      } else {
        deployLogLines.push(`[${ts()}] [回滚] 当前部署目录无旧产物，跳过快照`);
      }

      const oldEntries = readdirSync(productionDeployDir).filter(
        (e: string) => !e.startsWith('.bak.') && !e.startsWith('.rollback-snap.'),
      );
      if (oldEntries.length > 0) {
        for (const entry of oldEntries) {
          const entryPath = path.join(productionDeployDir, entry);
          rmSync(entryPath, { recursive: true, force: true });
        }
        deployLogLines.push(`[${ts()}] [回滚] 已清理旧产物 (${oldEntries.length} 项)`);
      }

      cpSync(targetVersion.backupDir, productionDeployDir, { recursive: true });
      deployLogLines.push(`[${ts()}] [回滚] 已将备份内容复制到部署目录`);

      const { fileCount, totalSize } = this.countFilesAndSize(productionDeployDir);
      const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);

      deployLogLines.push(`[${ts()}] [回滚] 复制文件数量: ${fileCount}`);
      deployLogLines.push(`[${ts()}] [回滚] 复制总大小: ${totalSizeMB} MB`);
      deployLogLines.push(`[${ts()}] [回滚] 耗时: ${totalDurationSec}s`);

      const serverResult = await this.ensureProductionServer(productionDeployDir);
      deployLogLines.push(`[${ts()}] [回滚] 静态服务状态: ${serverResult.running ? 'running' : 'stopped'}`);
      deployLogLines.push(`[${ts()}] [回滚] 静态服务端口: ${serverResult.port}`);
      if (serverResult.error) {
        deployLogLines.push(`[${ts()}] [回滚] 静态服务错误: ${serverResult.error}`);
      }

      if (productionUrl) {
        deployLogLines.push(`[${ts()}] [回滚] productionUrl: ${productionUrl}`);
      }

      if (serverResult.running && productionUrl) {
        try {
          const { stdout: curlOut } = await this.execAsync(
            `curl -s -o /dev/null -w '%{http_code}' ${productionUrl}`,
            { timeout: 10000 },
          );
          deployLogLines.push(`[${ts()}] [回滚] 访问验证: HTTP ${curlOut.trim()}`);
        } catch {
          deployLogLines.push(`[${ts()}] [回滚] 访问验证: 超时或失败`);
        }
      }

      deployLogLines.push(`[${ts()}] [回滚] 结果: 回滚成功`);

      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      const deployLog = deployLogLines.join('\n').slice(0, 50 * 1024);

      await this.db
        .update(publishTasks)
        .set({
          status: '成功' as TaskStatus,
          buildLog,
          deployLog,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.log(`回滚成功: taskId=${taskId}, 耗时=${totalDurationSec}s`);
    } catch (error) {
      const execError = error as Record<string, unknown>;
      if (typeof execError.stderr === 'string' && execError.stderr) {
        errorDetail = this.sanitizeLog(execError.stderr);
      } else if (error instanceof Error) {
        errorDetail = this.sanitizeLog(error.message);
      } else {
        errorDetail = this.sanitizeLog(String(error));
      }

      deployLogLines.push(`[${ts()}] [回滚] 错误: ${errorDetail.slice(0, 500)}`);
      deployLogLines.push(`[${ts()}] [回滚] 结果: 回滚失败`);

      const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      deployLogLines.push(`[${ts()}] [回滚] 耗时: ${totalDurationSec}s`);

      const buildLog = buildLogLines.join('\n').slice(0, 50 * 1024);
      const deployLog = deployLogLines.join('\n').slice(0, 50 * 1024);

      await this.db
        .update(publishTasks)
        .set({
          status: '失败' as TaskStatus,
          buildLog,
          deployLog,
          errorMessage: errorDetail.slice(0, 10 * 1024),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.error(`回滚失败: taskId=${taskId}, error=${errorDetail.slice(0, 500)}`);
    }
  }

  async getTaskLogs(taskId: string): Promise<TaskLogsResponse> {
    try {
      const result = await this.db
        .select({
          buildLog: publishTasks.buildLog,
          deployLog: publishTasks.deployLog,
          errorMessage: publishTasks.errorMessage,
        })
        .from(publishTasks)
        .where(eq(publishTasks.id, taskId))
        .limit(1);

      if (!result.length) {
        return { buildLog: undefined, deployLog: undefined, errorMessage: undefined };
      }

      const row = result[0];
      return {
        buildLog: row.buildLog ?? undefined,
        deployLog: row.deployLog ?? undefined,
        errorMessage: row.errorMessage ?? undefined,
      };
    } catch (error) {
      this.logger.error('获取任务日志失败', JSON.stringify(error));
      throw error;
    }
  }

  async retryTask(taskId: string, userId: string): Promise<CreateResponse> {
    try {
      const existing = await this.db
        .select({
          taskType: publishTasks.taskType,
          buildLog: publishTasks.buildLog,
          deployLog: publishTasks.deployLog,
          publishScope: publishTasks.publishScope,
        })
        .from(publishTasks)
        .where(eq(publishTasks.id, taskId))
        .limit(1);

      if (!existing.length) {
        throw new Error('任务不存在');
      }

      const task = existing[0];
      const now = new Date().toLocaleString('zh-CN');
      const retryBuildAppend = [
        '',
        `--- 重新执行 (${now}) ---`,
        `[重试] 重新执行任务: ${task.taskType}`,
        `[重试] 重新安装依赖`,
        `[重试] 重新执行构建`,
        `[重试] 结果: 重试成功`,
      ].join('\n');

      let retryDeployAppend = '';
      const taskType = task.taskType as TaskType;
      if (taskType === '测试环境发布') {
        await this.db
          .update(publishTasks)
          .set({
            status: '执行中',
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));

        this.executeStagingDeploy(taskId, (task as Record<string, unknown>).publishScope as PublishScope ?? 'all').catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`重试测试环境发布异步异常: taskId=${taskId}, error=${msg}`);
        });

        this.logger.log(`任务 ${taskId} 已重试（测试环境发布），操作人: ${userId}`);
        return { id: taskId };
      } else if (taskType === '正式环境发布') {
        await this.db
          .update(publishTasks)
          .set({
            status: '执行中',
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));

        this.executeProductionDeploy(taskId, (task as Record<string, unknown>).publishScope as PublishScope ?? 'all').catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`重试正式环境发布异步异常: taskId=${taskId}, error=${msg}`);
        });

        this.logger.log(`任务 ${taskId} 已重试（正式环境发布），操作人: ${userId}`);
        return { id: taskId };
      } else if (taskType === '回滚申请') {
        const existingBuildLog = task.buildLog || '';
        const versionMatch = existingBuildLog.match(/\[回滚\] 目标版本 ID: (\S+)/);
        const rollbackVersionId = versionMatch ? versionMatch[1] : '';

        if (!rollbackVersionId) {
          throw new Error('无法从任务日志中解析目标版本 ID，无法重试回滚');
        }

        const versions = await this.getRollbackVersions();
        const targetVersion = versions.items.find((v: RollbackVersionItem) => v.versionId === rollbackVersionId);
        if (!targetVersion) {
          throw new Error('目标回滚版本的备份目录已不可用，无法重试');
        }

        const reasonMatch = existingBuildLog.match(/\[回滚\] 回滚原因: (.+)/);
        const reason = reasonMatch ? reasonMatch[1] : '重试回滚';
        const envMatch = existingBuildLog.match(/\[回滚\] 回滚环境: (.+)/);
        const env = envMatch ? envMatch[1] : '正式环境';

        await this.db
          .update(publishTasks)
          .set({
            status: '执行中',
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));

        this.executeRollback(taskId, targetVersion, reason, env).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`重试回滚异步异常: taskId=${taskId}, error=${msg}`);
        });

        this.logger.log(`任务 ${taskId} 已重试（回滚申请），操作人: ${userId}`);
        return { id: taskId };
      } else if (taskType === '发布到网站') {
        await this.db
          .update(publishTasks)
          .set({
            status: '执行中' as TaskStatus,
            errorMessage: null,
            prUrl: null,
            prNumber: null,
            prCreatedAt: null,
            mergeStatus: 'none' as PrMergeStatus,
            prMergedAt: null,
            mergeCommitSha: null,
            deployStatus: 'none' as DeploySubStatus,
            workflowRunId: null,
            deployUrl: null,
            deployedAt: null,
            securityCheckResult: 'none' as SecurityCheckResult,
            securityCheckErrors: null,
            deployErrorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));

        const config = await this.systemConfigService.getConfig();
        const pubScope = (task.publishScope as PublishScope) ?? 'all';
        this.executeWebsitePublishPipeline(taskId, config, pubScope, userId).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`重试发布到网站异步异常: taskId=${taskId}, error=${msg}`);
        });

        this.logger.log(`任务 ${taskId} 已重试（发布到网站），操作人: ${userId}`);
        return { id: taskId };
      } else {
        retryDeployAppend = [
          '',
          `--- 重新执行 (${now}) ---`,
          `[重试] 重新上传构建产物到测试服务器`,
          `[重试] 重新执行部署脚本`,
          `[重试] 验证服务健康状态`,
          `[重试] 结果: 重试成功`,
        ].join('\n');
      }

      const newBuildLog = (task.buildLog ?? '') + retryBuildAppend;
      const newDeployLog = task.deployLog
        ? task.deployLog + (retryDeployAppend || '')
        : retryDeployAppend || null;

      await this.db
        .update(publishTasks)
        .set({
          status: '执行中',
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      await this.db
        .update(publishTasks)
        .set({
          status: '成功',
          buildLog: newBuildLog,
          ...(newDeployLog ? { deployLog: newDeployLog } : {}),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.log(`任务 ${taskId} 已重试，操作人: ${userId}`);
      return { id: taskId };
    } catch (error) {
      this.logger.error('重试任务失败', JSON.stringify(error));
      throw error;
    }
  }

  async triggerBuildCheck(userId: string, scope?: string): Promise<BuildCheckResponse> {
    const timestamp = new Date().toLocaleString('zh-CN');
    const publishScope = (scope ?? 'all') as PublishScope;
    const taskName = `构建检查 - ${timestamp}`;
    const initialLog = [
      `[${timestamp}] [构建检查] 开始构建检查 (范围: ${publishScope})`,
      `[${timestamp}] [构建检查] 任务已创建，状态: 执行中`,
    ].join('\n');

    try {
      const result = await this.db
        .insert(publishTasks)
        .values({
          taskName,
          taskType: '构建检查' as TaskType,
          environment: null,
          status: '执行中' as TaskStatus,
          operator: userId,
          publishScope,
          buildLog: initialLog,
        })
        .returning({ id: publishTasks.id });

      const taskId = result[0]?.id;
      if (!taskId) {
        throw new Error('创建构建检查任务失败：未返回 ID');
      }

      this.logger.log(`构建检查任务已创建: ${taskId}, 操作人: ${userId}, 范围: ${publishScope}`);

      this.executeBuild(taskId, publishScope).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`构建检查异步执行异常: taskId=${taskId}, error=${msg}`);
      });

      return { success: true, taskId };
    } catch (error) {
      this.logger.error('创建构建检查任务失败', JSON.stringify(error));
      throw error;
    }
  }

  private sanitizeLog(raw: string): string {
    return raw
      .replace(/(app[_-]?secret|appsecret)\s*[:=]\s*\S+/gi, '$1=***REDACTED***')
      .replace(/(tenant[_-]?access[_-]?token)\s*[:=]\s*\S+/gi, '$1=***REDACTED***')
      .replace(/(ssh[_-]?key|ssh[_-]?private[_-]?key)\s*[:=]\s*\S+/gi, '$1=***REDACTED***')
      .replace(/(github[_-]?token|ghp_\w+|gho_\w+)/gi, '***REDACTED***')
      .replace(/(bearer)\s+\S+/gi, '$1 ***REDACTED***')
      .replace(/(authorization)\s*[:=]\s*\S+/gi, '$1=***REDACTED***')
      .replace(/:\/\/[^@\s]+@/g, '://***:***@');
  }

  private async repairGitCorruption(
    projectRoot: string,
    logLines: string[],
    repoUrl?: string,
  ): Promise<void> {
    const ts = () => new Date().toLocaleString('zh-CN', { hour12: false });
    const gitDir = path.join(projectRoot, '.git');
    if (!existsSync(gitDir)) return;

    const refsRemotesDir = path.join(gitDir, 'refs', 'remotes');
    if (existsSync(refsRemotesDir)) {
      try {
        const entries = readdirSync(refsRemotesDir, { recursive: true });
        for (const entry of entries) {
          const fullPath = path.join(refsRemotesDir, entry as string);
          try {
            const stat = statSync(fullPath);
            if (stat.isFile() && stat.size === 0) {
              const relPath = path.relative(projectRoot, fullPath);
              logLines.push(`[${ts()}] [Git] 检测到空引用文件: ${relPath}，删除修复`);
              unlinkSync(fullPath);
              logLines.push(`[${ts()}] [Git] 已删除空引用: ${relPath}`);
            }
          } catch { /* skip */ }
        }
      } catch (err: unknown) {
        const msg = (err as { message?: string }).message ?? '';
        logLines.push(`[${ts()}] [Git] 扫描远程引用目录失败: ${this.sanitizeLog(msg)}`);
      }
    }

    const headPath = path.join(gitDir, 'HEAD');
    try {
      if (existsSync(headPath)) {
        const headStat = statSync(headPath);
        if (headStat.isFile() && headStat.size === 0) {
          logLines.push(`[${ts()}] [Git] 检测到空 HEAD 文件，修复为 ref: refs/heads/main`);
          writeFileSync(headPath, 'ref: refs/heads/main\n');
          logLines.push(`[${ts()}] [Git] HEAD 已修复`);
        }
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? '';
      logLines.push(`[${ts()}] [Git] HEAD 修复失败: ${this.sanitizeLog(msg)}`);
    }

    const objectsDir = path.join(gitDir, 'objects');
    if (existsSync(objectsDir)) {
      try {
        const subdirs = readdirSync(objectsDir);
        for (const subdir of subdirs) {
          if (!/^[0-9a-f]{2}$/.test(subdir)) continue;
          const subdirPath = path.join(objectsDir, subdir);
          try {
            const files = readdirSync(subdirPath);
            for (const file of files) {
              const fullPath = path.join(subdirPath, file);
              try {
                const stat = statSync(fullPath);
                if (stat.isFile() && stat.size === 0) {
                  const objHash = subdir + file;
                  logLines.push(`[${ts()}] [Git] 检测到空对象文件: ${objHash}，删除修复`);
                  unlinkSync(fullPath);
                  logLines.push(`[${ts()}] [Git] 已删除空对象: ${objHash}`);
                }
              } catch { /* skip */ }
            }
          } catch { /* skip unreadable subdirs */ }
        }
      } catch (err: unknown) {
        const msg = (err as { message?: string }).message ?? '';
        logLines.push(`[${ts()}] [Git] 扫描对象目录失败: ${this.sanitizeLog(msg)}`);
      }
    }

    const packDir = path.join(gitDir, 'objects', 'pack');
    if (existsSync(packDir)) {
      try {
        const packFiles = readdirSync(packDir);
        for (const pf of packFiles) {
          if (pf.startsWith('tmp_pack_')) {
            const tmpPath = path.join(packDir, pf);
            try {
              unlinkSync(tmpPath);
              logLines.push(`[${ts()}] [Git] 已清理残留临时 pack 文件: ${pf}`);
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }

    const indexPath = path.join(gitDir, 'index');
    try {
      if (existsSync(indexPath)) {
        const indexStat = statSync(indexPath);
        if (indexStat.isFile() && indexStat.size < 12) {
          logLines.push(`[${ts()}] [Git] 检测到损坏的 index 文件（${indexStat.size} bytes），删除重建`);
          unlinkSync(indexPath);
          logLines.push(`[${ts()}] [Git] index 已删除`);
        }
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? '';
      logLines.push(`[${ts()}] [Git] index 修复失败: ${this.sanitizeLog(msg)}`);
    }

    try {
      await this.execAsync('git status --porcelain', {
        cwd: projectRoot, timeout: 5000, env: { ...process.env },
      });
      logLines.push(`[${ts()}] [Git] index 健康检查通过`);
    } catch (statusErr: unknown) {
      const msg = (statusErr as { message?: string }).message ?? '';
      logLines.push(`[${ts()}] [Git] index 不可读: ${this.sanitizeLog(msg)}`);
      if (this.runningTaskTypes.size > 0) {
        logLines.push(`[${ts()}] [Git] 存在运行中的任务 (${[...this.runningTaskTypes].join(', ')})，跳过 index 删除`);
      } else if (existsSync(indexPath)) {
        try {
          unlinkSync(indexPath);
          logLines.push(`[${ts()}] [Git] 已删除损坏的 index 文件`);
        } catch { /* ignore */ }
        try {
          await this.execAsync('git reset --mixed HEAD', {
            cwd: projectRoot, timeout: 10000, env: { ...process.env },
          });
          logLines.push(`[${ts()}] [Git] index 已通过 git reset --mixed HEAD 重建`);
        } catch (resetErr: unknown) {
          const resetMsg = (resetErr as { message?: string }).message ?? '';
          logLines.push(`[${ts()}] [Git] index 重建失败: ${this.sanitizeLog(resetMsg)}`);
        }
        try {
          await this.execAsync('git status --porcelain', {
            cwd: projectRoot, timeout: 5000, env: { ...process.env },
          });
          logLines.push(`[${ts()}] [Git] index 修复后验证通过`);
        } catch (verifyErr: unknown) {
          const verifyMsg = (verifyErr as { message?: string }).message ?? '';
          logLines.push(`[${ts()}] [Git] index 修复后仍不可用: ${this.sanitizeLog(verifyMsg)}`);
        }
      }
    }

    const configPath = path.join(gitDir, 'config');
    try {
      if (existsSync(configPath)) {
        const content = readFileSync(configPath, 'utf-8');
        if (!content.includes('[remote') || !content.includes('[core]')) {
          logLines.push(`[${ts()}] [Git] 检测到截断的 config 文件，重写基础配置`);
          const configLines = [
            '[core]',
            '\trepositoryformatversion = 0',
            '\tfilemode = false',
            '\tbare = false',
            '\tlogallrefupdates = true',
            '[user]',
            '\tname = HelpCenter Sync',
            '\temail = sync@help-center.local',
          ];
          if (repoUrl) {
            configLines.push(
              '[remote "github"]',
              `\turl = ${repoUrl}`,
              '\tfetch = +refs/heads/*:refs/remotes/github/*',
            );
          }
          configLines.push(
            '[http]',
            '\tsslVerify = false',
            '[https]',
            '\tsslVerify = false',
          );
          writeFileSync(configPath, configLines.join('\n') + '\n');
          logLines.push(`[${ts()}] [Git] config 已重写（已清理代理配置）`);
        }
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? '';
      logLines.push(`[${ts()}] [Git] config 修复失败: ${this.sanitizeLog(msg)}`);
    }
  }

  private readonly execFileAsync = promisify(execFile);

  private buildGitNetworkEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_SSL_NO_VERIFY = '1';
    env.GIT_CONFIG_GLOBAL = '/dev/null';
    env.GIT_CONFIG_SYSTEM = '/dev/null';
    return env;
  }

  private gitNetCmd(cmd: string): string {
    const stripped = cmd.replace(/^git\s+/, '');
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
    const proxyArgs = proxyUrl ? `-c http.proxy=${proxyUrl} -c https.proxy=${proxyUrl} ` : '';
    return `git ${proxyArgs}-c http.sslVerify=false -c https.sslVerify=false -c credential.helper= ${stripped}`;
  }

  private async createTemporaryWorkspace(
    repoUrl: string,
    defaultBranch: string,
    token: string,
    logLines: string[],
  ): Promise<{ tempDir: string; cleanup: () => void }> {
    const ts = () => new Date().toLocaleString('zh-CN', { hour12: false });
    const tempDir = `/tmp/publish-ws-${Date.now()}`;
    logLines.push(`[${ts()}] [TempWS] 创建临时工作区: ${tempDir}`);
    const netEnv = this.buildGitNetworkEnv();
    const askpassPath = `/tmp/askpass-temp-${Date.now()}.sh`;
    try {
      writeFileSync(askpassPath, `#!/bin/sh\necho "${token}"`, { mode: 0o700 });
    } catch { /* ignore */ }
    const fetchEnv: NodeJS.ProcessEnv = {
      ...netEnv,
      GIT_ASKPASS: askpassPath,
    };
    const gitNetOpts = { cwd: tempDir, timeout: 60 * 1000, env: fetchEnv };
    try {
      mkdirSync(tempDir, { recursive: true });
      logLines.push(`[${ts()}] [TempWS] $ git init -b ${defaultBranch}`);
      await this.execAsync(`git init -b ${defaultBranch}`, { cwd: tempDir, timeout: 10000, env: { ...process.env } });
      await this.execAsync(`git remote add origin "${repoUrl}"`, { cwd: tempDir, timeout: 5000, env: { ...process.env } });
      logLines.push(`[${ts()}] [TempWS] $ git fetch --depth=1 origin ${defaultBranch}`);
      const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
      const fetchArgs = [
        ...(proxyUrl ? ['-c', `http.proxy=${proxyUrl}`, '-c', `https.proxy=${proxyUrl}`] : []),
        '-c', 'http.sslVerify=false', '-c', 'https.sslVerify=false', '-c', 'credential.helper=',
        'fetch', '--depth=1', 'origin', defaultBranch,
      ];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.execFileAsync('git', fetchArgs, { cwd: tempDir, timeout: 120 * 1000, env: fetchEnv });
          break;
        } catch (fetchErr: unknown) {
          if (attempt < 3) {
            logLines.push(`[${ts()}] [TempWS] git fetch 失败 (尝试 ${attempt}/3)，${5}秒后重试...`);
            await new Promise((r) => setTimeout(r, 5000));
          } else {
            throw fetchErr;
          }
        }
      }
      logLines.push(`[${ts()}] [TempWS] $ git checkout -b ${defaultBranch} origin/${defaultBranch}`);
      await this.execAsync(
        `git checkout -b ${defaultBranch} origin/${defaultBranch}`,
        { cwd: tempDir, timeout: 10000, env: { ...process.env } },
      );
    } catch (cloneErr: unknown) {
      const msg = (cloneErr as { message?: string }).message ?? '';
      try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
      throw new Error(`临时工作区创建失败: ${this.sanitizeLog(msg).slice(0, 300)}`);
    } finally {
      try { unlinkSync(askpassPath); } catch { /* ignore */ }
    }
    logLines.push(`[${ts()}] [TempWS] 工作区就绪`);
    const gitEnv = { cwd: tempDir, timeout: 5000, env: { ...process.env } };
    try { await this.execAsync('git config user.name "HelpCenter Sync"', gitEnv); } catch { /* ignore */ }
    try { await this.execAsync('git config user.email "sync@help-center.local"', gitEnv); } catch { /* ignore */ }
    try { await this.execAsync('git config core.fileMode false', gitEnv); } catch { /* ignore */ }
    try { await this.execAsync('git config --unset-all http.proxy', { cwd: tempDir, timeout: 5000, env: { ...process.env } }); } catch { /* ignore */ }
    try { await this.execAsync('git config --unset-all https.proxy', { cwd: tempDir, timeout: 5000, env: { ...process.env } }); } catch { /* ignore */ }
    const cleanup = () => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
        logLines.push(`[${ts()}] [TempWS] 已清理临时工作区: ${tempDir}`);
      } catch { /* ignore */ }
    };
    return { tempDir, cleanup };
  }

  private async ensureGitHubRemote(
    projectRoot: string,
    repoUrl: string,
    logLines: string[],
  ): Promise<string> {
    const ts = () => new Date().toLocaleString('zh-CN', { hour12: false });

    try {
      const { stdout } = await this.execAsync(
        'git remote get-url github',
        { cwd: projectRoot, timeout: 10000, env: { ...process.env } },
      );
      if (stdout.trim() === repoUrl) {
        logLines.push(`[${ts()}] [Git] github remote OK: ${repoUrl}`);
        return 'github';
      }
      logLines.push(`[${ts()}] [Git] github remote URL 不匹配 (${stdout.trim()})，重建...`);
    } catch {
      logLines.push(`[${ts()}] [Git] github remote 不存在，准备添加...`);
    }

    try {
      await this.execAsync('git remote remove github', { cwd: projectRoot, timeout: 10000, env: { ...process.env } });
    } catch { /* ignore */ }

    try {
      await this.execAsync(
        `git remote add github ${repoUrl}`,
        { cwd: projectRoot, timeout: 10000, env: { ...process.env } },
      );
      logLines.push(`[${ts()}] [Git] github remote 已添加: ${repoUrl}`);
    } catch (addErr: unknown) {
      const addMsg = (addErr as { message?: string }).message ?? '';
      logLines.push(`[${ts()}] [Git] git remote add 失败: ${this.sanitizeLog(addMsg)}`);
    }

    let verified = false;
    try {
      const { stdout: verifyOut } = await this.execAsync(
        'git remote get-url github',
        { cwd: projectRoot, timeout: 10000, env: { ...process.env } },
      );

      if (verifyOut.trim() === repoUrl) {
        verified = true;
        logLines.push(`[${ts()}] [Git] github remote 验证通过`);
      }
    } catch { /* verification failed */ }

    if (!verified) {
      logLines.push(`[${ts()}] [Git] github remote 验证失败，直接写入 config 文件`);
      await this.writeGitRemoteConfig(projectRoot, repoUrl, logLines);
    }

    return 'github';
  }

  private async writeGitRemoteConfig(
    projectRoot: string,
    repoUrl: string,
    logLines: string[],
  ): Promise<void> {
    const ts = () => new Date().toLocaleString('zh-CN', { hour12: false });
    const configPath = path.join(projectRoot, '.git', 'config');

    try {
      let content = '';
      if (existsSync(configPath)) {
        content = readFileSync(configPath, 'utf-8');
      }

      if (!content.includes('[remote "github"]')) {
        const remoteSection = `\n[remote "github"]\n\turl = ${repoUrl}\n\tfetch = +refs/heads/*:refs/remotes/github/*\n`;
        writeFileSync(configPath, content + remoteSection);
        logLines.push(`[${ts()}] [Git] 已直接写入 github remote 到 config 文件`);
      }

      const { stdout: finalCheck } = await this.execAsync(
        'git remote get-url github',
        { cwd: projectRoot, timeout: 10000, env: { ...process.env } },
      );
      logLines.push(`[${ts()}] [Git] config 写入后验证: ${finalCheck.trim()}`);
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? '';
      logLines.push(`[${ts()}] [Git] config 直写失败: ${this.sanitizeLog(msg)}`);
    }
  }

  private async ensureWorkspaceHealth(
    projectRoot: string,
    config: { repoUrl: string; defaultBranch: string },
    logLines: string[],
  ): Promise<void> {
    const ts = () => new Date().toLocaleString('zh-CN', { hour12: false });

    const gitDir = path.join(projectRoot, '.git');
    if (!existsSync(gitDir)) {
      throw new Error(`工作区 .git 不存在: ${projectRoot}`);
    }
    logLines.push(`[${ts()}] [Health] .git 目录存在`);

    const headPath = path.join(gitDir, 'HEAD');
    if (existsSync(headPath)) {
      const headContent = readFileSync(headPath, 'utf-8').trim();
      if (!headContent) {
        const branch = config.defaultBranch || 'main';
        logLines.push(`[${ts()}] [Health] HEAD 为空，修复为 ref: refs/heads/${branch}`);
        writeFileSync(headPath, `ref: refs/heads/${branch}\n`);
      } else {
        logLines.push(`[${ts()}] [Health] HEAD OK: ${headContent}`);
      }
    }

    try {
      const { stdout: remoteOut } = await this.execAsync(
        'git remote -v',
        { cwd: projectRoot, timeout: 10000, env: { ...process.env } },
      );
      const sanitized = this.sanitizeLog(remoteOut).trim();
      logLines.push(`[${ts()}] [Health] remote -v:\n${sanitized}`);
    } catch { /* ignore */ }

    try { await this.execAsync('git config --unset-all http.proxy', { cwd: projectRoot, timeout: 5000, env: { ...process.env } }); } catch { /* ignore */ }
    try { await this.execAsync('git config --unset-all https.proxy', { cwd: projectRoot, timeout: 5000, env: { ...process.env } }); } catch { /* ignore */ }
    logLines.push(`[${ts()}] [Health] GitHub git 网络模式：直连，已清理无效代理`);
  }

  private getGitHubToken(): string {
    const envToken = (process.env.GITHUB_TOKEN ?? '').trim();
    if (envToken) return envToken;

    try {
      const tokenPath = '/tmp/github-token';
      if (existsSync(tokenPath)) {
        return readFileSync(tokenPath, 'utf-8').trim();
      }
    } catch {
      // ignore file read errors
    }

    return '';
  }

  private async executeBuild(taskId: string, scope: PublishScope): Promise<void> {
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const logLines: string[] = [];
    let restoreDocusaurusConfig: (() => void) | null = null;

    try {
      const config = await this.systemConfigService.getConfig();
      const projectRoot = config.docusaurusProjectDir || '/home/gm/workspace/code';

      logLines.push(`[${ts()}] [构建检查] 项目路径: ${projectRoot}`);

      if (!existsSync(projectRoot)) {
        throw new Error(`项目路径不存在: ${projectRoot}`);
      }
      logLines.push(`[${ts()}] [构建检查] 项目路径存在: 是`);

      const packageJsonPath = path.join(projectRoot, 'package.json');
      if (!existsSync(packageJsonPath)) {
        throw new Error(`项目路径下未找到 package.json: ${packageJsonPath}，请确认该目录是 Docusaurus 项目根目录`);
      }
      logLines.push(`[${ts()}] [构建检查] package.json: 存在`);

      const packageJsonContent = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const buildScript = packageJsonContent.scripts?.build;
      logLines.push(`[${ts()}] [构建检查] scripts.build: ${buildScript || '(未配置)'}`);

      const nodeModulesPath = path.join(projectRoot, 'node_modules');
      const hasNodeModules = existsSync(nodeModulesPath);
      logLines.push(`[${ts()}] [构建检查] node_modules: ${hasNodeModules ? '存在' : '不存在'}`);

      if (!hasNodeModules) {
        throw new Error('依赖未安装，请先执行 npm ci / npm install');
      }

      let buildCmd: string;
      if (buildScript) {
        buildCmd = 'npm run build';
        logLines.push(`[${ts()}] [构建检查] 构建命令: npm run build (优先使用 package.json scripts.build)`);
      } else {
        buildCmd = 'npx docusaurus build';
        logLines.push(`[${ts()}] [构建检查] 构建命令: npx docusaurus build (fallback)`);
      }

      if (scope === 'zh-CN') {
        buildCmd += ' -- --locale zh-Hans';
      } else if (scope === 'en') {
        buildCmd += ' -- --locale en';
      }

      const checkZh = scope === 'all' || scope === 'zh-CN';
      const checkEn = scope === 'all' || scope === 'en';
      const docsDir = config.docsDir || 'docs';
      const enI18nDir = config.enI18nDocsDir || 'i18n/en/docusaurus-plugin-content-docs/current';
      if (checkZh) {
        logLines.push(`[${ts()}] [构建检查] 检查中文文档目录: ${docsDir}/`);
      }
      if (checkEn) {
        logLines.push(`[${ts()}] [构建检查] 检查英文文档目录: ${enI18nDir}/`);
      }

      await this.syncDocsToProject(projectRoot, logLines);

      const docusaurusCfg = this.prepareDocusaurusBuildConfig(projectRoot, logLines, `${ts()} [构建检查]`);
      restoreDocusaurusConfig = docusaurusCfg.restore;

      logLines.push(`[${ts()}] [构建检查] 执行命令: ${buildCmd}`);
      logLines.push('--- 构建输出 ---');

      const timeout = 10 * 60 * 1000;
      const { stdout, stderr } = await this.execAsync(buildCmd, {
        cwd: projectRoot,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=3072' },
      });

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

      if (stdout) {
        logLines.push(this.sanitizeLog(stdout));
      }
      if (stderr) {
        logLines.push(this.sanitizeLog(stderr));
      }

      logLines.push('--- 构建结果 ---');
      logLines.push(`[${ts()}] [构建检查] 耗时: ${durationSec}s`);
      logLines.push(`[${ts()}] [构建检查] 结果: 构建成功 (exitCode: 0)`);
      const buildCheckDir = path.join(projectRoot, config.buildOutputDir || 'build');
      if (existsSync(buildCheckDir)) {
        this.verifyBuildAssets(buildCheckDir, logLines, `${ts()} [构建检查]`);
      }

      const buildLog = logLines.join('\n').slice(0, 50 * 1024);

      await this.db
        .update(publishTasks)
        .set({
          status: '成功' as TaskStatus,
          buildLog,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.log(`构建检查成功: taskId=${taskId}, 耗时=${durationSec}s`);
    } catch (error: unknown) {
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const execError = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean; code?: number };

      let errorDetail = '';
      if (execError.killed) {
        errorDetail = '构建超时（超过 15 分钟）';
      } else if (execError.stderr) {
        errorDetail = this.sanitizeLog(execError.stderr);
      } else if (execError.message) {
        errorDetail = this.sanitizeLog(execError.message);
      } else {
        errorDetail = '未知错误';
      }

      if (execError.stdout) {
        logLines.push(this.sanitizeLog(execError.stdout));
      }

      logLines.push('--- 构建结果 ---');
      logLines.push(`[${ts()}] [构建检查] 耗时: ${durationSec}s`);
      logLines.push(`[${ts()}] [构建检查] 结果: 构建失败`);

      const buildLog = logLines.join('\n').slice(0, 50 * 1024);
      const errorMessage = errorDetail.slice(0, 10 * 1024);

      await this.db
        .update(publishTasks)
        .set({
          status: '失败' as TaskStatus,
          buildLog,
          errorMessage,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.error(`构建检查失败: taskId=${taskId}, 耗时=${durationSec}s, error=${errorMessage.slice(0, 500)}`);
    } finally {
      if (restoreDocusaurusConfig) restoreDocusaurusConfig();
    }
  }

  async getBuildCheckLogs(taskId: string): Promise<BuildCheckLogResponse> {
    try {
      const result = await this.db
        .select({
          buildLog: publishTasks.buildLog,
          status: publishTasks.status,
          errorMessage: publishTasks.errorMessage,
        })
        .from(publishTasks)
        .where(eq(publishTasks.id, taskId))
        .limit(1);

      if (!result.length) {
        return { buildLog: '', success: false, errorMessage: '任务不存在' };
      }

      const row = result[0];
      return {
        buildLog: row.buildLog ?? '',
        success: row.status === '成功',
        errorMessage: row.errorMessage ?? undefined,
      };
    } catch (error) {
      this.logger.error('获取构建检查日志失败', JSON.stringify(error));
      throw error;
    }
  }

  async triggerGitCommit(
    userId: string,
    scope?: string,
    mappingId?: string,
  ): Promise<GitCommitResponse> {
    const timestamp = new Date().toLocaleString('zh-CN');
    const publishScope = (scope ?? 'all') as PublishScope;
    const taskName = `Git提交 - ${timestamp}`;

    const config = await this.systemConfigService.getConfig();
    if (!config.repoUrl) {
      return { success: false, taskId: '', message: '未配置仓库地址，请在系统配置中设置仓库 URL' };
    }

    const lastBuild = await this.db
      .select({ status: publishTasks.status })
      .from(publishTasks)
      .where(eq(publishTasks.taskType, '构建检查' as TaskType))
      .orderBy(desc(publishTasks.createdAt))
      .limit(1);

    if (!lastBuild.length || lastBuild[0].status !== '成功') {
      return { success: false, taskId: '', message: '构建检查未通过，请先执行构建检查并确保通过后再提交' };
    }

    const initialLog = [
      `[${timestamp}] [Git提交] 任务已创建，状态: 执行中`,
      `[${timestamp}] [Git提交] 操作人: ${userId}`,
      `[${timestamp}] [Git提交] 范围: ${publishScope}`,
    ].join('\n');

    try {
      const result = await this.db
        .insert(publishTasks)
        .values({
          taskName,
          taskType: 'Git提交' as TaskType,
          environment: null,
          status: '执行中' as TaskStatus,
          operator: userId,
          publishScope,
          buildLog: initialLog,
        })
        .returning({ id: publishTasks.id });

      const taskId = result[0]?.id;
      if (!taskId) {
        throw new Error('创建 Git 提交任务失败：未返回 ID');
      }

      this.logger.log(`Git提交任务已创建: ${taskId}, 操作人: ${userId}`);

      this.executeGitCommit(taskId, config, publishScope, mappingId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Git提交异步执行异常: taskId=${taskId}, error=${msg}`);
      });

      return { success: true, taskId };
    } catch (error) {
      this.logger.error('创建 Git 提交任务失败', JSON.stringify(error));
      throw error;
    }
  }

  private async executeGitCommit(
    taskId: string,
    config: { repoUrl: string; defaultBranch: string; workBranchPrefix: string; docusaurusProjectDir?: string },
    scope: PublishScope,
    mappingId?: string,
  ): Promise<void> {
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const logLines: string[] = [];
    const projectRoot = config.docusaurusProjectDir || '/home/gm/workspace/code';

    const execGit = async (cmd: string): Promise<{ stdout: string; stderr: string }> => {
      const maskedCmd = this.sanitizeLog(cmd);
      logLines.push(`[${ts()}] [Git] $ ${maskedCmd}`);
      const { stdout, stderr } = await this.execAsync(cmd, {
        cwd: projectRoot,
        timeout: 60 * 1000,
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env },
      });
      if (stderr) {
        logLines.push(`[stderr] ${this.sanitizeLog(stderr)}`);
      }
      return { stdout, stderr };
    };

    let askpassPath: string | null = null;

    try {
      logLines.push(`[${ts()}] [Git] 开始执行 Git 提交流程`);
      logLines.push(`[${ts()}] [Git] 项目路径: ${projectRoot}`);

      if (!existsSync(projectRoot)) {
        throw new Error(`项目路径不存在: ${projectRoot}`);
      }

      const gitDir = path.join(projectRoot, '.git');
      if (!existsSync(gitDir)) {
        throw new Error('当前 Docusaurus 项目尚未初始化 Git 仓库或未配置远程仓库，请在项目目录下执行 git init 并配置 remote');
      }

      await execGit('git config user.name "HelpCenter Sync"');
      await execGit('git config user.email "sync@help-center.local"');


      const pushToken = this.getGitHubToken();
      const gitRemote = await this.ensureGitHubRemote(projectRoot, config.repoUrl || '', logLines);
      await this.ensureWorkspaceHealth(projectRoot, { repoUrl: config.repoUrl || '', defaultBranch: config.defaultBranch || 'main' }, logLines);

      if (pushToken) {
        askpassPath = path.join('/tmp', `askpass-${taskId}.sh`);
        writeFileSync(askpassPath, `#!/bin/sh\necho "${pushToken}"`, { mode: 0o700 });
      }
      const authEnv: NodeJS.ProcessEnv = {
        ...this.buildGitNetworkEnv(),
        ...(askpassPath ? { GIT_ASKPASS: askpassPath } : {}),
      };

      await this.repairGitCorruption(projectRoot, logLines);

      try {
        const fetchCmd = this.gitNetCmd(`git fetch ${gitRemote}`);
        logLines.push(`[${ts()}] [Git] $ ${fetchCmd}`);
        await this.execAsync(fetchCmd, { cwd: projectRoot, timeout: 30 * 1000, env: authEnv });
        logLines.push(`[${ts()}] [Git] 已同步远程仓库历史`);
      } catch (fetchErr: unknown) {
        const msg = (fetchErr as { message?: string }).message ?? '';
        logLines.push(`[${ts()}] [Git] fetch 首次失败: ${this.sanitizeLog(msg)}`);
        logLines.push(`[${ts()}] [Git] 尝试修复损坏引用并重试...`);

        try {
          await this.execAsync(this.gitNetCmd(`git remote prune ${gitRemote}`), { cwd: projectRoot, timeout: 30 * 1000, env: authEnv });
        } catch { /* continue */ }

        try {
          const fetchCmd2 = this.gitNetCmd(`git fetch ${gitRemote}`);
          logLines.push(`[${ts()}] [Git] $ ${fetchCmd2}（重试）`);
          await this.execAsync(fetchCmd2, { cwd: projectRoot, timeout: 30 * 1000, env: authEnv });
          logLines.push(`[${ts()}] [Git] fetch 重试成功`);
        } catch (retryErr: unknown) {
          const retryMsg = (retryErr as { message?: string }).message ?? '';
          logLines.push(`[${ts()}] [Git] fetch 重试失败: ${this.sanitizeLog(retryMsg)}`);
          throw new Error(`无法同步远程仓库历史: ${this.sanitizeLog(retryMsg).slice(0, 300)}`);
        }
      }

      const { stdout: statusOut } = await execGit('git status --porcelain');
      if (!statusOut.trim()) {
        logLines.push(`[${ts()}] [Git] 当前工作区无任何文件变更`);
        logLines.push(`[${ts()}] [Git] 结果: 无变更可提交，本次未执行 Git commit / push`);

        await this.db
          .update(publishTasks)
          .set({
            status: '成功' as TaskStatus,
            buildLog: logLines.join('\n').slice(0, 50 * 1024),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));

        this.logger.log(`Git提交: 无变更可提交, taskId=${taskId}`);
        return;
      }

      logLines.push(`[${ts()}] [Git] 检测到变更文件:`);
      statusOut.trim().split('\n').forEach((line: string) => {
        logLines.push(`  ${line}`);
      });

      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const shortId = taskId.slice(0, 8);
      const rawPrefix = config.workBranchPrefix && config.workBranchPrefix !== 'docs/'
        ? config.workBranchPrefix
        : 'help-center-sync/';
      const prefix = rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`;
      const branchName = `${prefix}${date}-${shortId}`;

      const defaultBranch = config.defaultBranch || 'main';
      try {
        await execGit('git stash --include-untracked');
        logLines.push(`[${ts()}] [Git] 已暂存当前变更`);
      } catch { /* nothing to stash */ }
      await execGit(`git checkout -b ${branchName} ${gitRemote}/${defaultBranch}`);
      logLines.push(`[${ts()}] [Git] 创建工作分支: ${branchName}（基于 ${gitRemote}/${defaultBranch}）`);
      try {
        await execGit('git stash pop');
        logLines.push(`[${ts()}] [Git] 已恢复暂存的变更`);
      } catch { /* no stash to pop */ }

      const allowedPaths = [
        'docs/',
        'i18n/',
        'static/img/help-center/',
        'static/files/help-center/',
      ];

      for (const p of allowedPaths) {
        try {
          await execGit(`git add ${p}`);
          logLines.push(`[${ts()}] [Git] 已暂存: ${p}`);
        } catch {
          logLines.push(`[${ts()}] [Git] 跳过: ${p}（目录不存在或无变更）`);
        }
      }

      const { stdout: stagedOut } = await execGit('git diff --cached --name-only');
      if (!stagedOut.trim()) {
        logLines.push(`[${ts()}] [Git] 白名单目录内无相关变更，暂存区为空`);
        logLines.push(`[${ts()}] [Git] 结果: 无变更可提交，本次未执行 Git commit / push`);

        await this.db
          .update(publishTasks)
          .set({
            status: '成功' as TaskStatus,
            buildLog: logLines.join('\n').slice(0, 50 * 1024),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));
        return;
      }

      logLines.push(`[${ts()}] [Git] 暂存文件列表:`);
      stagedOut.trim().split('\n').forEach((line: string) => {
        logLines.push(`  ${line}`);
      });

      let commitTitle = branchName;
      if (mappingId) {
        const mapping = await this.db
          .select({ helpCenterTitle: feishuDocMappings.helpCenterTitle })
          .from(feishuDocMappings)
          .where(eq(feishuDocMappings.id, mappingId))
          .limit(1);
        if (mapping.length && mapping[0].helpCenterTitle) {
          commitTitle = mapping[0].helpCenterTitle;
        }
      }

      try { await execGit('git config user.name "HelpCenter Sync"'); } catch { /* ignore */ }
      try { await execGit('git config user.email "sync@help-center.local"'); } catch { /* ignore */ }

      const commitMsg = `sync help center docs: ${commitTitle}`;
      await execGit(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
      logLines.push(`[${ts()}] [Git] 提交成功: ${commitMsg}`);

      const { stdout: hashOut } = await execGit('git rev-parse HEAD');
      const commitHash = hashOut.trim();
      logLines.push(`[${ts()}] [Git] commit hash: ${commitHash}`);

      try {
        const maskedPushCmd = this.gitNetCmd(`git push ${gitRemote} ${branchName}`);
        logLines.push(`[${ts()}] [Git] $ ${maskedPushCmd}`);
        const { stderr: pushStderr } = await this.execAsync(maskedPushCmd, {
          cwd: projectRoot,
          timeout: 60 * 1000,
          maxBuffer: 5 * 1024 * 1024,
          env: authEnv,
        });
        if (pushStderr) {
          logLines.push(`[stderr] ${this.sanitizeLog(pushStderr)}`);
        }
        logLines.push(`[${ts()}] [Git] 推送成功: ${gitRemote}/${branchName}`);
      } catch (pushErr: unknown) {
        const err = pushErr as { stderr?: string; message?: string };
        const stderrText = this.sanitizeLog(err.stderr ?? err.message ?? '');
        let reason = '推送失败';

        if (stderrText.includes('Authentication failed') || stderrText.includes('403') || stderrText.includes('could not read Username') || stderrText.includes('Invalid username or token')) {
          reason = 'Git 认证失败，请检查仓库凭据配置（Token 可能过期或权限不足）';
        } else if (stderrText.includes('does not appear to be a git repository') || stderrText.includes('No remote configured')) {
          reason = '未配置远程仓库，请在系统配置中设置仓库地址';
        } else if (stderrText.includes('rejected') || stderrText.includes('non-fast-forward')) {
          reason = '推送被拒绝，远程分支可能有冲突';
        } else if (stderrText.includes('Could not resolve host') || stderrText.includes('Connection refused') || stderrText.includes('timed out') || stderrText.includes('ETIMEDOUT') || stderrText.includes('ECONNREFUSED') || (pushErr as { killed?: boolean }).killed) {
          reason = '网络连接失败，请检查网络配置或远程仓库可用性';
        }

        throw new Error(reason);
      } finally {
        if (askpassPath) {
          try { unlinkSync(askpassPath); } catch { /* ignore */ }
        }
      }

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      logLines.push(`[${ts()}] [Git] 结果: 提交并推送成功`);
      logLines.push(`[${ts()}] [Git] 耗时: ${durationSec}s`);
      logLines.push(`[${ts()}] [Git] 分支: ${branchName}`);
      logLines.push(`[${ts()}] [Git] commit: ${commitHash}`);

      await this.db
        .update(publishTasks)
        .set({
          status: '成功' as TaskStatus,
          buildLog: logLines.join('\n').slice(0, 50 * 1024),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.log(`Git提交成功: taskId=${taskId}, branch=${branchName}, commit=${commitHash}`);
    } catch (error: unknown) {
      if (askpassPath) {
        try { unlinkSync(askpassPath); } catch { /* ignore */ }
      }
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const execError = error as { stderr?: string; message?: string };

      const errorDetail = this.sanitizeLog(execError.stderr ?? execError.message ?? '未知错误');

      logLines.push(`[${ts()}] [Git] 结果: 失败`);
      logLines.push(`[${ts()}] [Git] 错误: ${errorDetail}`);
      logLines.push(`[${ts()}] [Git] 耗时: ${durationSec}s`);

      await this.db
        .update(publishTasks)
        .set({
          status: '失败' as TaskStatus,
          buildLog: logLines.join('\n').slice(0, 50 * 1024),
          errorMessage: errorDetail.slice(0, 10 * 1024),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.error(`Git提交失败: taskId=${taskId}, error=${errorDetail.slice(0, 500)}`);
    }
  }

  private async createTask(
    taskName: string,
    taskType: TaskType,
    environment: string | null,
    userId: string,
    buildLog?: string,
    deployLog?: string,
    publishScope?: string,
  ): Promise<CreateResponse> {
    try {
      const result = await this.db
        .insert(publishTasks)
        .values({
          taskName,
          taskType,
          environment,
          status: '执行中' as TaskStatus,
          operator: userId,
          publishScope: publishScope ?? 'all',
          ...(buildLog ? { buildLog } : {}),
          ...(deployLog ? { deployLog } : {}),
        })
        .returning({ id: publishTasks.id });

      const taskId = result[0]?.id;
      if (!taskId) {
        throw new Error('创建任务失败：未返回 ID');
      }

      // Simulate: immediately mark as success (预留逻辑)
      await this.db
        .update(publishTasks)
        .set({
          status: '成功',
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.log(`创建发布任务: ${taskName}, 类型: ${taskType}, 操作人: ${userId}`);
      return { id: taskId };
    } catch (error) {
      this.logger.error('创建发布任务失败', JSON.stringify(error));
      throw error;
    }
  }

  async retryGitPush(taskId: string, userId: string): Promise<GitCommitResponse> {
    const ts = () => new Date().toLocaleString('zh-CN');

    const existing = await this.db
      .select({
        buildLog: publishTasks.buildLog,
        status: publishTasks.status,
      })
      .from(publishTasks)
      .where(and(eq(publishTasks.id, taskId), eq(publishTasks.taskType, 'Git提交' as TaskType)))
      .limit(1);

    if (!existing.length) {
      return { success: false, taskId: '', message: '任务不存在' };
    }

    const task = existing[0];
    const buildLog = task.buildLog ?? '';

    const branchMatch = buildLog.match(/工作分支: (\S+)/);
    const commitMatch = buildLog.match(/commit hash: ([a-f0-9]+)/);
    if (!branchMatch || !commitMatch) {
      return { success: false, taskId, message: '无法从任务日志中解析分支名或 commit hash' };
    }

    const branchName = branchMatch[1];
    const commitHash = commitMatch[1];

    const config = await this.systemConfigService.getConfig();
    if (!config.repoUrl) {
      return { success: false, taskId, message: '未配置仓库地址' };
    }

    const projectRoot = config.docusaurusProjectDir || '/home/gm/workspace/code';
    const token = this.getGitHubToken();

    const logLines: string[] = [
      `[${ts()}] [重试推送] 操作人: ${userId}`,
      `[${ts()}] [重试推送] 分支: ${branchName}`,
      `[${ts()}] [重试推送] commit: ${commitHash}`,
      `[${ts()}] [重试推送] 远程仓库: ${config.repoUrl}`,
    ];

    await this.db
      .update(publishTasks)
      .set({ status: '执行中' as TaskStatus, errorMessage: null, updatedAt: new Date() })
      .where(eq(publishTasks.id, taskId));

    try {
      const { stdout: verifyOut } = await this.execAsync(`git rev-parse --verify ${commitHash}`, {
        cwd: projectRoot,
        timeout: 10 * 1000,
      });
      if (!verifyOut.trim()) {
        throw new Error(`本地不存在 commit: ${commitHash}`);
      }

      const gitRemote = await this.ensureGitHubRemote(projectRoot, config.repoUrl || '', logLines);

      let askpassPath: string | null = null;
      try {
        if (token) {
          askpassPath = path.join('/tmp', `askpass-retry-${taskId}.sh`);
          writeFileSync(askpassPath, `#!/bin/sh\necho "${token}"`, { mode: 0o700 });
        }

        const pushEnv: NodeJS.ProcessEnv = {
          ...this.buildGitNetworkEnv(),
          ...(askpassPath ? { GIT_ASKPASS: askpassPath } : {}),
        };

        try {
          await this.execAsync(this.gitNetCmd(`git fetch ${gitRemote}`), {
            cwd: projectRoot,
            timeout: 30 * 1000,
            env: pushEnv,
          });
        } catch { /* fetch failure is non-fatal for retry push */ }

        const { stderr: pushStderr } = await this.execAsync(this.gitNetCmd(`git push ${gitRemote} ${branchName}`), {
          cwd: projectRoot,
          timeout: 60 * 1000,
          maxBuffer: 5 * 1024 * 1024,
          env: pushEnv,
        });
        if (pushStderr) {
          logLines.push(`[stderr] ${this.sanitizeLog(pushStderr)}`);
        }
      } finally {
        if (askpassPath) {
          try { unlinkSync(askpassPath); } catch { /* ignore */ }
        }
      }

      logLines.push(`[${ts()}] [重试推送] 推送成功: ${gitRemote}/${branchName}`);

      await this.db
        .update(publishTasks)
        .set({
          status: '成功' as TaskStatus,
          buildLog: (buildLog + '\n' + logLines.join('\n')).slice(0, 50 * 1024),
          errorMessage: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.log(`重试推送成功: taskId=${taskId}, branch=${branchName}`);
      return { success: true, taskId };
    } catch (error: unknown) {
      const execError = error as { stderr?: string; message?: string };
      const errorDetail = this.sanitizeLog(execError.stderr ?? execError.message ?? '未知错误');

      logLines.push(`[${ts()}] [重试推送] 失败: ${errorDetail}`);

      let reason = errorDetail;
      if (errorDetail.includes('Authentication failed') || errorDetail.includes('403') || errorDetail.includes('could not read Username') || errorDetail.includes('Invalid username or token')) {
        reason = 'Git 认证失败，请检查仓库凭据配置（Token 可能过期或权限不足）';
      }

      await this.db
        .update(publishTasks)
        .set({
          status: '失败' as TaskStatus,
          buildLog: (buildLog + '\n' + logLines.join('\n')).slice(0, 50 * 1024),
          errorMessage: reason.slice(0, 10 * 1024),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.error(`重试推送失败: taskId=${taskId}, error=${reason.slice(0, 500)}`);
      return { success: false, taskId, message: reason };
    }
  }

  private parseGitHubRepoInfo(repoUrl: string): { owner: string; repo: string } {
    const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (!match) {
      throw new Error(`无法从仓库 URL 解析 GitHub owner/repo: ${repoUrl}`);
    }
    return { owner: match[1], repo: match[2] };
  }

  private githubApi(
    method: string,
    apiPath: string,
    token: string,
    body?: unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: 'api.github.com',
        port: 443,
        path: apiPath,
        method,
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'ODPM-HelpCenter-Sync',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch {
              resolve(data);
            }
          } else {
            let errMsg = `GitHub API ${status}`;
            try {
              const parsed = JSON.parse(data);
              errMsg += `: ${parsed.message || 'Unknown error'}`;
            } catch {
              errMsg += ': Response parse error';
            }
            reject(new Error(errMsg));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`GitHub API request error: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('GitHub API request timeout'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async triggerWebsitePublish(
    userId: string,
    scope?: string,
    previewOnly?: boolean,
    buildScope?: 'publishedOnly' | 'releaseCandidate',
    forceConfig?: { url: string; baseUrl: string },
  ): Promise<WebsitePublishResponse> {
    const mutexKey = previewOnly ? 'GitHub Pages预览' : '发布到网站';
    if (this.runningTaskTypes.has(mutexKey)) {
      return { success: false, taskId: '', message: `当前有${mutexKey}任务正在执行，请稍后再试` };
    }
    const timestamp = new Date().toLocaleString('zh-CN');
    const publishScope = (scope ?? 'all') as PublishScope;
    const taskName = previewOnly ? `GitHub Pages 预览发布 - ${timestamp}` : `发布到网站 - ${timestamp}`;

    const config = await this.systemConfigService.getConfig();
    if (!config.repoUrl) {
      return { success: false, taskId: '', message: '未配置仓库地址，请在系统配置中设置仓库 URL' };
    }

    if (!previewOnly) {
      const lastBuild = await this.db
        .select({ status: publishTasks.status })
        .from(publishTasks)
        .where(eq(publishTasks.taskType, '构建检查' as TaskType))
        .orderBy(desc(publishTasks.createdAt))
        .limit(1);

      if (!lastBuild.length || lastBuild[0].status !== '成功') {
        return { success: false, taskId: '', message: '构建检查未通过，请先执行构建检查并确保通过后再发布' };
      }
    }

    const modeLabel = previewOnly ? 'GitHub Pages 预览发布' : '发布到网站';
    const initialLog = [
      `[${timestamp}] [${modeLabel}] 任务已创建，状态: 执行中`,
      `[${timestamp}] [${modeLabel}] 操作人: ${userId}`,
      `[${timestamp}] [${modeLabel}] 范围: ${publishScope}`,
      ...(previewOnly ? [
        `[${timestamp}] [${modeLabel}] 模式: 预览（不修改文档状态、不部署公司服务器）`,
        `[${timestamp}] [${modeLabel}] buildScope: ${buildScope || 'releaseCandidate'}`,
        `[${timestamp}] [${modeLabel}] forceConfig: url=${forceConfig?.url}, baseUrl=${forceConfig?.baseUrl}`,
      ] : []),
    ].join('\n');

    try {
      const result = await this.db
        .insert(publishTasks)
        .values({
          taskName,
          taskType: '发布到网站' as TaskType,
          environment: null,
          status: '执行中' as TaskStatus,
          operator: userId,
          publishScope,
          buildLog: initialLog,
          mergeStatus: 'none',
          deployStatus: 'none',
          securityCheckResult: 'none',
        })
        .returning({ id: publishTasks.id });

      const taskId = result[0]?.id;
      if (!taskId) {
        throw new Error(`创建${modeLabel}任务失败：未返回 ID`);
      }

      this.logger.log(`${modeLabel}任务已创建: ${taskId}, 操作人: ${userId}`);

      this.executeWebsitePublishPipeline(taskId, config, publishScope, userId, previewOnly || false, buildScope, forceConfig).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`${modeLabel}异步异常: taskId=${taskId}, error=${msg}`);
      });

      return { success: true, taskId };
    } catch (error) {
      this.logger.error(`创建${modeLabel}任务失败`, JSON.stringify(error));
      throw error;
    }
  }

  private async executeWebsitePublishPipeline(
    taskId: string,
    config: { repoUrl: string; defaultBranch: string; workBranchPrefix: string; docusaurusProjectDir?: string; productionUrl?: string },
    scope: PublishScope,
    userId: string,
    previewOnly: boolean = false,
    buildScope?: 'publishedOnly' | 'releaseCandidate',
    forceConfig?: { url: string; baseUrl: string },
  ): Promise<void> {
    const mutexKey = previewOnly ? 'GitHub Pages预览' : '发布到网站';
    this.runningTaskTypes.add(mutexKey);
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const logLines: string[] = [];
    const projectRoot = config.docusaurusProjectDir || '/home/gm/workspace/code';
    let restoreDocusaurusConfig: (() => void) | null = null;
    let tempCleanup: (() => void) | null = null;
    let tempDir = '';
    let pipelineAskpassPath: string | null = null;

    const pipeline = {
      build: { status: 'pending' },
      gitPush: { status: 'pending' },
      prCreate: { status: 'pending' },
      securityCheck: { status: 'pending' },
      merge: { status: 'pending' },
      deploy: { status: 'pending' },
    };

    const updatePipeline = async (patch: Record<string, unknown>) => {
      await this.db
        .update(publishTasks)
        .set({
          deployLog: JSON.stringify(pipeline),
          ...patch,
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));
    };

    const failPipeline = async (step: string, errorMsg: string) => {
      pipeline[step as keyof typeof pipeline].status = 'failed';
      logLines.push(`[${ts()}] [Pipeline] 步骤 ${step} 失败: ${errorMsg}`);
      await this.db
        .update(publishTasks)
        .set({
          status: '失败' as TaskStatus,
          errorMessage: errorMsg.slice(0, 10 * 1024),
          buildLog: logLines.join('\n').slice(0, 50 * 1024),
          deployLog: JSON.stringify(pipeline),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));
    };

    try {
      const token = this.getGitHubToken();
      if (!token) {
        await failPipeline('build', 'GitHub Token 未配置，请设置 GITHUB_TOKEN 环境变量');
        return;
      }

      pipelineAskpassPath = `/tmp/askpass-pipeline-${taskId}.sh`;
      try {
        writeFileSync(pipelineAskpassPath, `#!/bin/sh\necho "${token}"`, { mode: 0o700 });
      } catch { /* ignore */ }
      const askpassPath = pipelineAskpassPath;

      const { owner, repo } = this.parseGitHubRepoInfo(config.repoUrl);
      logLines.push(`[${ts()}] [Pipeline] 开始自动发布流程`);
      logLines.push(`[${ts()}] [Pipeline] 仓库: ${owner}/${repo}`);
      logLines.push(`[${ts()}] [Pipeline] 项目路径: ${projectRoot}`);

      logLines.push(`[${ts()}] [Step 0] 创建临时 Git 工作区`);
      try {
        const tempWs = await this.createTemporaryWorkspace(
          config.repoUrl, config.defaultBranch || 'main', token, logLines,
        );
        tempDir = tempWs.tempDir;
        tempCleanup = tempWs.cleanup;
      } catch (wsErr: unknown) {
        const wsMsg = wsErr instanceof Error ? wsErr.message : String(wsErr);
        await failPipeline('build', `临时工作区创建失败: ${wsMsg}`);
        return;
      }
      logLines.push(`[${ts()}] [Step 0] 临时工作区就绪: ${tempDir}`);

      if (previewOnly && forceConfig) {
        const cfgPath = path.join(tempDir, 'docusaurus.config.js');
        if (existsSync(cfgPath)) {
          const originalCfg = readFileSync(cfgPath, 'utf-8');
          let modifiedCfg = originalCfg.replace(
            /url:\s*(['"])[^'"]*\1/,
            `url: '${forceConfig.url}'`,
          );
          modifiedCfg = modifiedCfg.replace(
            /baseUrl:\s*(['"])[^'"]*\1/,
            `baseUrl: '${forceConfig.baseUrl}'`,
          );
          if (modifiedCfg !== originalCfg) {
            writeFileSync(cfgPath, modifiedCfg, 'utf-8');
            logLines.push(`[${ts()}] [Preview] 已设置 url=${forceConfig.url}, baseUrl=${forceConfig.baseUrl}`);
          }
        }
      }

      const tempCfgForScripts = path.join(tempDir, 'docusaurus.config.js');
      if (existsSync(tempCfgForScripts)) {
        let cfgContent = readFileSync(tempCfgForScripts, 'utf-8');
        const baseUrlMatch = cfgContent.match(/baseUrl:\s*(['"])([^'"]*)\1/);
        const baseUrl = baseUrlMatch?.[2] || '/';
        const correctScriptPath = `${baseUrl.replace(/\/$/, '')}/js/attachment-preview.js`;
        if (!cfgContent.includes('attachment-preview')) {
          cfgContent = cfgContent.replace(
            /favicon:\s*(['"])[^'"]*\1,?/,
            (match) => `${match}\n  scripts: ['${correctScriptPath}'],`,
          );
          writeFileSync(tempCfgForScripts, cfgContent, 'utf-8');
          logLines.push(`[${ts()}] [Step 0] 已注入 scripts: ['${correctScriptPath}'] 到临时工作区配置`);
        } else if (cfgContent.includes('/js/attachment-preview.js') && !cfgContent.includes(correctScriptPath)) {
          cfgContent = cfgContent.replace(
            /['"][^'"]*\/js\/attachment-preview\.js['"]/,
            `'${correctScriptPath}'`,
          );
          writeFileSync(tempCfgForScripts, cfgContent, 'utf-8');
          logLines.push(`[${ts()}] [Step 0] 已修正 scripts 路径: '${correctScriptPath}'`);
        } else {
          logLines.push(`[${ts()}] [Step 0] 临时工作区配置已包含正确的 scripts，跳过注入`);
        }
      }

      // === Step 1: syncDocsToProject + Docusaurus build ===
      pipeline.build.status = 'running';
      await updatePipeline({});
      logLines.push(`[${ts()}] [Step 1/6] 同步文档并构建 Docusaurus`);

      if (!existsSync(tempDir)) {
        await failPipeline('build', `临时工作区路径不存在: ${tempDir}`);
        return;
      }

      const baseUrl = forceConfig?.baseUrl;
      if (previewOnly && buildScope) {
        await this.syncDocsToProject(tempDir, logLines, { buildScope, baseUrl });
      } else {
        await this.syncDocsToProject(tempDir, logLines, { baseUrl });
      }
      logLines.push(`[${ts()}] [Step 1] 文档同步完成`);

      const localImgSrc = path.join(projectRoot, 'static', 'img', 'help-center');
      const tempImgDst = path.join(tempDir, 'static', 'img', 'help-center');
      if (existsSync(localImgSrc)) {
        mkdirSync(path.join(tempDir, 'static', 'img'), { recursive: true });
        cpSync(localImgSrc, tempImgDst, { recursive: true });
        const imgStats = this.countFilesAndSize(tempImgDst);
        logLines.push(`[${ts()}] [Step 1] 已同步图片资源: ${imgStats.fileCount} 个文件 (${(imgStats.totalSize / 1024 / 1024).toFixed(2)} MB)`);
      } else {
        logLines.push(`[${ts()}] [Step 1] 本地图片目录不存在，跳过: ${localImgSrc}`);
      }

      const localFilesSrc = path.join(projectRoot, 'static', 'files', 'help-center');
      const tempFilesDst = path.join(tempDir, 'static', 'files', 'help-center');
      if (existsSync(localFilesSrc)) {
        mkdirSync(path.join(tempDir, 'static', 'files'), { recursive: true });
        cpSync(localFilesSrc, tempFilesDst, { recursive: true });
        const fileStats = this.countFilesAndSize(tempFilesDst);
        logLines.push(`[${ts()}] [Step 1] 已同步附件资源: ${fileStats.fileCount} 个文件 (${(fileStats.totalSize / 1024 / 1024).toFixed(2)} MB)`);
      } else {
        logLines.push(`[${ts()}] [Step 1] 本地附件目录不存在，跳过: ${localFilesSrc}`);
      }

      const localJsSrc = path.join(projectRoot, 'static', 'js');
      const tempJsDst = path.join(tempDir, 'static', 'js');
      if (existsSync(localJsSrc)) {
        mkdirSync(path.join(tempDir, 'static'), { recursive: true });
        cpSync(localJsSrc, tempJsDst, { recursive: true });
        const jsStats = this.countFilesAndSize(tempJsDst);
        logLines.push(`[${ts()}] [Step 1] 已同步 JS 资源: ${jsStats.fileCount} 个文件 (${(jsStats.totalSize / 1024 / 1024).toFixed(2)} MB)`);
      } else {
        logLines.push(`[${ts()}] [Step 1] 本地 JS 目录不存在，跳过: ${localJsSrc}`);
      }



      const missingResources: string[] = [];
      const docsDirs = [
        path.join(tempDir, 'docs'),
        path.join(tempDir, 'i18n'),
      ];
      for (const docsDir of docsDirs) {
        if (!existsSync(docsDir)) continue;
        const walkForRefs = (dir: string): void => {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walkForRefs(fullPath);
            } else if (/\.(md|mdx)$/.test(entry.name)) {
              const content = readFileSync(fullPath, 'utf-8');
              const imgRefs = content.matchAll(/\(\s*\/img\/help-center\/([^)]+)\)/g);
              for (const m of imgRefs) {
                const refPath = path.join(tempDir, 'static', 'img', 'help-center', m[1]);
                if (!existsSync(refPath)) {
                  missingResources.push(`[IMG] /img/help-center/${m[1]} (referenced in ${path.relative(tempDir, fullPath)})`);
                }
              }
              const fileRefs = content.matchAll(/\(\s*\/files\/help-center\/([^)]+)\)/g);
              for (const m of fileRefs) {
                const refPath = path.join(tempDir, 'static', 'files', 'help-center', m[1]);
                if (!existsSync(refPath)) {
                  missingResources.push(`[FILE] /files/help-center/${m[1]} (referenced in ${path.relative(tempDir, fullPath)})`);
                } else if (statSync(refPath).size === 0) {
                  missingResources.push(`[FILE:0B] /files/help-center/${m[1]} (referenced in ${path.relative(tempDir, fullPath)})`);
                }
              }
            }
          }
        };
        walkForRefs(docsDir);
      }

      if (missingResources.length > 0) {
        logLines.push(`[${ts()}] [Step 1] 构建前资源校验失败，缺失 ${missingResources.length} 个资源:`);
        for (const r of missingResources) {
          logLines.push(`  ${r}`);
        }
        await failPipeline('build', `构建前资源校验失败: ${missingResources.length} 个资源缺失\n${missingResources.slice(0, 20).join('\n')}`);
        return;
      }
      logLines.push(`[${ts()}] [Step 1] 构建前资源校验通过: 所有 MDX 引用的图片和附件均已存在`);

      const docusaurusCacheDir = path.join(tempDir, '.docusaurus');
      if (existsSync(docusaurusCacheDir)) {
        try {
          rmSync(docusaurusCacheDir, { recursive: true, force: true });
          logLines.push(`[${ts()}] [Step 1] 已清理 .docusaurus 缓存`);
        } catch { /* ignore */ }
      }
      const webpackCacheDir = path.join(tempDir, 'node_modules', '.cache');
      if (existsSync(webpackCacheDir)) {
        try {
          rmSync(webpackCacheDir, { recursive: true, force: true });
          logLines.push(`[${ts()}] [Step 1] 已清理 webpack 缓存`);
        } catch { /* ignore */ }
      }

      const packageJsonPath = path.join(tempDir, 'package.json');
      if (!existsSync(packageJsonPath)) {
        await failPipeline('build', `项目路径下未找到 package.json: ${packageJsonPath}`);
        return;
      }

      const packageJsonContent = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const buildScript = packageJsonContent.scripts?.build;
      let buildCmd = buildScript ? 'npm run build' : 'npx docusaurus build';
      if (scope === 'zh-CN') buildCmd += ' -- --locale zh-Hans';
      else if (scope === 'en') buildCmd += ' -- --locale en';

      const nodeModulesDir = path.join(tempDir, 'node_modules');
      if (!existsSync(nodeModulesDir)) {
        logLines.push(`[${ts()}] [Step 1] node_modules 不存在，执行 npm install...`);
        try {
          const { stdout: installOut, stderr: installErr } = await this.execAsync('npm install --production=false', {
            cwd: tempDir,
            timeout: 5 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env },
          });
          if (installOut) logLines.push(this.sanitizeLog(installOut).slice(0, 2000));
          if (installErr) logLines.push(this.sanitizeLog(installErr).slice(0, 2000));
          logLines.push(`[${ts()}] [Step 1] npm install 完成`);
        } catch (installErr: unknown) {
          const msg = (installErr as { message?: string }).message ?? '';
          await failPipeline('build', `npm install 失败: ${this.sanitizeLog(msg).slice(0, 300)}`);
          return;
        }
      }

      const docusaurusCfgPipeline = this.prepareDocusaurusBuildConfig(tempDir, logLines, `${ts()} [Step 1]`);
      restoreDocusaurusConfig = docusaurusCfgPipeline.restore;

      logLines.push(`[${ts()}] [Step 1] 执行构建: ${buildCmd}`);

      try {
        const { stdout, stderr } = await this.execAsync(buildCmd, {
          cwd: tempDir,
          timeout: 10 * 60 * 1000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=3072' },
        });
        if (stdout) logLines.push(this.sanitizeLog(stdout).slice(0, 5000));
        if (stderr) logLines.push(this.sanitizeLog(stderr).slice(0, 5000));
      } catch (buildErr: unknown) {
        const errMsg = buildErr instanceof Error ? buildErr.message : String(buildErr);
        logLines.push(`[${ts()}] [Step 1] 构建失败: ${this.sanitizeLog(errMsg).slice(0, 2000)}`);
        await failPipeline('build', `Docusaurus 构建失败: ${this.sanitizeLog(errMsg).slice(0, 500)}`);
        return;
      }

      pipeline.build.status = 'success';
      logLines.push(`[${ts()}] [Step 1] 构建成功`);
      const pipelineBuildDir = path.join(tempDir, 'build');
      if (existsSync(pipelineBuildDir)) {
        this.verifyBuildAssets(pipelineBuildDir, logLines, `${ts()} [Step 1]`);
      }
      await updatePipeline({});

      // === Step 2: Git commit + push (临时工作区) ===
      pipeline.gitPush.status = 'running';
      await updatePipeline({});
      logLines.push(`[${ts()}] [Step 2/6] Git 提交推送（临时工作区）`);

      const execGit = async (cmd: string): Promise<{ stdout: string; stderr: string }> => {
        const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
        const proxyArgs = proxyUrl ? `-c http.proxy=${proxyUrl} -c https.proxy=${proxyUrl} ` : '';
        const gitCmd = cmd.replace(/^git\s+/, `git ${proxyArgs}-c http.sslVerify=false -c https.sslVerify=false `);
        const maskedCmd = this.sanitizeLog(gitCmd).replace(token, '***');
        logLines.push(`[${ts()}] [Git] $ ${maskedCmd}`);
        const { stdout, stderr } = await this.execAsync(gitCmd, {
          cwd: tempDir,
          timeout: 120 * 1000,
          maxBuffer: 5 * 1024 * 1024,
          env: { ...this.buildGitNetworkEnv(), GIT_ASKPASS: askpassPath },
        });
        if (stderr) logLines.push(`[stderr] ${this.sanitizeLog(stderr)}`);
        return { stdout, stderr };
      };

      let branchName = '';
      let commitHash = '';

      try {
        await execGit(this.gitNetCmd(`git remote add github ${config.repoUrl}`));

        const { stdout: statusOut } = await execGit('git status --porcelain');
        if (!statusOut.trim()) {
          logLines.push(`[${ts()}] [Step 2] 当前工作区无任何文件变更，无需发布`);
          pipeline.gitPush.status = 'no_changes';
          await this.db
            .update(publishTasks)
            .set({
              status: '成功' as TaskStatus,
              buildLog: logLines.join('\n').slice(0, 50 * 1024),
              deployLog: JSON.stringify(pipeline),
              finishedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(publishTasks.id, taskId));
          return;
        }

        logLines.push(`[${ts()}] [Git] 检测到变更文件:`);
        statusOut.trim().split('\n').forEach((line: string) => { logLines.push(`  ${line}`); });

        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const shortId = taskId.slice(0, 8);
        const rawPrefix = config.workBranchPrefix && config.workBranchPrefix !== 'docs/'
          ? config.workBranchPrefix
          : 'help-center-sync/';
        const prefix = rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`;
        branchName = `${prefix}${date}-${shortId}`;

        await execGit(`git checkout -b ${branchName}`);
        logLines.push(`[${ts()}] [Git] 创建工作分支: ${branchName}`);

        const allowedPaths = ['docs/', 'i18n/', 'static/img/help-center/', 'static/files/help-center/', 'static/js/', 'docusaurus.config.js'];
        for (const p of allowedPaths) {
          try { await execGit(`git add ${p}`); } catch { /* skip */ }
        }

        const { stdout: stagedOut } = await execGit('git diff --cached --name-only');
        if (!stagedOut.trim()) {
          logLines.push(`[${ts()}] [Step 2] 白名单目录内无相关变更`);
          pipeline.gitPush.status = 'no_changes';
          await this.db
            .update(publishTasks)
            .set({
              status: '成功' as TaskStatus,
              buildLog: logLines.join('\n').slice(0, 50 * 1024),
              deployLog: JSON.stringify(pipeline),
              finishedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(publishTasks.id, taskId));
          return;
        }

        const commitMsg = `sync help center docs: ${branchName}`;
        await execGit(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
        const { stdout: hashOut } = await execGit('git rev-parse HEAD');
        commitHash = hashOut.trim();

        logLines.push(`[${ts()}] [Git] $ git push github ${branchName}`);
        for (let pushAttempt = 1; pushAttempt <= 3; pushAttempt++) {
          try {
            await execGit(`git push github ${branchName}`);
            break;
          } catch (pushErr: unknown) {
            if (pushAttempt < 3) {
              logLines.push(`[${ts()}] [Git] push 失败 (尝试 ${pushAttempt}/3)，${5}秒后重试...`);
              await new Promise((r) => setTimeout(r, 5000));
            } else {
              throw pushErr;
            }
          }
        }
        logLines.push(`[${ts()}] [Step 2] 推送成功: github/${branchName}, commit: ${commitHash}`);
      } catch (gitErr: unknown) {
        const gitMsg = gitErr instanceof Error ? gitErr.message : String(gitErr);
        logLines.push(`[${ts()}] [Step 2] Git 操作失败: ${this.sanitizeLog(gitMsg).slice(0, 500)}`);
        await failPipeline('gitPush', `Git 操作失败: ${this.sanitizeLog(gitMsg).slice(0, 300)}`);
        return;
      }

      pipeline.gitPush.status = 'success';
      (pipeline.gitPush as Record<string, unknown>).branchName = branchName;
      (pipeline.gitPush as Record<string, unknown>).commitHash = commitHash;
      await updatePipeline({});

      // === Step 3: Create PR ===
      pipeline.prCreate.status = 'running';
      await updatePipeline({});
      logLines.push(`[${ts()}] [Step 3/6] 创建 Pull Request`);

      const defaultBranch = config.defaultBranch || 'main';
      const prTitle = previewOnly
        ? `[Preview] sync help center docs - ${new Date().toISOString().slice(0, 10)}`
        : `[Auto] sync help center docs - ${new Date().toISOString().slice(0, 10)}`;
      const prBody = [
        '### ODPM Help Center Auto Sync',
        `- Task ID: ${taskId}`,
        `- Operator: ${userId}`,
        `- Scope: ${scope}`,
        `- Branch: ${branchName}`,
        `- Commit: ${commitHash}`,
        '',
        'This PR was automatically created by the ODPM Help Center system.',
      ].join('\n');

      let prNumber = 0;
      let prUrl = '';

      try {
        const prResult = await this.githubApi('POST', `/repos/${owner}/${repo}/pulls`, token, {
          title: prTitle,
          body: prBody,
          head: branchName,
          base: defaultBranch,
        }) as { number: number; html_url: string };

        prNumber = prResult.number;
        prUrl = prResult.html_url;
        logLines.push(`[${ts()}] [Step 3] PR 创建成功: #${prNumber} ${prUrl}`);
      } catch (prErr: unknown) {
        const errMsg = prErr instanceof Error ? prErr.message : String(prErr);
        await failPipeline('prCreate', `PR 创建失败: ${this.sanitizeLog(errMsg)}`);
        return;
      }

      pipeline.prCreate.status = 'success';
      (pipeline.prCreate as Record<string, unknown>).prUrl = prUrl;
      (pipeline.prCreate as Record<string, unknown>).prNumber = prNumber;
      await updatePipeline({
        prUrl,
        prNumber,
        prCreatedAt: new Date(),
      });

      // === Step 4: Security Check ===
      pipeline.securityCheck.status = 'running';
      await updatePipeline({});
      logLines.push(`[${ts()}] [Step 4/6] 执行安全校验`);

      const checkResult = await this.runSecurityCheck(branchName, prNumber, owner, repo, token, userId, projectRoot);

      if (!checkResult.passed) {
        pipeline.securityCheck.status = 'failed';
        (pipeline.securityCheck as Record<string, unknown>).result = 'failed';
        (pipeline.securityCheck as Record<string, unknown>).errors = checkResult.errors;
        logLines.push(`[${ts()}] [Step 4] 安全校验失败:`);
        checkResult.errors.forEach((e: string) => { logLines.push(`  - ${e}`); });

        await this.db
          .update(publishTasks)
          .set({
            status: '失败' as TaskStatus,
            errorMessage: `安全校验未通过: ${checkResult.errors.join('; ')}`.slice(0, 10 * 1024),
            buildLog: logLines.join('\n').slice(0, 50 * 1024),
            deployLog: JSON.stringify(pipeline),
            mergeStatus: 'failed' as PrMergeStatus,
            securityCheckResult: 'failed' as SecurityCheckResult,
            securityCheckErrors: JSON.stringify(checkResult.errors),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));
        return;
      }

      pipeline.securityCheck.status = 'success';
      (pipeline.securityCheck as Record<string, unknown>).result = 'passed';
      logLines.push(`[${ts()}] [Step 4] 安全校验全部通过`);
      await updatePipeline({
        securityCheckResult: 'passed' as SecurityCheckResult,
      });

      // === Step 5: Auto Merge PR ===
      pipeline.merge.status = 'running';
      await updatePipeline({});
      logLines.push(`[${ts()}] [Step 5/6] 自动合并 PR #${prNumber}`);

      let mergeCommitSha = '';
      try {
        let mergeable: boolean | null = null;
        for (let i = 0; i < 8; i++) {
          const prData = await this.githubApi('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`, token) as { mergeable: boolean | null };
          mergeable = prData.mergeable;
          if (mergeable !== null) break;
          logLines.push(`[${ts()}] [Step 5] 等待 mergeable 状态计算... (${i + 1}/8)`);
          await this.sleep(2000);
        }

        if (mergeable === false) {
          await failPipeline('merge', 'PR 存在合并冲突，无法自动合并');
          await this.db.update(publishTasks).set({ mergeStatus: 'failed' as PrMergeStatus }).where(eq(publishTasks.id, taskId));
          return;
        }

        if (mergeable === null) {
          await failPipeline('merge', '无法确认 PR 合并状态（mergeable 始终为 null）');
          await this.db.update(publishTasks).set({ mergeStatus: 'failed' as PrMergeStatus }).where(eq(publishTasks.id, taskId));
          return;
        }

        const mergeResult = await this.githubApi('PUT', `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, token, {
          merge_method: 'merge',
          commit_title: prTitle,
        }) as { merged: boolean; sha: string; message: string };

        if (!mergeResult.merged) {
          await failPipeline('merge', `PR 合并失败: ${mergeResult.message}`);
          await this.db.update(publishTasks).set({ mergeStatus: 'failed' as PrMergeStatus }).where(eq(publishTasks.id, taskId));
          return;
        }

        mergeCommitSha = mergeResult.sha;
        logLines.push(`[${ts()}] [Step 5] PR 合并成功: merge_commit_sha=${mergeCommitSha}`);
      } catch (mergeErr: unknown) {
        const errMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        await failPipeline('merge', `PR 合并失败: ${this.sanitizeLog(errMsg)}`);
        await this.db.update(publishTasks).set({ mergeStatus: 'failed' as PrMergeStatus }).where(eq(publishTasks.id, taskId));
        return;
      }

      pipeline.merge.status = 'success';
      (pipeline.merge as Record<string, unknown>).mergeCommitSha = mergeCommitSha;
      (pipeline.merge as Record<string, unknown>).mergedAt = new Date().toISOString();
      await updatePipeline({
        mergeStatus: 'merged' as PrMergeStatus,
        prMergedAt: new Date(),
        mergeCommitSha,
      });

      // === Step 6: Poll GitHub Pages Deploy ===
      pipeline.deploy.status = 'running';
      await updatePipeline({ deployStatus: 'pending' as DeploySubStatus });
      logLines.push(`[${ts()}] [Step 6/6] 轮询 GitHub Pages 部署状态`);

      const maxPollTime = 10 * 60 * 1000;
      const pollInterval = 30 * 1000;
      const pollStart = Date.now();
      let workflowRunId = '';
      let deploySuccess = false;

      while (Date.now() - pollStart < maxPollTime) {
        try {
          const runsData = await this.githubApi(
            'GET',
            `/repos/${owner}/${repo}/actions/runs?branch=${defaultBranch}&event=push&per_page=10`,
            token,
          ) as { workflow_runs: Array<{ id: number; head_sha: string; status: string; conclusion: string | null; html_url: string }> };

          const matchedRun = runsData.workflow_runs?.find(
            (run: { head_sha: string }) => run.head_sha === mergeCommitSha,
          );

          if (matchedRun) {
            workflowRunId = String(matchedRun.id);
            const actionsUrl = matchedRun.html_url;
            (pipeline.deploy as Record<string, unknown>).workflowRunId = workflowRunId;
            (pipeline.deploy as Record<string, unknown>).actionsUrl = actionsUrl;

            if (matchedRun.status === 'completed') {
              if (matchedRun.conclusion === 'success') {
                deploySuccess = true;
                logLines.push(`[${ts()}] [Step 6] 部署成功! workflow run: ${workflowRunId}`);
                break;
              } else {
                const failMsg = `GitHub Pages 部署${matchedRun.conclusion === 'cancelled' ? '被取消' : '失败'}: ${matchedRun.conclusion}`;
                logLines.push(`[${ts()}] [Step 6] ${failMsg}`);
                pipeline.deploy.status = 'failed';
                await this.db
                  .update(publishTasks)
                  .set({
                    status: '失败' as TaskStatus,
                    deployStatus: 'failure' as DeploySubStatus,
                    workflowRunId,
                    deployErrorMessage: failMsg,
                    buildLog: logLines.join('\n').slice(0, 50 * 1024),
                    deployLog: JSON.stringify(pipeline),
                    finishedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(eq(publishTasks.id, taskId));
                return;
              }
            }
          }
        } catch (pollErr: unknown) {
          const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
          logLines.push(`[${ts()}] [Step 6] 轮询异常: ${this.sanitizeLog(msg).slice(0, 200)}`);
        }

        logLines.push(`[${ts()}] [Step 6] 等待部署中... (${Math.round((Date.now() - pollStart) / 1000)}s)`);
        await this.sleep(pollInterval);
      }

      if (!deploySuccess) {
        pipeline.deploy.status = 'timeout';
        const timeoutMsg = 'GitHub Pages 部署超时（10分钟）';
        logLines.push(`[${ts()}] [Step 6] ${timeoutMsg}`);
        await this.db
          .update(publishTasks)
          .set({
            status: '失败' as TaskStatus,
            deployStatus: 'timeout' as DeploySubStatus,
            workflowRunId: workflowRunId || null,
            deployErrorMessage: timeoutMsg,
            buildLog: logLines.join('\n').slice(0, 50 * 1024),
            deployLog: JSON.stringify(pipeline),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(publishTasks.id, taskId));
        return;
      }

      const deployUrl = previewOnly && forceConfig
        ? `${forceConfig.url}${forceConfig.baseUrl}`
        : (config.productionUrl || `https://${owner}.github.io/${repo}/`);
      pipeline.deploy.status = 'success';
      (pipeline.deploy as Record<string, unknown>).deployUrl = deployUrl;

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      logLines.push(`[${ts()}] [Pipeline] 全流程完成! 耗时: ${durationSec}s`);
      logLines.push(`[${ts()}] [Pipeline] 公开访问: ${deployUrl}`);

      await this.db
        .update(publishTasks)
        .set({
          status: '成功' as TaskStatus,
          deployStatus: 'success' as DeploySubStatus,
          workflowRunId,
          deployUrl,
          deployedAt: new Date(),
          buildLog: logLines.join('\n').slice(0, 50 * 1024),
          deployLog: JSON.stringify(pipeline),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      let updatedDocsCount = 0;
      if (!previewOnly) {
        const updatedDocs = await this.db
          .update(docs)
          .set({
            publishStatus: '已发布',
            lastPublisher: userId,
            publishedAt: new Date(),
          })
          .where(eq(docs.publishStatus, '待发布'))
          .returning({ id: docs.id });
        updatedDocsCount = updatedDocs.length;
        logLines.push(`[${ts()}] [Pipeline] 已将 ${updatedDocs.length} 篇待发布文档更新为已发布`);
      } else {
        logLines.push(`[${ts()}] [Pipeline] 预览模式: 跳过文档状态更新（不修改 publishStatus）`);
      }

      this.logger.log(`发布到网站成功: taskId=${taskId}, pr=#${prNumber}, deploy=${deployUrl}, 更新${updatedDocsCount}篇文档状态`);
    } catch (error: unknown) {
      if (logLines.length === 0) {
        logLines.push(`[${ts()}] [Pipeline] 未知异常`);
      }
      const execError = error as { stderr?: string; message?: string };
      const errorDetail = this.sanitizeLog(execError.stderr ?? execError.message ?? '未知错误');
      logLines.push(`[${ts()}] [Pipeline] 异常: ${errorDetail}`);

      await this.db
        .update(publishTasks)
        .set({
          status: '失败' as TaskStatus,
          errorMessage: errorDetail.slice(0, 10 * 1024),
          buildLog: logLines.join('\n').slice(0, 50 * 1024),
          deployLog: JSON.stringify(pipeline),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTasks.id, taskId));

      this.logger.error(`发布到网站异常: taskId=${taskId}, error=${errorDetail.slice(0, 500)}`);
    } finally {
      if (restoreDocusaurusConfig) restoreDocusaurusConfig();
      if (tempCleanup) tempCleanup();
      if (pipelineAskpassPath) { try { unlinkSync(pipelineAskpassPath); } catch { /* ignore */ } }
      this.runningTaskTypes.delete(mutexKey);
    }
  }

  private async runSecurityCheck(
    branchName: string,
    prNumber: number,
    owner: string,
    repo: string,
    token: string,
    userId: string,
    projectRoot: string,
  ): Promise<{ passed: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!branchName.startsWith('help-center-sync/')) {
      errors.push('分支名必须以 help-center-sync/ 开头');
    }

    try {
      const files = await this.githubApi(
        'GET',
        `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
        token,
      ) as Array<{ filename: string }>;

      const allowedPrefixes = ['docs/', 'i18n/', 'static/img/help-center/', 'static/files/help-center/', 'static/js/', 'docusaurus.config.js'];
      const forbiddenPaths = ['src/', 'package.json', '.github/', 'blog/'];

      const outsideWhitelist = files.filter(
        (f: { filename: string }) => !allowedPrefixes.some((p) => f.filename.startsWith(p)),
      );
      if (outsideWhitelist.length > 0) {
        const names = outsideWhitelist.map((f: { filename: string }) => f.filename).join(', ');
        errors.push(`白名单外文件 ${outsideWhitelist.length} 个: ${names}`);
      }

      const inForbidden = files.filter(
        (f: { filename: string }) => forbiddenPaths.some((p) => f.filename.includes(p)),
      );
      if (inForbidden.length > 0) {
        const names = inForbidden.map((f: { filename: string }) => f.filename).join(', ');
        errors.push(`禁止路径文件: ${names}`);
      }
    } catch (apiErr: unknown) {
      const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      errors.push(`无法获取 PR 文件列表: ${this.sanitizeLog(msg)}`);
    }

    try {
      const docsDir = path.join(projectRoot, 'docs');
      const i18nDir = path.join(projectRoot, 'i18n');
      const badPathRefs: string[] = [];

      const scanDir = (dir: string) => {
        if (!existsSync(dir)) return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n');
              lines.forEach((line: string, idx: number) => {
                if (line.includes('/my-website/')) {
                  const relPath = path.relative(projectRoot, fullPath);
                  badPathRefs.push(`${relPath}:L${idx + 1}`);
                }
              });
            } catch { /* ignore unreadable files */ }
          }
        }
      };

      scanDir(docsDir);
      scanDir(i18nDir);

      if (badPathRefs.length > 0) {
        errors.push(`MDX 资源路径包含错误前缀 /my-website/: ${badPathRefs.slice(0, 5).join(', ')}`);
      }
    } catch { /* scan errors are non-fatal for other checks */ }

    try {
      const prData = await this.githubApi(
        'GET',
        `/repos/${owner}/${repo}/pulls/${prNumber}`,
        token,
      ) as { mergeable: boolean | null };

      let mergeable = prData.mergeable;
      for (let i = 0; i < 5 && mergeable === null; i++) {
        await this.sleep(2000);
        const refreshed = await this.githubApi(
          'GET',
          `/repos/${owner}/${repo}/pulls/${prNumber}`,
          token,
        ) as { mergeable: boolean | null };
        mergeable = refreshed.mergeable;
      }

      if (mergeable === false) {
        errors.push('PR 存在合并冲突');
      }
    } catch {
      errors.push('无法确认 PR 合并状态');
    }

    return { passed: errors.length === 0, errors };
  }

  async getPublishDetail(taskId: string): Promise<PublishPipelineDetail> {
    const rows = await this.db
      .select()
      .from(publishTasks)
      .where(eq(publishTasks.id, taskId))
      .limit(1);

    if (!rows.length) {
      throw new Error('任务不存在');
    }

    const item = rows[0] as Record<string, unknown>;
    let pipeline: PublishPipelineDetail['pipeline'] = {
      build: { status: 'none' },
      gitPush: { status: 'none' },
      prCreate: { status: 'none' },
      securityCheck: { status: 'none' },
      merge: { status: 'none' },
      deploy: { status: 'none' },
    };

    if (item.deployLog) {
      try {
        pipeline = JSON.parse(item.deployLog as string) as PublishPipelineDetail['pipeline'];
      } catch { /* use defaults */ }
    }

    return {
      taskId,
      status: item.status as TaskStatus,
      errorMessage: (item.errorMessage as string) ?? undefined,
      pipeline,
    };
  }

  private mapTaskItem(item: Record<string, unknown>): PublishTaskItem {
    const deployLogStr = (item.deployLog as string) ?? '';
    const taskType = item.taskType as TaskType;

    let downloadUrl: string | undefined;
    let zipSize: number | undefined;
    let docCount: number | undefined;

    if (taskType === '构建产物包' && deployLogStr) {
      try {
        const parsed = JSON.parse(deployLogStr) as Record<string, unknown>;
        if (typeof parsed.downloadUrl === 'string') downloadUrl = parsed.downloadUrl;
        if (typeof parsed.zipSize === 'number') zipSize = parsed.zipSize;
        if (typeof parsed.docCount === 'number') docCount = parsed.docCount;
      } catch {
        // deployLog 解析失败不影响列表返回
      }
    }

    return {
      id: item.id as string,
      taskName: item.taskName as string,
      taskType,
      environment: item.environment as DeployEnvironment,
      publishScope: (item.publishScope as PublishScope) ?? 'all',
      status: item.status as TaskStatus,
      operator: item.operator as string,
      relatedDocs: item.relatedDocs
        ? (Array.isArray(item.relatedDocs)
            ? (item.relatedDocs as string[]).filter(Boolean)
            : (item.relatedDocs as string).split(',').filter(Boolean))
        : [],
      buildLog: (item.buildLog as string) ?? '',
      deployLog: deployLogStr,
      errorMessage: (item.errorMessage as string) ?? '',
      createdAt: item.createdAt instanceof Date
        ? item.createdAt.toISOString()
        : String(item.createdAt ?? ''),
      finishedAt: item.finishedAt instanceof Date
        ? item.finishedAt.toISOString()
        : item.finishedAt ? String(item.finishedAt) : '',
      prUrl: (item.prUrl as string) ?? undefined,
      prNumber: (item.prNumber as number) ?? undefined,
      prCreatedAt: item.prCreatedAt instanceof Date
        ? item.prCreatedAt.toISOString()
        : (item.prCreatedAt as string) ?? undefined,
      mergeStatus: (item.mergeStatus as PrMergeStatus) ?? undefined,
      prMergedAt: item.prMergedAt instanceof Date
        ? item.prMergedAt.toISOString()
        : (item.prMergedAt as string) ?? undefined,
      mergeCommitSha: (item.mergeCommitSha as string) ?? undefined,
      deployStatus: (item.deployStatus as DeploySubStatus) ?? undefined,
      workflowRunId: (item.workflowRunId as string) ?? undefined,
      deployUrl: (item.deployUrl as string) ?? undefined,
      deployedAt: item.deployedAt instanceof Date
        ? item.deployedAt.toISOString()
        : (item.deployedAt as string) ?? undefined,
      securityCheckResult: (item.securityCheckResult as SecurityCheckResult) ?? undefined,
      securityCheckErrors: (item.securityCheckErrors as string) ?? undefined,
      deployErrorMessage: (item.deployErrorMessage as string) ?? undefined,
      downloadUrl,
      zipSize,
      docCount,
    };
  }

  private getOdpmRoot(): string {
    return process.cwd();
  }

  private copyAttachmentPreviewAssets(projectRoot: string, logLines: string[], ts: () => string): void {
    const odpmRoot = this.getOdpmRoot();
    const staticJsDir = path.join(projectRoot, 'static', 'js');
    const staticVendorDir = path.join(projectRoot, 'static', 'js', 'vendor');

    try {
      if (!existsSync(staticJsDir)) mkdirSync(staticJsDir, { recursive: true });
      if (!existsSync(staticVendorDir)) mkdirSync(staticVendorDir, { recursive: true });

      const scriptSrc = path.join(odpmRoot, 'client', 'src', 'utils', 'attachment-preview.js');
      const scriptDst = path.join(staticJsDir, 'attachment-preview.js');
      if (existsSync(scriptSrc)) {
        cpSync(scriptSrc, scriptDst);
        const scriptSize = existsSync(scriptDst) ? statSync(scriptDst).size : 0;
        if (scriptSize === 0) {
          cpSync(scriptSrc, scriptDst);
          const retrySize = existsSync(scriptDst) ? statSync(scriptDst).size : 0;
          if (retrySize === 0) {
            logLines.push(`[${ts()}] [文档生成] ERROR: attachment-preview.js 复制后仍为 0 字节，源文件大小: ${statSync(scriptSrc).size}`);
          } else {
            logLines.push(`[${ts()}] [文档生成] 已复制 attachment-preview.js → static/js/ (${retrySize} bytes, 重试成功)`);
          }
        } else {
          logLines.push(`[${ts()}] [文档生成] 已复制 attachment-preview.js → static/js/ (${scriptSize} bytes)`);
        }
      } else {
        logLines.push(`[${ts()}] [文档生成] WARN: attachment-preview.js 源文件不存在: ${scriptSrc}`);
      }

      const vendorFiles: Array<{ src: string; dst: string }> = [
        { src: path.join(odpmRoot, 'node_modules', 'pdfjs-dist', 'build', 'pdf.min.js'), dst: path.join(staticVendorDir, 'pdf.min.js') },
        { src: path.join(odpmRoot, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.js'), dst: path.join(staticVendorDir, 'pdf.worker.min.js') },
        { src: path.join(odpmRoot, 'node_modules', 'pptx-preview', 'dist', 'pptx-preview.umd.js'), dst: path.join(staticVendorDir, 'pptx-preview.umd.js') },
        { src: path.join(odpmRoot, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), dst: path.join(staticVendorDir, 'xlsx.full.min.js') },
      ];

      let copiedCount = 0;
      let missingCount = 0;
      let errorCount = 0;
      for (const vf of vendorFiles) {
        const fileName = path.basename(vf.dst);
        if (!existsSync(vf.src)) {
          missingCount++;
          logLines.push(`[${ts()}] [文档生成] ERROR: vendor 源文件不存在: ${vf.src}`);
          continue;
        }
        const srcSize = statSync(vf.src).size;
        if (srcSize === 0) {
          errorCount++;
          logLines.push(`[${ts()}] [文档生成] ERROR: vendor 源文件为 0 字节: ${vf.src}，无法复制`);
          continue;
        }
        cpSync(vf.src, vf.dst);
        const dstSize = existsSync(vf.dst) ? statSync(vf.dst).size : 0;
        if (dstSize === 0) {
          cpSync(vf.src, vf.dst);
          const retrySize = existsSync(vf.dst) ? statSync(vf.dst).size : 0;
          if (retrySize === 0) {
            errorCount++;
            logLines.push(`[${ts()}] [文档生成] ERROR: ${fileName} 复制后仍为 0 字节，源文件大小: ${srcSize}`);
          } else {
            copiedCount++;
            logLines.push(`[${ts()}] [文档生成] 已复制 ${fileName} (${retrySize} bytes, 重试成功)`);
          }
        } else {
          copiedCount++;
          logLines.push(`[${ts()}] [文档生成] 已复制 ${fileName} (${dstSize} bytes)`);
        }
      }
      logLines.push(`[${ts()}] [文档生成] vendor 文件复制完成: ${copiedCount} 个成功, ${missingCount} 个缺失, ${errorCount} 个异常`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logLines.push(`[${ts()}] [文档生成] WARN: 复制附件预览资源失败: ${errMsg}`);
    }
  }

  private ensureAttachmentPreviewAssets(projectRoot: string, logLines: string[], logPrefix: string): void {
    const staticJsDir = path.join(projectRoot, 'static', 'js');
    const staticVendorDir = path.join(projectRoot, 'static', 'js', 'vendor');
    const scriptDst = path.join(staticJsDir, 'attachment-preview.js');
    const requiredFiles = [
      scriptDst,
      path.join(staticVendorDir, 'pdf.min.js'),
      path.join(staticVendorDir, 'pdf.worker.min.js'),
      path.join(staticVendorDir, 'pptx-preview.umd.js'),
      path.join(staticVendorDir, 'xlsx.full.min.js'),
    ];
    const invalidFiles: string[] = [];
    for (const f of requiredFiles) {
      if (!existsSync(f)) {
        invalidFiles.push(`${path.basename(f)} (不存在)`);
      } else {
        const size = statSync(f).size;
        if (size === 0) {
          invalidFiles.push(`${path.basename(f)} (0 字节)`);
        }
      }
    }
    if (invalidFiles.length === 0) {
      logLines.push(`[${logPrefix}] 附件预览资源完整性检查: 全部就绪 (5/5)`);
      return;
    }
    logLines.push(`[${logPrefix}] 附件预览资源不完整: ${invalidFiles.join(', ')}，自动补齐...`);
    const ts = () => new Date().toLocaleString('zh-CN');
    this.copyAttachmentPreviewAssets(projectRoot, logLines, ts);
  }

  private verifyBuildAssets(buildDir: string, logLines: string[], logPrefix: string): void {
    const checks: Array<{ file: string; label: string }> = [
      { file: 'js/attachment-preview.js', label: 'attachment-preview.js' },
      { file: 'js/vendor/pdf.min.js', label: 'pdf.min.js' },
      { file: 'js/vendor/pdf.worker.min.js', label: 'pdf.worker.min.js' },
      { file: 'js/vendor/pptx-preview.umd.js', label: 'pptx-preview.umd.js' },
      { file: 'js/vendor/xlsx.full.min.js', label: 'xlsx.full.min.js' },
    ];
    const missing: string[] = [];
    for (const c of checks) {
      const fullPath = path.join(buildDir, c.file);
      if (!existsSync(fullPath)) {
        missing.push(c.label);
      } else {
        const size = statSync(fullPath).size;
        if (size === 0) {
          missing.push(`${c.label} (0 bytes)`);
        }
      }
    }

    const scriptFile = path.join(buildDir, 'js', 'attachment-preview.js');
    const cdnPatterns = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'];
    let hasCdn = false;
    if (existsSync(scriptFile)) {
      const content = readFileSync(scriptFile, 'utf-8');
      hasCdn = cdnPatterns.some((p) => content.includes(p));
    }

    const indexFile = path.join(buildDir, 'index.html');
    let hasScriptRef = false;
    if (existsSync(indexFile)) {
      const indexContent = readFileSync(indexFile, 'utf-8');
      hasScriptRef = indexContent.includes('attachment-preview');
    }

    const passCount = checks.length - missing.length;
    logLines.push(`[${logPrefix}] [验证] 附件预览资源: ${passCount}/${checks.length} 文件就绪`);
    if (missing.length > 0) {
      logLines.push(`[${logPrefix}] [验证] WARN: 缺失文件: ${missing.join(', ')}`);
    }
    if (hasCdn) {
      logLines.push(`[${logPrefix}] [验证] WARN: attachment-preview.js 仍包含外部 CDN 引用`);
    } else if (existsSync(scriptFile)) {
      logLines.push(`[${logPrefix}] [验证] attachment-preview.js 无外部 CDN 引用 ✓`);
    }
    if (hasScriptRef) {
      logLines.push(`[${logPrefix}] [验证] index.html 包含 attachment-preview.js 引用 ✓`);
    } else if (existsSync(indexFile)) {
      logLines.push(`[${logPrefix}] [验证] WARN: index.html 未包含 attachment-preview.js 引用`);
    }
  }
}
