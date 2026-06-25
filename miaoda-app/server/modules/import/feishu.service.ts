import { config } from 'dotenv';
import { join } from 'path';
import * as http from 'http';
import * as tls from 'tls';
import * as net from 'net';

config({ path: join(process.cwd(), '.env') });

import { Injectable, Logger } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuErrorCategory, DrivePermissionCheckResponse, DrivePermissionCheckItem, DrivePermissionDebugInfo } from '@shared/api.interface';

export interface FeishuErrorInfo {
  message: string;
  category: FeishuErrorCategory;
}

export type DownloadResult =
  | { buffer: Buffer; error?: undefined; statusCode?: undefined; apiCode?: undefined; apiMsg?: undefined; responseHeaders?: undefined }
  | { buffer?: undefined; error: string; statusCode?: number; apiCode?: number; apiMsg?: string; responseHeaders?: Record<string, string> };

class FeishuApiError extends Error {
  readonly category: FeishuErrorCategory;
  constructor(info: FeishuErrorInfo) {
    super(info.message);
    this.name = 'FeishuApiError';
    this.category = info.category;
  }
}

@Injectable()
export class FeishuService {
  private readonly logger = new Logger(FeishuService.name);
  private client: lark.Client | null = null;
  private clientInitialized = false;

  private ensureClient(): lark.Client {
    if (!this.clientInitialized) {
      this.clientInitialized = true;
      const noProxy = process.env.NO_PROXY || '';
      if (!noProxy.includes('feishu.cn') && !noProxy.includes('*')) {
        process.env.NO_PROXY = [noProxy, 'open.feishu.cn', '*.feishu.cn'].filter(Boolean).join(',');
      }
      const appId = (process.env.FEISHU_APP_ID ?? '').trim();
      const appSecret = (process.env.FEISHU_APP_SECRET ?? '').trim();
      if (!appId || !appSecret) {
        this.logger.warn(
          '飞书应用凭证未配置，请设置环境变量 FEISHU_APP_ID 和 FEISHU_APP_SECRET',
        );
        this.client = null;
        return null as never;
      }
      this.logger.log(
        `飞书凭证已加载 appId=${appId.slice(0, 6)}...${appId.slice(-4)}, secretLen=${appSecret.length}`,
      );
      this.client = new lark.Client({
        appId,
        appSecret,
        appType: lark.AppType.SelfBuild,
        domain: lark.Domain.Feishu,
      });
    }
    return this.client!;
  }

  isConfigured(): boolean {
    try {
      return this.ensureClient() !== null;
    } catch {
      return false;
    }
  }

  getClient(): lark.Client {
    const client = this.ensureClient();
    if (!client) {
      throw new Error('飞书应用凭证未配置');
    }
    return client;
  }

