import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { systemConfig } from '@server/database/schema';
import type {
  SystemConfigResponse,
  UpdateSystemConfigRequest,
  CheckConnectionRequest,
  CheckConnectionResponse,
  ConnectionStatus,
  ConnectionType,
  Language,
  PublishScope,
  StagingDeployMode,
  ProductionDeployMode,
} from '@shared/api.interface';

@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getConfig(): Promise<SystemConfigResponse> {
    this.logger.log('Fetching system config');

    const rows = await this.db.select().from(systemConfig).limit(1);

    if (rows.length === 0) {
      const defaultValues = {
        repoPlatform: 'GitHub' as const,
        repoUrl: '',
        defaultBranch: 'main',
        workBranchPrefix: 'docs/',
        docsDir: 'docs',
        docusaurusProjectDir: '/home/gm/workspace/code',
        backendApiBaseUrl: '',
        stagingUrl: '',
        productionUrl: '',
        deployMode: '公司服务器' as const,
        gitConnectionStatus: '未检测' as ConnectionStatus,
        backendApiConnectionStatus: '未检测' as ConnectionStatus,
        stagingConnectionStatus: '未检测' as ConnectionStatus,
        productionConnectionStatus: '未检测' as ConnectionStatus,
        serverConnectionStatus: '未检测' as ConnectionStatus,
        chatbaseEnabled: false,
        algoliaEnabled: false,
        feishuSyncEnabled: true,
        buildOutputDir: 'build',
        stagingDeployMode: 'local_static_dir',
        stagingDeployDir: '/home/workspace/staging-deploy',
        autoBuildBeforeDeploy: true,
        requireBuildCheck: true,
        productionDeployMode: 'local_static_dir' as ProductionDeployMode,
        productionDeployDir: '/home/workspace/production-deploy',
        requireStagingSuccessBeforeProduction: true,
        requireBuildCheckBeforeProduction: true,
        autoBuildBeforeProductionDeploy: true,
      };

      const inserted = await this.db
        .insert(systemConfig)
        .values(defaultValues)
        .returning();

      return this.formatResponse(inserted[0]);
    }

    return this.formatResponse(rows[0]);
  }

  async updateConfig(dto: UpdateSystemConfigRequest): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Updating system config: ${JSON.stringify(Object.keys(dto))}`);

    const existing = await this.db.select().from(systemConfig).limit(1);

    const dbValues: Record<string, unknown> = { ...dto };
    if (dto.enabledLanguages !== undefined) {
      dbValues.enabledLanguages = `{${dto.enabledLanguages.join(',')}}`;
    }

    if (dbValues.repoUrl && typeof dbValues.repoUrl === 'string') {
      dbValues.repoUrl = this.stripCredentialsFromUrl(dbValues.repoUrl);
    }

    if (existing.length === 0) {
      await this.db.insert(systemConfig).values(dbValues as Record<string, unknown>);
    } else {
      await this.db
        .update(systemConfig)
        .set(dbValues as Record<string, unknown>)
        .where(eq(systemConfig.id, existing[0].id));
    }

    return { success: true, message: '配置保存成功' };
  }

  async checkConnection(dto: CheckConnectionRequest): Promise<CheckConnectionResponse> {
    this.logger.log(`Checking connection: ${dto.type}`);

    const now = new Date();
    const fieldMap: Record<ConnectionType, { status: string; checkedAt: string }> = {
      git: { status: 'gitConnectionStatus', checkedAt: 'gitLastCheckedAt' },
      backendApi: { status: 'backendApiConnectionStatus', checkedAt: 'backendApiLastCheckedAt' },
      staging: { status: 'stagingConnectionStatus', checkedAt: 'stagingLastCheckedAt' },
      production: { status: 'productionConnectionStatus', checkedAt: 'productionLastCheckedAt' },
      server: { status: 'serverConnectionStatus', checkedAt: 'serverLastCheckedAt' },
    };

    const validTypes: ConnectionType[] = ['git', 'backendApi', 'staging', 'production', 'server'];
    if (!validTypes.includes(dto.type)) {
      throw new BadRequestException('未知的连接检测类型');
    }

    const fields = fieldMap[dto.type];

    const config = await this.getConfig();
    let status: ConnectionStatus;
    let message: string;

    try {
      switch (dto.type) {
        case 'git':
          ({ status, message } = await this.checkGitConnection(config.repoUrl, config.docusaurusProjectDir));
          break;
        case 'backendApi':
          ({ status, message } = await this.checkHttpConnection(config.backendApiBaseUrl, '后端 API'));
          break;
        case 'staging':
          ({ status, message } = await this.checkHttpConnection(config.stagingUrl, '测试环境'));
          break;
        case 'production':
          ({ status, message } = await this.checkHttpConnection(config.productionUrl, '正式环境'));
          break;
        case 'server':
          ({ status, message } = this.checkServerConnection(config.docusaurusProjectDir));
          break;
      }
    } catch (err: unknown) {
      status = '异常';
      message = err instanceof Error ? err.message : '检测过程发生未知错误';
      this.logger.error(`连接检测异常: type=${dto.type}, error=${message}`);
    }

    const existing = await this.db.select().from(systemConfig).limit(1);

    if (existing.length === 0) {
      const defaults: Record<string, unknown> = {};
      defaults[fields.status] = status;
      defaults[fields.checkedAt] = now;
      await this.db.insert(systemConfig).values(defaults);
    } else {
      const updateData: Record<string, unknown> = {};
      updateData[fields.status] = status;
      updateData[fields.checkedAt] = now;
      await this.db
        .update(systemConfig)
        .set(updateData)
        .where(eq(systemConfig.id, existing[0].id));
    }

    return {
      success: status === '正常',
      status,
      message,
      lastCheckedAt: now.toISOString(),
    };
  }

  private async checkGitConnection(
    repoUrl: string,
    projectDir: string,
  ): Promise<{ status: ConnectionStatus; message: string }> {
    if (!projectDir || !existsSync(projectDir)) {
      return { status: '异常', message: `项目目录不存在: ${projectDir}` };
    }

    const execAsync = promisify(exec);

    try {
      await execAsync('git rev-parse --is-inside-work-tree', {
        cwd: projectDir,
        timeout: 10 * 1000,
      });
    } catch {
      return { status: '异常', message: '项目目录不是有效的 Git 仓库' };
    }

    try {
      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: projectDir,
        timeout: 10 * 1000,
      });
      const remoteUrl = stdout.trim();
      this.logger.log(`Git remote URL: ${remoteUrl}`);
    } catch {
      return { status: '异常', message: '未配置 Git 远程仓库（origin）' };
    }

    if (repoUrl) {
      try {
        await execAsync(`git ls-remote --exit-code "${repoUrl}" HEAD`, {
          cwd: projectDir,
          timeout: 15 * 1000,
          env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '' },
        });
        return { status: '正常', message: 'Git 仓库连接正常，远程可访问' };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : '';
        if (errMsg.includes('Authentication failed') || errMsg.includes('could not read Username')) {
          return { status: '异常', message: 'Git 认证失败，请检查仓库凭据配置' };
        }
        if (errMsg.includes('Could not resolve host') || errMsg.includes('Connection refused') || errMsg.includes('timed out')) {
          return { status: '异常', message: '无法连接到远程仓库，请检查网络或仓库地址' };
        }
        return { status: '异常', message: `远程仓库不可达: ${errMsg.slice(0, 200)}` };
      }
    }

    return { status: '正常', message: 'Git 本地仓库正常，未配置远程地址' };
  }

  private async checkHttpConnection(
    url: string,
    label: string,
  ): Promise<{ status: ConnectionStatus; message: string }> {
    if (!url || !url.trim()) {
      return { status: '异常', message: `${label}地址未配置` };
    }

    try {
      new URL(url);
    } catch {
      return { status: '异常', message: `${label}地址格式无效: ${url}` };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10 * 1000);

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      }).catch(async () => {
        return fetch(url, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'follow',
        });
      });

      clearTimeout(timeout);

      if (response.ok || response.status === 301 || response.status === 302) {
        return { status: '正常', message: `${label}连接正常 (HTTP ${response.status})` };
      }
      return { status: '异常', message: `${label}返回异常状态码: HTTP ${response.status}` };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('abort') || errMsg.includes('timeout')) {
        return { status: '异常', message: `${label}连接超时（10s）` };
      }
      if (errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo')) {
        return { status: '异常', message: `${label}域名无法解析` };
      }
      if (errMsg.includes('ECONNREFUSED')) {
        return { status: '异常', message: `${label}连接被拒绝` };
      }
      if (errMsg.includes('ECONNRESET')) {
        return { status: '异常', message: `${label}连接被重置` };
      }
      return { status: '异常', message: `${label}连接失败: ${errMsg.slice(0, 200)}` };
    }
  }

  private checkServerConnection(
    projectDir: string,
  ): { status: ConnectionStatus; message: string } {
    if (!projectDir || !projectDir.trim()) {
      return { status: '异常', message: 'Docusaurus 项目目录未配置' };
    }

    if (!existsSync(projectDir)) {
      return { status: '异常', message: `项目目录不存在: ${projectDir}` };
    }

    const packageJsonPath = `${projectDir}/package.json`;
    if (!existsSync(packageJsonPath)) {
      return { status: '异常', message: `项目目录下缺少 package.json: ${packageJsonPath}` };
    }

    const nodeModulesPath = `${projectDir}/node_modules`;
    if (!existsSync(nodeModulesPath)) {
      return { status: '异常', message: '依赖未安装（node_modules 不存在）' };
    }

    return { status: '正常', message: '服务器项目目录正常，依赖已安装' };
  }

  private stripCredentialsFromUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.username || u.password) {
        u.username = '';
        u.password = '';
      }
      return u.toString().replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.db.select().from(systemConfig).limit(1);
      if (rows.length === 0) return;

      const repoUrl = rows[0].repoUrl as string;
      if (!repoUrl) return;

      const cleanUrl = this.stripCredentialsFromUrl(repoUrl);
      if (cleanUrl !== repoUrl) {
        await this.db
          .update(systemConfig)
          .set({ repoUrl: cleanUrl })
          .where(eq(systemConfig.id, rows[0].id));
        this.logger.log('启动时自动清洗了 repoUrl 中内嵌的凭证');
      }
    } catch (error) {
      this.logger.error('启动时清洗 repoUrl 失败', JSON.stringify(error));
    }
  }

  async getConfigInternal(): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(systemConfig).limit(1);
    if (rows.length === 0) return {};
    return rows[0] as Record<string, unknown>;
  }

  private parseEnabledLanguages(raw: unknown): Language[] {
    if (Array.isArray(raw)) return raw as Language[];
    if (typeof raw === 'string') {
      const cleaned = raw.replace(/[{}]/g, '');
      if (!cleaned) return ['zh-CN', 'en'];
      return cleaned.split(',').map((s: string) => s.trim()) as Language[];
    }
    return ['zh-CN', 'en'];
  }

  private formatResponse(row: Record<string, unknown>): SystemConfigResponse {
    const r = row as Record<string, unknown>;
    return {
      repoPlatform: (r.repoPlatform as SystemConfigResponse['repoPlatform']) ?? 'GitHub',
      repoUrl: (r.repoUrl as string) ?? '',
      defaultBranch: (r.defaultBranch as string) ?? 'main',
      workBranchPrefix: (r.workBranchPrefix as string) ?? 'docs/',
      docsDir: (r.docsDir as string) ?? 'docs',
      docusaurusProjectDir: (r.docusaurusProjectDir as string) ?? '/home/gm/workspace/code',
      defaultLanguage: (r.defaultLanguage as Language) ?? 'zh-CN',
      enabledLanguages: this.parseEnabledLanguages(r.enabledLanguages),
      zhLangCode: (r.zhLangCode as string) ?? 'zh-CN',
      enLangCode: (r.enLangCode as string) ?? 'en',
      defaultDocsDir: (r.defaultDocsDir as string) ?? 'docs',
      enI18nDocsDir: (r.enI18nDocsDir as string) ?? 'i18n/en/docusaurus-plugin-content-docs/current',
      defaultPublishScope: (r.defaultPublishScope as PublishScope) ?? 'all',
      backendApiBaseUrl: (r.backendApiBaseUrl as string) ?? '',
      stagingUrl: (r.stagingUrl as string) ?? '',
      productionUrl: (r.productionUrl as string) ?? '',
      deployMode: (r.deployMode as SystemConfigResponse['deployMode']) ?? '公司服务器',
      gitConnectionStatus: (r.gitConnectionStatus as ConnectionStatus) ?? '未检测',
      backendApiConnectionStatus: (r.backendApiConnectionStatus as ConnectionStatus) ?? '未检测',
      stagingConnectionStatus: (r.stagingConnectionStatus as ConnectionStatus) ?? '未检测',
      productionConnectionStatus: (r.productionConnectionStatus as ConnectionStatus) ?? '未检测',
      serverConnectionStatus: (r.serverConnectionStatus as ConnectionStatus) ?? '未检测',
      gitLastCheckedAt: r.gitLastCheckedAt instanceof Date ? r.gitLastCheckedAt.toISOString() : (r.gitLastCheckedAt as string | undefined),
      backendApiLastCheckedAt: r.backendApiLastCheckedAt instanceof Date ? r.backendApiLastCheckedAt.toISOString() : (r.backendApiLastCheckedAt as string | undefined),
      stagingLastCheckedAt: r.stagingLastCheckedAt instanceof Date ? r.stagingLastCheckedAt.toISOString() : (r.stagingLastCheckedAt as string | undefined),
      productionLastCheckedAt: r.productionLastCheckedAt instanceof Date ? r.productionLastCheckedAt.toISOString() : (r.productionLastCheckedAt as string | undefined),
      serverLastCheckedAt: r.serverLastCheckedAt instanceof Date ? r.serverLastCheckedAt.toISOString() : (r.serverLastCheckedAt as string | undefined),
      chatbaseEnabled: (r.chatbaseEnabled as boolean) ?? false,
      algoliaEnabled: (r.algoliaEnabled as boolean) ?? false,
      feishuSyncEnabled: (r.feishuSyncEnabled as boolean) ?? true,
      buildOutputDir: (r.buildOutputDir as string) ?? 'build',
      stagingDeployMode: (r.stagingDeployMode as StagingDeployMode) ?? 'local_static_dir',
      stagingDeployDir: (r.stagingDeployDir as string) ?? '/home/workspace/staging-deploy',
      autoBuildBeforeDeploy: (r.autoBuildBeforeDeploy as boolean) ?? true,
      requireBuildCheck: (r.requireBuildCheck as boolean) ?? true,
      productionDeployMode: (r.productionDeployMode as ProductionDeployMode) ?? 'local_static_dir',
      productionDeployDir: (r.productionDeployDir as string) ?? '/home/workspace/production-deploy',
      requireStagingSuccessBeforeProduction: (r.requireStagingSuccessBeforeProduction as boolean) ?? true,
      requireBuildCheckBeforeProduction: (r.requireBuildCheckBeforeProduction as boolean) ?? true,
      autoBuildBeforeProductionDeploy: (r.autoBuildBeforeProductionDeploy as boolean) ?? true,
      sensitiveFieldsTip: '敏感密钥由后端或密钥管理服务维护',
    };
  }
}