  static parseDocToken(feishuUrl: string): { token: string; isWiki: boolean } {
    try {
      const url = new URL(feishuUrl);
      const docxMatch = url.pathname.match(/\/docx\/([^/?#]+)/);
      if (docxMatch?.[1]) return { token: docxMatch[1], isWiki: false };
      const wikiMatch = url.pathname.match(/\/wiki\/([^/?#]+)/);
      if (wikiMatch?.[1]) return { token: wikiMatch[1], isWiki: true };
    } catch {
      const docxDirect = feishuUrl.match(/\/docx\/([^/?#]+)/);
      if (docxDirect?.[1]) return { token: docxDirect[1], isWiki: false };
    }
    throw new Error(`无法从 URL 中提取飞书文档 token: ${feishuUrl}`);
  }

  async resolveWikiToken(wikiNodeToken: string): Promise<string> {
    const client = this.getClient();
    try {
      const res = await client.wiki.space.getNode({
        params: { token: wikiNodeToken },
      });
      if (res.code !== 0) {
        const info: FeishuErrorInfo = {
          message: `解析知识库文档失败 [${res.code}]: ${res.msg}`,
          category: res.code === 99991672 ? 'app_permission' : res.code === 1770032 ? 'wiki_permission' : 'unknown',
        };
        throw new FeishuApiError(info);
      }
      const node = res.data?.node;
      if (!node?.obj_token) {
        throw new FeishuApiError({ message: '知识库节点未返回文档 token', category: 'link_parse_error' });
      }
      if (node.obj_type !== 'docx') {
        throw new FeishuApiError({ message: `知识库节点类型 "${node.obj_type}" 不支持，仅支持 docx 类型`, category: 'link_parse_error' });
      }
      return node.obj_token;
    } catch (err: unknown) {
      if (err instanceof FeishuApiError) throw err;
      this.throwFeishuError('解析知识库文档失败', err);
    }
  }

  private extractFeishuError(err: unknown): FeishuErrorInfo {
    const e = err as {
      response?: { data?: { code?: number; msg?: string } };
      code?: number;
      msg?: string;
      message?: string;
    };
    const feishuCode = e.response?.data?.code ?? e.code;
    const feishuMsg = e.response?.data?.msg ?? e.msg;
    const rawMessage = e.message ?? '';
    if (feishuCode === 99991672) {
      return {
        message: `[99991672] ${feishuMsg ?? '应用缺少所需权限'}`,
        category: 'app_permission',
      };
    }
    if (feishuCode === 1770032) {
      const isWikiContext = rawMessage.includes('知识库') || rawMessage.includes('wiki');
      return {
        message: `[1770032] ${feishuMsg ?? '飞书应用无权访问该文档'}`,
        category: isWikiContext ? 'wiki_permission' : 'doc_permission',
      };
    }
    if (feishuCode === 1770002) {
      return {
        message: `[1770002] ${feishuMsg ?? '文档不存在或无权限访问'}`,
        category: 'doc_permission',
      };
    }
    if (feishuCode === 131006) {
      return {
        message: `[131006] ${feishuMsg ?? '节点权限被拒绝，应用无该文档的读取权限'}`,
        category: 'doc_permission',
      };
    }
    if (feishuCode === 99991663 || feishuCode === 99991664) {
      return {
        message: `[${feishuCode}] ${feishuMsg ?? 'access_token 无效或已过期'}`,
        category: 'credential_missing',
      };
    }
    if (feishuMsg) {
      return { message: `[${feishuCode}] ${feishuMsg}`, category: 'unknown' };
    }
    if (rawMessage.includes('凭证未配置') || rawMessage.includes('FEISHU_APP')) {
      return { message: rawMessage, category: 'credential_missing' };
    }
    if (rawMessage.includes('无法从 URL') || rawMessage.includes('知识库节点') || rawMessage.includes('不支持')) {
      return { message: rawMessage, category: 'link_parse_error' };
    }
    return { message: rawMessage || '未知飞书 API 错误', category: 'unknown' };
  }

  static classifyError(errorMsg: string): FeishuErrorCategory {
    if (errorMsg.includes('凭证未配置') || errorMsg.includes('FEISHU_APP')) return 'credential_missing';
    if (errorMsg.includes('[99991672]')) return 'app_permission';
    if (errorMsg.includes('[1770032]') && (errorMsg.includes('知识库') || errorMsg.includes('wiki'))) return 'wiki_permission';
    if (errorMsg.includes('[1770032]') || errorMsg.includes('[1770002]') || errorMsg.includes('[131006]')) return 'doc_permission';
    if (errorMsg.includes('无法从 URL') || errorMsg.includes('知识库节点') || errorMsg.includes('不支持')) return 'link_parse_error';
    return 'unknown';
  }

  private throwFeishuError(prefix: string, err: unknown): never {
    const info = this.extractFeishuError(err);
    throw new FeishuApiError({ message: `${prefix}: ${info.message}`, category: info.category });
  }

  async fetchDocumentMeta(docToken: string): Promise<{ title: string }> {
    const client = this.getClient();
    try {
      const res = await client.docx.document.get({
        path: { document_id: docToken },
      });
      if (res.code !== 0) {
        this.throwFeishuError('获取飞书文档元信息失败', { code: res.code, msg: res.msg });
      }
      return { title: res.data?.document?.title ?? '' };
    } catch (err: unknown) {
      if (err instanceof FeishuApiError) throw err;
      this.throwFeishuError('获取飞书文档元信息失败', err);
    }
  }

  async fetchDocumentBlocks(
    docToken: string,
  ): Promise<Record<string, unknown>[]> {
    const client = this.getClient();
    try {
      const res = await client.docx.documentBlock.list({
        path: { document_id: docToken },
      });
      if (res.code !== 0) {
        this.throwFeishuError('获取飞书文档 Block 列表失败', { code: res.code, msg: res.msg });
      }
      const blocks = (res.data?.items ?? []) as Record<string, unknown>[];
      const blockIds = new Set(blocks.map((b: Record<string, unknown>) => b.block_id as string));
      const missingChildren: string[] = [];
      for (const block of blocks) {
        const children = block.children as string[] | undefined;
        if (children) {
          for (const childId of children) {
            if (!blockIds.has(childId)) {
              missingChildren.push(childId);
            }
          }
        }
      }
      if (missingChildren.length > 0) {
        const childBlocks = await this.fetchChildBlocks(docToken, missingChildren);
        this.logger.log(`fetchDocumentBlocks: top=${blocks.length}, fetched ${childBlocks.length} nested blocks`);
        blocks.push(...childBlocks);
      }
      return blocks;
    } catch (err: unknown) {
      if (err instanceof FeishuApiError) throw err;
      this.throwFeishuError('获取飞书文档 Block 列表失败', err);
    }
  }

  private async fetchChildBlocks(
    docToken: string,
    parentBlockIds: string[],
  ): Promise<Record<string, unknown>[]> {
    const client = this.getClient();
    const allChildren: Record<string, unknown>[] = [];
    for (const blockId of parentBlockIds) {
      try {
        const res = await client.request({
          method: 'GET',
          url: `https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}/blocks/${blockId}/children`,
          params: { page_size: 500 },
        });
        const items = (res?.data?.items ?? res?.items ?? []) as Record<string, unknown>[];
        allChildren.push(...items);
      } catch (err: unknown) {
        const e = err as { message?: string };
        this.logger.warn(`获取子 Block 失败 parentId=${blockId.slice(0, 12)}...: ${e.message ?? 'unknown'}`);
      }
    }
    const existingIds = new Set(parentBlockIds);
    const newMissing: string[] = [];
    for (const block of allChildren) {
      const children = block.children as string[] | undefined;
      if (children) {
        for (const childId of children) {
          if (!existingIds.has(childId) && !allChildren.some((b) => b.block_id === childId)) {
            newMissing.push(childId);
          }
        }
      }
    }
    if (newMissing.length > 0) {
      const deeperBlocks = await this.fetchChildBlocks(docToken, newMissing);
      allChildren.push(...deeperBlocks);
    }
    return allChildren;
  }

  async fetchDocumentRawContent(docToken: string): Promise<string> {
    const client = this.getClient();
    try {
      const res = await client.docx.document.rawContent({
        path: { document_id: docToken },
      });
      if (res.code !== 0) {
        this.throwFeishuError('获取飞书文档纯文本失败', { code: res.code, msg: res.msg });
      }
      return res.data?.content ?? '';
    } catch (err: unknown) {
      if (err instanceof FeishuApiError) throw err;
      this.throwFeishuError('获取飞书文档纯文本失败', err);
    }
  }

  async fetchBlockChildren(
    docToken: string,
    blockIds: string[],
  ): Promise<Record<string, unknown>[]> {
    const client = this.getClient();
    const allChildren: Record<string, unknown>[] = [];

    for (const blockId of blockIds) {
      try {
        const res = await client.request({
          method: 'GET',
          url: `https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}/blocks/${blockId}/children`,
          params: { page_size: 500 },
        });
        const items = (res?.data?.items ?? []) as Record<string, unknown>[];
        allChildren.push(...items);
      } catch (err: unknown) {
        const e = err as { message?: string };
        this.logger.warn(`获取 block 子节点失败 blockId=${blockId.slice(0, 12)}...: ${e.message ?? 'unknown'}`);
      }
    }

    return allChildren;
  }

  private async getTenantAccessToken(): Promise<string> {
    const appId = (process.env.FEISHU_APP_ID ?? '').trim();
    const appSecret = (process.env.FEISHU_APP_SECRET ?? '').trim();
    if (!appId || !appSecret) {
      throw new Error('飞书凭证未配置');
    }
    const https = await import('https');
    return new Promise<string>((resolve, reject) => {
      const postData = JSON.stringify({ app_id: appId, app_secret: appSecret });
      const req = https.request(
        {
          hostname: 'open.feishu.cn',
          path: '/open-apis/auth/v3/tenant_access_token/internal',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
              if (body.code !== 0) {
                reject(new Error(`获取 token 失败: [${body.code}] ${body.msg}`));
                return;
              }
              resolve(body.tenant_access_token as string);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  private downloadBinary(url: string, headers: Record<string, string>, maskedToken: string, depth: number): Promise<DownloadResult> {
    const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    const noProxy = process.env.NO_PROXY || '';
    const shouldBypassProxy = noProxy && (() => {
      try {
        const host = new URL(url).hostname;
        return noProxy.split(',').some((p: string) => {
          const t = p.trim();
          if (!t) return false;
          if (t === '*') return true;
          return host === t || (t.startsWith('.') && host.endsWith(t)) || (t.startsWith('*.') && host.endsWith(t.slice(1)));
        });
      } catch { return false; }
    })();
    if (httpsProxy && !shouldBypassProxy) {
      return this.downloadBinaryViaProxy(url, headers, maskedToken, httpsProxy);
    }

    return new Promise<DownloadResult>((resolve) => {
      const urlObj = new URL(url);
      const mod = urlObj.protocol === 'https:' ? 'https' : 'http';
      import(mod).then((httpMod) => {
        const req = httpMod.request(
          {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers,
          },
          (res) => this.handleDownloadResponse(res, url, maskedToken, depth, resolve),
        );
        req.on('error', (err: Error) => {
          this.logger.warn(`下载媒体文件网络异常 token=${maskedToken}...: ${err.message}`);
          resolve({ error: `网络异常: ${err.message}` });
        });
        req.end();
      });
    });
  }

  private handleDownloadResponse(
    res: http.IncomingMessage,
    originalUrl: string,
    maskedToken: string,
    depth: number,
    resolve: (result: DownloadResult | Promise<DownloadResult>) => void,
  ): void {
    const urlObj = new URL(originalUrl);
    const statusCode = res.statusCode ?? 0;
    const contentType = res.headers['content-type'] ?? '';
    const contentLength = res.headers['content-length'] ?? '';

    if ((statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) && res.headers.location) {
      if (depth >= 5) {
        this.logger.warn(`下载媒体文件重定向过多 token=${maskedToken}... redirects=${depth}`);
        resolve({ error: '重定向次数过多', statusCode: 310 });
        return;
      }
      const redirectUrl = res.headers.location.startsWith('http')
        ? res.headers.location
        : `${urlObj.protocol}//${urlObj.host}${res.headers.location}`;
      this.logger.log(`下载媒体文件重定向 token=${maskedToken}... ${statusCode} → ${redirectUrl.slice(0, 80)}...`);
      resolve(this.downloadBinary(redirectUrl, {}, maskedToken, depth + 1));
      return;
    }

    if (statusCode >= 400) {
      const respHeaders: Record<string, string> = {};
      for (const key of ['x-tt-logid', 'x-request-id', 'server', 'x-ss-stub-gw']) {
        const v = res.headers[key];
        if (v) respHeaders[key] = Array.isArray(v) ? v.join(', ') : v;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        let apiCode: number | undefined;
        let apiMsg: string | undefined;
        try {
          const json = JSON.parse(body) as { code?: number; msg?: string };
          apiCode = json.code;
          apiMsg = json.msg;
        } catch { /* not JSON */ }
        const error = apiCode !== undefined
          ? `飞书API错误 [${apiCode}] ${apiMsg ?? ''}`
          : `HTTP ${statusCode}`;
        this.logger.warn(
          `下载媒体文件失败 token=${maskedToken}... status=${statusCode} content-type=${contentType} ` +
          `content-length=${contentLength} apiCode=${apiCode ?? 'N/A'} apiMsg=${apiMsg ?? 'N/A'} ` +
          `headers=${JSON.stringify(respHeaders)} body=${body.slice(0, 300)}`,
        );
        resolve({ error, statusCode, apiCode, apiMsg, responseHeaders: respHeaders });
      });
      return;
    }

    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        this.logger.warn(`下载媒体文件返回空数据 token=${maskedToken}... status=${statusCode} content-type=${contentType}`);
        resolve({ error: '响应体为空', statusCode });
        return;
      }
      if (contentType.includes('application/json') || contentType.includes('text/')) {
        const text = buf.toString('utf-8');
        try {
          const json = JSON.parse(text) as { code?: number; msg?: string };
          if (json.code !== undefined && json.code !== 0) {
            this.logger.warn(`下载媒体文件 API 错误 token=${maskedToken}... code=${json.code} msg=${json.msg ?? ''}`);
            resolve({ error: `飞书API错误 [${json.code}] ${json.msg ?? ''}`, statusCode, apiCode: json.code, apiMsg: json.msg });
            return;
          }
        } catch { /* not JSON, treat as binary */ }
      }
      resolve({ buffer: buf });
    });
  }

  private downloadBinaryViaProxy(
    url: string,
    headers: Record<string, string>,
    maskedToken: string,
    proxyUrl: string,
  ): Promise<DownloadResult> {
    const urlObj = new URL(url);
    let proxyObj: URL;
    try {
      proxyObj = new URL(proxyUrl);
    } catch {
      this.logger.warn(`代理URL无效: ${proxyUrl}`);
      return Promise.resolve({ error: `代理URL无效: ${proxyUrl}` });
    }

    this.logger.log(`下载媒体文件(代理) token=${maskedToken}... proxy=${proxyObj.host} target=${urlObj.host}${urlObj.pathname}`);

    return this.establishProxyTunnel(urlObj, proxyObj, maskedToken)
      .then((tunnelSocket) => this.sendRequestViaProxyTunnel(urlObj, headers, maskedToken, tunnelSocket));
  }

  private establishProxyTunnel(
    urlObj: URL,
    proxyObj: URL,
    maskedToken: string,
  ): Promise<net.Socket> {
    const targetPort = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80');

    return new Promise<net.Socket>((resolve, reject) => {
      const connectReq = http.request({
        host: proxyObj.hostname,
        port: parseInt(proxyObj.port || '8080', 10),
        method: 'CONNECT',
        path: `${urlObj.hostname}:${targetPort}`,
      });

      connectReq.on('connect', (_res, socket) => {
        if (_res.statusCode !== 200) {
          this.logger.warn(`代理CONNECT失败 token=${maskedToken}... status=${_res.statusCode}`);
          socket.destroy();
          reject(new Error(`代理CONNECT失败: HTTP ${_res.statusCode}`));
          return;
        }

        if (urlObj.protocol === 'https:') {
          const tlsSocket = tls.connect({
            socket: socket as net.Socket,
            servername: urlObj.hostname,
            host: urlObj.hostname,
          });
          tlsSocket.on('secureConnect', () => resolve(tlsSocket as unknown as net.Socket));
          tlsSocket.on('error', (err: Error) => {
            this.logger.warn(`代理TLS升级失败 token=${maskedToken}...: ${err.message}`);
            socket.destroy();
            reject(err);
          });
        } else {
          resolve(socket as net.Socket);
        }
      });

      connectReq.on('error', (err: Error) => {
        this.logger.warn(`代理CONNECT请求失败 token=${maskedToken}...: ${err.message}`);
        reject(err);
      });

      connectReq.end();
    });
  }

  private sendRequestViaProxyTunnel(
    urlObj: URL,
    headers: Record<string, string>,
    maskedToken: string,
    tunnelSocket: net.Socket,
  ): Promise<DownloadResult> {
    return new Promise<DownloadResult>((resolve) => {
      const authHeader = headers['Authorization'] || headers['authorization'];
      const reqHeaders: Record<string, string> = {
        'Host': urlObj.host,
      };
      if (authHeader) {
        reqHeaders['Authorization'] = authHeader;
      }

      const req = http.request({
        method: 'GET',
        host: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: reqHeaders,
        createConnection: () => tunnelSocket,
      });

      req.on('response', (res) => {
        this.handleDownloadResponse(res, urlObj.toString(), maskedToken, 0, resolve);
      });

      req.on('error', (err: Error) => {
        this.logger.warn(`下载媒体文件(代理)网络异常 token=${maskedToken}...: ${err.message}`);
        resolve({ error: `网络异常(代理): ${err.message}` });
      });

      req.end();
      this.logger.log(`下载媒体文件(代理)请求已发送 token=${maskedToken}...`);
    });
  }

  async downloadMedia(fileToken: string): Promise<DownloadResult> {
    const maskedToken = fileToken.slice(0, 12);
    try {
      const token = await this.getTenantAccessToken();
      const url = `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`;
      this.logger.log(`下载媒体文件开始 token=${maskedToken}... url=drive/v1/medias/.../download auth=Bearer ${token.slice(0, 8)}...`);
      const result = await this.downloadBinary(url, { Authorization: `Bearer ${token}` }, maskedToken, 0);

      if (result.buffer) {
        this.logger.log(`下载媒体文件成功 token=${maskedToken}... size=${result.buffer.length}bytes`);
      } else {
        this.logger.warn(`下载媒体文件失败 token=${maskedToken}... error=${result.error} status=${result.statusCode ?? 'N/A'} apiCode=${result.apiCode ?? 'N/A'}`);
      }
      return result;
    } catch (err: unknown) {
      const e = err as { message?: string };
      this.logger.warn(`下载媒体文件异常 token=${maskedToken}...: ${e.message ?? 'unknown'}`);
      return { error: e.message ?? 'unknown' };
    }
  }

  async checkDrivePermission(
    docToken: string,
    testMediaToken?: string,
    testDriveToken?: string,
  ): Promise<DrivePermissionCheckResponse> {
    const result: DrivePermissionCheckResponse = {
      credential: { ok: false, message: '' },
      docRead: { ok: false, message: '' },
      resourceDownload: { ok: false, message: '' },
    };

    try {
      await this.getTenantAccessToken();
      result.credential = { ok: true, message: 'tenant_access_token 获取成功' };
    } catch (err: unknown) {
      const e = err as { message?: string };
      result.credential = { ok: false, message: `凭证获取失败: ${e.message ?? 'unknown'}` };
      result.docRead = { ok: false, message: '跳过（凭证失败）' };
      result.resourceDownload = { ok: false, message: '跳过（凭证失败）', suggestion: '请先修复凭证问题' };
      return result;
    }

    try {
      const metaRes = await this.fetchDocumentMeta(docToken);
      result.docRead = { ok: true, message: `文档读取成功，标题: ${metaRes.title || '(空)'}` };
    } catch (err: unknown) {
      const info = this.extractFeishuError(err);
      result.docRead = { ok: false, message: info.message, apiCode: this.extractApiCode(err) };
    }

    const imageResult: DrivePermissionCheckItem = { ok: false, message: '' };
    const attachmentResult: DrivePermissionCheckItem = { ok: false, message: '' };
    let lastDebugInfo: DrivePermissionDebugInfo | undefined;
    let anyFail = false;

    if (testMediaToken) {
      const dlResult = await this.downloadMedia(testMediaToken);
      const endpoint = `GET /open-apis/drive/v1/medias/${testMediaToken.slice(0, 12)}.../download`;
      if (dlResult.buffer) {
        imageResult.ok = true;
        imageResult.message = `图片下载成功，大小 ${dlResult.buffer.length} bytes`;
        lastDebugInfo = { endpoint, tokenType: 'tenant_access_token', httpStatus: 200, diagnosis: '下载成功' };
      } else {
        anyFail = true;
        imageResult.ok = false;
        imageResult.message = dlResult.error ?? '未知错误';
        imageResult.apiCode = dlResult.apiCode;
        imageResult.suggestion = this.buildPermissionSuggestion(dlResult);
        lastDebugInfo = {
          endpoint,
          tokenType: 'tenant_access_token',
          httpStatus: dlResult.statusCode,
          responseHeaders: dlResult.responseHeaders,
          diagnosis: this.diagnoseFailure(dlResult),
        };
      }
    } else {
      imageResult.ok = false;
      imageResult.message = '无可测试的图片 token（文档中未包含图片）';
      imageResult.suggestion = '如需验证图片下载权限，请在文档中插入图片';
    }

    if (testDriveToken) {
      const dlResult = await this.downloadMedia(testDriveToken);
      const endpoint = `GET /open-apis/drive/v1/medias/${testDriveToken.slice(0, 12)}.../download`;
      if (dlResult.buffer) {
        attachmentResult.ok = true;
        attachmentResult.message = `附件下载成功，大小 ${dlResult.buffer.length} bytes`;
        lastDebugInfo = { endpoint, tokenType: 'tenant_access_token', httpStatus: 200, diagnosis: '下载成功' };
      } else {
        anyFail = true;
        attachmentResult.ok = false;
        attachmentResult.message = dlResult.error ?? '未知错误';
        attachmentResult.apiCode = dlResult.apiCode;
        attachmentResult.suggestion = this.buildPermissionSuggestion(dlResult);
        lastDebugInfo = {
          endpoint,
          tokenType: 'tenant_access_token',
          httpStatus: dlResult.statusCode,
          responseHeaders: dlResult.responseHeaders,
          diagnosis: this.diagnoseFailure(dlResult),
        };
      }
    } else {
      attachmentResult.ok = false;
      attachmentResult.message = '无可测试的附件 token（文档中未包含附件）';
      attachmentResult.suggestion = '如需验证附件下载权限，请在文档中插入附件';
    }

    const bothOk = imageResult.ok && attachmentResult.ok;
    const bothSkipped = !testMediaToken && !testDriveToken;

    if (bothOk) {
      result.resourceDownload = {
        ok: true,
        message: '资源下载权限正常',
        debugInfo: lastDebugInfo,
        imageResult,
        attachmentResult,
      };
    } else if (bothSkipped) {
      result.resourceDownload = {
        ok: false,
        message: '无可测试的资源（文档中未包含图片或附件）',
        suggestion: '如需验证资源下载权限，请在文档中插入图片或附件',
        imageResult,
        attachmentResult,
      };
    } else {
      const failSuggestions = [imageResult, attachmentResult]
        .filter((r: DrivePermissionCheckItem) => !r.ok && r.suggestion)
        .map((r: DrivePermissionCheckItem) => r.suggestion!);
      const uniqueSuggestions = [...new Set(failSuggestions)];
      result.resourceDownload = {
        ok: false,
        message: anyFail ? '资源下载失败，请查看下方详情' : '部分资源未测试',
        suggestion: uniqueSuggestions.join('\n\n') || undefined,
        debugInfo: lastDebugInfo,
        imageResult,
        attachmentResult,
      };
    }

    return result;
  }

  private diagnoseFailure(result: DownloadResult): string {
    if (result.apiCode === 99991672) return 'scope 缺失：drive:drive:readonly 未开通或未审批';
    if (result.apiCode === 1770032 || result.apiCode === 131006) return '文档/知识库级权限不足，应用未被添加为协作者';
    if (result.statusCode === 403 && result.apiCode === undefined) return '资源级权限不足（scope 已开通但应用无权访问该具体资源）';
    if (result.statusCode === 404 || result.apiCode === 1770002) return '资源不存在或 token 已过期';
    return `未知错误（HTTP ${result.statusCode ?? 'N/A'}，apiCode ${result.apiCode ?? 'N/A'}）`;
  }

  private buildPermissionSuggestion(result: DownloadResult): string {
    if (result.apiCode === 99991672) {
      return `权限 scope 缺失。请在飞书开放平台 → 应用管理 → 权限管理中：\n1. 搜索并开通「drive:drive:readonly」（查看云空间中所有文件）权限\n2. 确认管理员已审批通过`;
    }
    if (result.statusCode === 403 && result.apiCode === undefined) {
      return `资源级权限不足（drive:drive:readonly 已开通，但应用无权访问该具体资源）。请检查：\n1. 知识库空间 → 成员管理 → 确认应用角色是否包含「允许下载」权限\n2. 具体文档 → 右上角「分享」→ 搜索应用名称 → 添加为「可阅读」协作者\n3. 文档/知识库的「安全设置」中是否限制了「允许下载/复制/打印」`;
    }
    if (result.apiCode === 1770032 || result.apiCode === 131006) {
      return `文档/知识库权限拒绝。请在飞书中将应用添加为该文档的协作者：\n打开文档 → 右上角「分享」→ 搜索应用名称 → 添加为「可阅读」协作者\n如文档在知识库中，需在知识库设置 → 成员管理 → 添加应用为成员`;
    }
    if (result.statusCode === 404 || result.apiCode === 1770002) {
      return '资源不存在或 token 已过期。请确认文档中的图片/附件未被删除';
    }
    return `错误码 ${result.apiCode ?? result.statusCode ?? 'N/A'}: ${result.apiMsg ?? result.error ?? ''}`;
  }

  private buildResourceDownloadSuggestion(failDetails: string[]): string {
    const has403EmptyBody = failDetails.some((d) => d.includes('HTTP 403') || d.includes('status=403'));
    const has99991672 = failDetails.some((d) => d.includes('99991672'));
    const has1770032 = failDetails.some((d) => d.includes('1770032') || d.includes('131006'));

    if (has99991672) {
      return 'scope 缺失：在飞书开放平台 → 权限管理 → 搜索「drive:drive:readonly」→ 开通并发布版本';
    }
    if (has1770032) {
      return '文档/知识库级权限不足：将应用机器人添加为知识库成员或文档协作者';
    }
    if (has403EmptyBody) {
      return '资源级 403（空响应体，Tengine 网关拒绝）。请按以下顺序排查：' +
        '1) 知识库设置 → 成员管理 → 确认应用机器人角色是否包含「可下载」权限；' +
        '2) 具体文档 → 右上角「分享」→ 搜索应用名称 → 添加为「可阅读」协作者；' +
        '3) 知识库/文档「安全设置」→ 确认「允许下载/复制/打印」未被关闭；' +
        '4) 飞书租户安全策略是否限制了第三方应用下载（需租户管理员检查）';
    }
    return '请检查 drive:drive:readonly 权限是否已开通并发布';
  }

  private extractApiCode(err: unknown): number | undefined {
    const e = err as { response?: { data?: { code?: number } }; code?: number };
    return e.response?.data?.code ?? e.code;
  }

  async downloadDriveFile(fileToken: string): Promise<DownloadResult> {
    const maskedToken = fileToken.slice(0, 12);
    try {
      const token = await this.getTenantAccessToken();
      const url = `https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download?type=file`;
      this.logger.log(`下载Drive文件开始 token=${maskedToken}... url=drive/v1/files/.../download auth=Bearer ${token.slice(0, 8)}...`);
      const result = await this.downloadBinary(url, { Authorization: `Bearer ${token}` }, maskedToken, 0);

      if (result.buffer) {
        this.logger.log(`下载Drive文件成功 token=${maskedToken}... size=${result.buffer.length}bytes`);
      } else {
        this.logger.warn(`下载Drive文件失败 token=${maskedToken}... error=${result.error} status=${result.statusCode ?? 'N/A'} apiCode=${result.apiCode ?? 'N/A'}`);
      }
      return result;
    } catch (err: unknown) {
      const e = err as { message?: string };
      this.logger.warn(`下载Drive文件异常 token=${maskedToken}...: ${e.message ?? 'unknown'}`);
      return { error: e.message ?? 'unknown' };
    }
  }

  async fetchBitableData(
    appToken: string,
    specificTableId?: string,
  ): Promise<{ name: string; fields: string[]; fieldTypes: Record<string, number>; records: Record<string, unknown>[]; errorCode?: number; errorMsg?: string }[]> {
    const client = this.getClient();
    const tables: { name: string; fields: string[]; fieldTypes: Record<string, number>; records: Record<string, unknown>[]; errorCode?: number; errorMsg?: string }[] = [];
    const maskedToken = appToken.slice(0, 8) + '...' + appToken.slice(-4);

    try {
      let tableItems: Record<string, unknown>[];

      if (specificTableId) {
        tableItems = [{ table_id: specificTableId, name: '表格' }];
      } else {
        const tablesRes = await client.request({
          method: 'GET',
          url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`,
          params: { page_size: 100 },
          validateStatus: () => true,
        }) as Record<string, unknown> | null;

        const tablesCode = (tablesRes?.code as number) ?? -1;
        if (tablesCode !== 0) {
          const msg = (tablesRes?.msg as string) ?? `code=${tablesCode}`;
          this.logger.warn(`获取多维表格 tables 失败 appToken=${maskedToken}: [${tablesCode}] ${msg}`);
          return [{ name: '', fields: [], fieldTypes: {}, records: [], errorCode: tablesCode, errorMsg: msg }];
        }

        const tablesData = (tablesRes?.data as Record<string, unknown>) ?? {};
        tableItems = (tablesData.items ?? []) as Record<string, unknown>[];
      }

      for (const table of tableItems) {
        const tableId = table.table_id as string;
        const tableName = (table.name as string) ?? '未命名表格';

        const fieldsRes = await client.request({
          method: 'GET',
          url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
          params: { page_size: 200 },
          validateStatus: () => true,
        }) as Record<string, unknown> | null;

        const fieldsCode = (fieldsRes?.code as number) ?? -1;
        if (fieldsCode !== 0) {
          const msg = (fieldsRes?.msg as string) ?? `code=${fieldsCode}`;
          this.logger.warn(`获取多维表格 fields 失败 appToken=${maskedToken} tableId=${tableId}: [${fieldsCode}] ${msg}`);
        }

        const fieldsData = (fieldsRes?.data as Record<string, unknown>) ?? {};
        const fieldItems = ((fieldsData.items ?? []) as Record<string, unknown>[]);
        const fields = fieldItems.map((f: Record<string, unknown>) => (f.field_name as string) ?? '');
        const fieldTypes: Record<string, number> = {};
        for (const f of fieldItems) {
          const fname = (f.field_name as string) ?? '';
          if (fname) fieldTypes[fname] = (f.type as number) ?? 0;
        }

        const recordsRes = await client.request({
          method: 'GET',
          url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
          params: { page_size: 500 },
          validateStatus: () => true,
        }) as Record<string, unknown> | null;

        const recordsCode = (recordsRes?.code as number) ?? -1;
        if (recordsCode !== 0) {
          const msg = (recordsRes?.msg as string) ?? `code=${recordsCode}`;
          this.logger.warn(`获取多维表格 records 失败 appToken=${maskedToken} tableId=${tableId}: [${recordsCode}] ${msg}`);
        }

        const recordsData = (recordsRes?.data as Record<string, unknown>) ?? {};
        const records = ((recordsData.items ?? []) as Record<string, unknown>[]).map((r: Record<string, unknown>) => (r.fields ?? {}) as Record<string, unknown>);

        tables.push({ name: tableName, fields, fieldTypes, records });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { code?: number; msg?: string } }; code?: number; msg?: string; message?: string };
      const feishuCode = e.response?.data?.code ?? e.code;
      const feishuMsg = e.response?.data?.msg ?? e.msg ?? e.message ?? 'unknown';
      this.logger.warn(`获取多维表格数据异常 appToken=${maskedToken}: [${feishuCode ?? 'N/A'}] ${feishuMsg}`);
      return [{ name: '', fields: [], fieldTypes: {}, records: [], errorCode: feishuCode as number | undefined, errorMsg: feishuMsg }];
    }

    return tables;
  }

  // ========== Wiki Knowledge Base Methods ==========

  parseWikiUrl(wikiUrl: string): { spaceId?: string; nodeToken?: string; type: 'space' | 'node'; host: string } {
    try {
      const url = new URL(wikiUrl);
      const host = url.hostname;
      const spacePathMatch = url.pathname.match(/\/wiki\/(?:space|settings)\/(\d+)/);
      if (spacePathMatch?.[1]) return { spaceId: spacePathMatch[1], type: 'space', host };
      const nodeMatch = url.pathname.match(/\/wiki\/([A-Za-z0-9]+)/);
      if (nodeMatch?.[1] && nodeMatch[1] !== 'space' && nodeMatch[1] !== 'settings') {
        return { nodeToken: nodeMatch[1], type: 'node', host };
      }
    } catch {
      const spacePathMatch = wikiUrl.match(/\/wiki\/(?:space|settings)\/(\d+)/);
      if (spacePathMatch?.[1]) return { spaceId: spacePathMatch[1], type: 'space', host: '' };
      const nodeMatch = wikiUrl.match(/\/wiki\/([A-Za-z0-9]+)/);
      if (nodeMatch?.[1] && nodeMatch[1] !== 'space' && nodeMatch[1] !== 'settings') {
        return { nodeToken: nodeMatch[1], type: 'node', host: '' };
      }
    }
    throw new Error('无法解析飞书知识库链接，请粘贴正确的知识库或目录链接');
  }

  async getWikiSpaceInfo(nodeToken: string): Promise<{ spaceId: string; spaceName: string; title: string }> {
    const client = this.getClient();
    try {
      const res = await client.wiki.space.getNode({
        params: { token: nodeToken },
      });
      if (res.code !== 0) {
        const info = this.extractFeishuError({ code: res.code, msg: res.msg });
        throw new Error(`获取知识库节点信息失败 [${res.code}]: ${info.message}`);
      }
      const node = res.data?.node;
      return {
        spaceId: node?.space_id ?? '',
        spaceName: node?.title ?? '',
        title: node?.title ?? '',
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('获取知识库节点信息失败')) throw err;
      const info = this.extractFeishuError(err);
      throw new Error(`获取知识库节点信息失败: ${info.message}`);
    }
  }

  async listSpaces(): Promise<{ available: boolean; message?: string; spaces: { spaceId: string; name: string; description: string }[] }> {
    const client = this.getClient();
    try {
      const res = await client.request({
        method: 'GET',
        url: 'https://open.feishu.cn/open-apis/wiki/v2/spaces',
        params: { page_size: 50 },
      }) as Record<string, unknown> | null;

      const code = (res?.code as number) ?? -1;
      if (code !== 0) {
        const msg = (res?.msg as string) ?? `code=${code}`;
        this.logger.warn(`listSpaces failed: [${code}] ${msg}`);
        if (code === 99991672 || msg.includes('permission')) {
          return { available: false, message: '飞书应用未开通 wiki:space:readonly 权限，无法自动列出知识库列表', spaces: [] };
        }
        return { available: false, message: `获取知识库列表失败 [${code}]: ${msg}`, spaces: [] };
      }

      const data = (res?.data as Record<string, unknown>) ?? {};
      const items = (data.items ?? []) as Record<string, unknown>[];
      const spaces = items.map((item: Record<string, unknown>) => ({
        spaceId: (item.space_id as string) ?? '',
        name: (item.name as string) ?? '',
        description: (item.description as string) ?? '',
      }));

      this.logger.log(`listSpaces success: ${spaces.length} spaces`);
      return { available: true, spaces };
    } catch (err: unknown) {
      const info = this.extractFeishuError(err);
      this.logger.warn(`listSpaces exception: ${info.message}`);
      return { available: false, message: `获取知识库列表异常: ${info.message}`, spaces: [] };
    }
  }

  async listWikiNodes(
    spaceId: string,
    parentToken?: string,
  ): Promise<{
    nodeToken: string;
    title: string;
    objType: string;
    objToken: string;
    hasChild: boolean;
    parentToken: string;
    nodeType: string;
  }[]> {
    const client = this.getClient();
    const allNodes: {
      nodeToken: string;
      title: string;
      objType: string;
      objToken: string;
      hasChild: boolean;
      parentToken: string;
      nodeType: string;
    }[] = [];
    let pageToken = '';

    try {
      do {
        const params: Record<string, string | number> = { page_size: 50 };
        if (parentToken) params.parent_node_token = parentToken;
        if (pageToken) params.page_token = pageToken;

        const res = await client.request({
          method: 'GET',
          url: `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes`,
          params,
        }) as Record<string, unknown> | null;

        const code = (res?.code as number) ?? -1;
        if (code !== 0) {
          const msg = (res?.msg as string) ?? `code=${code}`;
          throw new Error(`列出知识库节点失败 [${code}]: ${msg}`);
        }

        const data = (res?.data as Record<string, unknown>) ?? {};
        const items = (data.items ?? []) as Record<string, unknown>[];
        for (const item of items) {
          allNodes.push({
            nodeToken: (item.node_token as string) ?? '',
            title: (item.title as string) ?? '',
            objType: (item.obj_type as string) ?? '',
            objToken: (item.obj_token as string) ?? '',
            hasChild: (item.has_child as boolean) ?? false,
            parentToken: (item.parent_node_token as string) ?? '',
            nodeType: (item.node_type as string) ?? '',
          });
        }

        pageToken = (data.page_token as string) ?? '';
        if (!(data.has_more as boolean)) break;
      } while (pageToken);

      return allNodes;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('列出知识库节点失败')) throw err;
      const info = this.extractFeishuError(err);
      throw new Error(`列出知识库节点失败: ${info.message}`);
    }
  }

  async listAllSpaceNodes(spaceId: string): Promise<{
    nodeToken: string;
    title: string;
    objType: string;
    objToken: string;
    hasChild: boolean;
    parentToken: string;
    nodeType: string;
  }[]> {
    const allNodes: {
      nodeToken: string;
      title: string;
      objType: string;
      objToken: string;
      hasChild: boolean;
      parentToken: string;
      nodeType: string;
    }[] = [];
    let pageToken = '';
    const client = this.getClient();

    do {
      const params: Record<string, string | number> = { page_size: 50 };
      if (pageToken) params.page_token = pageToken;

      const res = await client.request({
        method: 'GET',
        url: `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes`,
        params,
      }) as Record<string, unknown> | null;

      const code = (res?.code as number) ?? -1;
      if (code !== 0) {
        const msg = (res?.msg as string) ?? `code=${code}`;
        throw new Error(`列出知识库节点失败 [${code}]: ${msg}`);
      }

      const data = (res?.data as Record<string, unknown>) ?? {};
      const items = (data.items ?? []) as Record<string, unknown>[];
      for (const item of items) {
        allNodes.push({
          nodeToken: (item.node_token as string) ?? '',
          title: (item.title as string) ?? '',
          objType: (item.obj_type as string) ?? '',
          objToken: (item.obj_token as string) ?? '',
          hasChild: (item.has_child as boolean) ?? false,
          parentToken: (item.parent_node_token as string) ?? '',
          nodeType: (item.node_type as string) ?? '',
        });
      }

      pageToken = (data.page_token as string) ?? '';
      if (!(data.has_more as boolean)) break;
    } while (pageToken);

    return allNodes;
  }

  async listWikiTree(
    spaceId: string,
    rootToken?: string,
    maxDepth: number = 5,
    maxNodes: number = 200,
    host?: string,
  ): Promise<{ tree: import('@shared/api.interface').WikiTreeNodeItem[]; truncated: boolean; totalNodes: number }> {
    const effectiveHost = host || 'feishu.cn';
    let totalNodes = 0;
    let truncated = false;

    const classifyNodeType = (
      objType: string,
      hasChild: boolean,
      nodeType: string,
    ): import('@shared/api.interface').WikiNodeType => {
      if (objType === 'docx') return 'docx';
      if (objType === 'sheet') return 'sheet';
      if (objType === 'bitable') return 'bitable';
      if (nodeType === 'shortcut') return 'shortcut';
      if (hasChild) return 'folder';
      return 'unsupported';
    };

    const buildTree = async (
      parentToken: string | undefined,
      depth: number,
    ): Promise<import('@shared/api.interface').WikiTreeNodeItem[]> => {
      if (depth > maxDepth) { truncated = true; return []; }
      if (totalNodes >= maxNodes) { truncated = true; return []; }

      let nodes: { nodeToken: string; title: string; objType: string; objToken: string; hasChild: boolean; parentToken: string; nodeType: string }[];
      try {
        nodes = parentToken
          ? await this.listWikiNodes(spaceId, parentToken)
          : await this.listAllSpaceNodes(spaceId);
      } catch (err: unknown) {
        const e = err as { message?: string };
        this.logger.warn(`读取知识库目录树失败 depth=${depth} parent=${parentToken ?? 'root'}: ${e.message ?? 'unknown'}`);
        return [];
      }

      const result: import('@shared/api.interface').WikiTreeNodeItem[] = [];
      for (const node of nodes) {
        if (totalNodes >= maxNodes) { truncated = true; break; }
        totalNodes++;

        const nodeType = classifyNodeType(node.objType, node.hasChild, node.nodeType);
        const treeNode: import('@shared/api.interface').WikiTreeNodeItem = {
          nodeToken: node.nodeToken,
          title: node.title,
          objType: node.objType,
          objToken: node.objToken,
          hasChild: node.hasChild,
          parentToken: node.parentToken,
          nodeType,
          wikiUrl: `https://${effectiveHost}/wiki/${node.nodeToken}`,
          existingMapping: false,
          children: [],
        };

        if (node.hasChild && depth < maxDepth && totalNodes < maxNodes) {
          treeNode.children = await buildTree(node.nodeToken, depth + 1);
        }

        result.push(treeNode);
      }
      return result;
    };

    const tree = await buildTree(rootToken, 1);
    return { tree, truncated, totalNodes };
  }

  async diagnoseWikiAccess(wikiUrl: string): Promise<import('@shared/api.interface').WikiDiagnoseResponse> {
    const result: import('@shared/api.interface').WikiDiagnoseResponse = {
      credential: { ok: false, message: '' },
      wikiRead: { ok: false, message: '' },
      docRead: { ok: false, message: '' },
      resourceDownload: { ok: false, message: '' },
      spaceId: '',
      spaceName: '',
    };

    try {
      await this.getTenantAccessToken();
      result.credential = { ok: true, message: '飞书应用凭证有效' };
    } catch (err: unknown) {
      const e = err as { message?: string };
      result.credential = { ok: false, message: `凭证无效: ${e.message ?? '未知错误'}` };
      result.wikiRead = { ok: false, message: '跳过（凭证无效）' };
      result.docRead = { ok: false, message: '跳过（凭证无效）' };
      result.resourceDownload = { ok: false, message: '跳过（凭证无效）' };
      return result;
    }

    const parsed = this.parseWikiUrl(wikiUrl);
    let spaceId = '';

    try {
      if (parsed.type === 'space' && parsed.spaceId) {
        spaceId = parsed.spaceId;
        const rootNodes = await this.listAllSpaceNodes(spaceId);
        if (rootNodes.length === 0) {
          result.wikiRead = { ok: false, message: '知识库下无任何节点，可能应用无权限或知识库不存在' };
          result.docRead = { ok: false, message: '跳过（无节点）' };
          result.resourceDownload = { ok: false, message: '跳过（无节点）' };
          result.spaceId = spaceId;
          return result;
        }
        result.wikiRead = { ok: true, message: `知识库读取成功，spaceId=${spaceId}，发现 ${rootNodes.length} 个根节点` };
      } else if (parsed.type === 'node' && parsed.nodeToken) {
        const info = await this.getWikiSpaceInfo(parsed.nodeToken);
        spaceId = info.spaceId;
        result.wikiRead = { ok: true, message: `知识库节点解析成功，空间: ${info.spaceName || spaceId}` };
        result.spaceName = info.spaceName;
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      const msg = e.message ?? '未知错误';
      if (msg.includes('131005') || msg.includes('not found')) {
        result.wikiRead = { ok: false, message: `知识库不存在或应用无权限访问（错误码 131005），请确认已将飞书应用机器人添加为知识库协作者` };
      } else {
        result.wikiRead = { ok: false, message: `知识库读取失败: ${msg}` };
      }
      result.docRead = { ok: false, message: '跳过（知识库读取失败）' };
      result.resourceDownload = { ok: false, message: '跳过（知识库读取失败）' };
      result.spaceId = spaceId;
      return result;
    }

    result.spaceId = spaceId;

    try {
      const rootNodes = parsed.nodeToken
        ? await this.listWikiNodes(spaceId, parsed.nodeToken)
        : await this.listAllSpaceNodes(spaceId);
      if (rootNodes.length === 0) {
        result.wikiRead = { ok: false, message: '知识库节点下无任何子节点' };
        result.docRead = { ok: false, message: '跳过（无子节点）' };
        result.resourceDownload = { ok: false, message: '跳过（无子节点）' };
        return result;
      }
      result.wikiRead = { ok: true, message: `知识库读取成功，发现 ${rootNodes.length} 个子节点` };

      const firstDocx = rootNodes.find((n) => n.objType === 'docx');
      if (!firstDocx || !firstDocx.objToken) {
        result.docRead = { ok: false, message: '当前节点下无 docx 类型文档可测试' };
        result.resourceDownload = { ok: false, message: '跳过（无 docx 文档）' };
        return result;
      }

      try {
        const meta = await this.fetchDocumentMeta(firstDocx.objToken);
        result.docRead = { ok: true, message: `文档读取成功，标题: ${meta.title || '(空)'}` };
      } catch (err: unknown) {
        const info = this.extractFeishuError(err);
        result.docRead = { ok: false, message: info.message };
      }

      const allChildNodes = await this.listWikiNodes(spaceId, parsed.nodeToken || undefined).catch(() => rootNodes);
      const testMediaNode = allChildNodes.find((n) => n.objType === 'docx');
      if (!testMediaNode) {
        result.resourceDownload = { ok: false, message: '无可测试的资源' };
        return result;
      }

      try {
        const blocks = await this.fetchDocumentBlocks(testMediaNode.objToken);
        let testImageToken: string | undefined;
        let testAttachToken: string | undefined;
        const attachBlockTypes = new Set([20, 23, 24, 26]);
        for (const block of blocks) {
          const bt = block.block_type as number;
          if (bt === 27 && !testImageToken) {
            const img = block['image'] as Record<string, unknown> | undefined;
            if (img) {
              const t = (img.token as string) ?? '';
              if (t) testImageToken = t;
            }
          }
          if (attachBlockTypes.has(bt) && !testAttachToken) {
            const keys = ['file', 'attachment', 'drive'];
            for (const k of keys) {
              const body = block[k] as Record<string, unknown> | undefined;
              if (body) {
                const t = (body.token as string) ?? '';
                if (t) { testAttachToken = t; break; }
              }
            }
          }
          if (testImageToken && testAttachToken) break;
        }

        const proxyUsed = !!(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);
        const details: string[] = [];
        if (proxyUsed) details.push('已通过代理隧道请求');
        details.push(`测试文档: ${testMediaNode.title} (${testMediaNode.objToken})`);
        details.push(`图片token: ${testImageToken ? testImageToken.slice(0, 12) + '...' : '无'}`);
        details.push(`附件token: ${testAttachToken ? testAttachToken.slice(0, 12) + '...' : '无'}`);

        let anySuccess = false;
        let failDetails: string[] = [];

        if (testImageToken) {
          const mediasResult = await this.downloadMedia(testImageToken);
          if (mediasResult.buffer) {
            anySuccess = true;
            details.push(`图片(medias API)下载成功: ${mediasResult.buffer.length} bytes`);
          } else {
            const logId = mediasResult.responseHeaders?.['x-tt-logid'] ?? 'N/A';
            failDetails.push(`图片(medias): ${mediasResult.error} [logId=${logId}]`);
            const filesResult = await this.downloadDriveFile(testImageToken);
            if (filesResult.buffer) {
              anySuccess = true;
              details.push(`图片(files API)下载成功: ${filesResult.buffer.length} bytes`);
            } else {
              const logId2 = filesResult.responseHeaders?.['x-tt-logid'] ?? 'N/A';
              failDetails.push(`图片(files): ${filesResult.error} [logId=${logId2}]`);
            }
          }
        }

        if (testAttachToken) {
          const attachResult = await this.downloadMedia(testAttachToken);
          if (attachResult.buffer) {
            anySuccess = true;
            details.push(`附件(medias API)下载成功: ${attachResult.buffer.length} bytes`);
          } else {
            const logId = attachResult.responseHeaders?.['x-tt-logid'] ?? 'N/A';
            failDetails.push(`附件(medias): ${attachResult.error} [logId=${logId}]`);
          }
        }

        if (!testImageToken && !testAttachToken) {
          result.resourceDownload = { ok: true, message: `文档读取正常（未发现图片或附件 token）。${details.join('；')}` };
        } else if (anySuccess) {
          result.resourceDownload = { ok: true, message: `资源下载正常。${details.join('；')}` };
        } else {
          const suggestion = this.buildResourceDownloadSuggestion(failDetails);
          result.resourceDownload = {
            ok: false,
            message: `资源下载失败。${details.join('；')}。失败详情: ${failDetails.join('；')}`,
          };
          this.logger.warn(`资源下载诊断失败: ${failDetails.join('；')} 建议: ${suggestion}`);
        }
      } catch (diagErr: unknown) {
        const de = diagErr as { message?: string };
        result.resourceDownload = { ok: false, message: `资源下载测试异常: ${de.message ?? '未知错误'}，请检查 drive:drive:readonly 权限` };
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      result.wikiRead = { ok: false, message: `知识库读取异常: ${e.message ?? '未知错误'}` };
    }

    return result;
  }
}
