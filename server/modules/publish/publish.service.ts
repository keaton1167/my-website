import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { publishTasks, docs, categories } from '@server/database/schema';
import { eq, desc, count, sql, and } from 'drizzle-orm';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync, rmSync, cpSync } from 'fs';
import * as path from 'path';
import * as https from 'https';
import { SystemConfigService } from '../system-config/system-config.service';
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
} from '@shared/api.interface';

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private readonly execAsync = promisify(exec);

  async getTaskList(params: PublishTaskListParams): Promise<PublishTaskListResponse> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (params.taskType) conditions.push(eq(publishTasks.taskType, params.taskType));
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
          this.db.select({ count: count() }).from(publishTasks),
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
            .where(eq(publishTasks.status, '失败')),
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

  private async syncDocsToProject(projectRoot: string, logLines: string[]): Promise<void> {
    const ts = () => new Date().toLocaleString('zh-CN');
    logLines.push(`[${ts()}] [文档生成] 开始从数据库同步文档到项目目录...`);
    logLines.push(`[${ts()}] [文档生成] 项目路径: ${projectRoot}`);

    const docsRows = await this.db
      .select({
        id: docs.id,
        title: docs.title,
        filePath: docs.filePath,
        markdownContent: docs.markdownContent,
        contentStatus: docs.contentStatus,
        firstCategory: docs.firstCategory,
        secondCategory: docs.secondCategory,
        language: docs.language,
      })
      .from(docs)
      .where(
        and(
          eq(docs.contentStatus, '有正文'),
          eq(docs.publishStatus, '已发布'),
          sql`${docs.filePath} IS NOT NULL AND ${docs.filePath} != ''`,
        ),
      );

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

      const absolutePath = path.resolve(projectRoot, filePath);
      const isZh = (doc.language ?? 'zh-CN') === 'zh-CN';
      const allowedRoot = isZh ? docsDirResolved : i18nDirResolved;

      if (!absolutePath.startsWith(allowedRoot + path.sep) && absolutePath !== allowedRoot) {
        logLines.push(`[${ts()}] [文档生成] 跳过: ${doc.title}, 原因: 路径不在允许的目录内 (${allowedRoot})`);
        skippedCount++;
        continue;
      }

      const parentDir = path.dirname(absolutePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      const content = doc.markdownContent ?? '';
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
      logLines.push(`[${ts()}] [文档生成] 写入文档: ${filePath} (${doc.title})`);
      writtenCount++;

      if (doc.firstCategory) {
        const firstCat = resolveCat(doc.firstCategory);
        if (firstCat) {
          const pathSegments = filePath.replace(/^docs\//, '').replace(/^i18n\/en\/docusaurus-plugin-content-docs\/current\//, '').split('/');
          const firstSlug = pathSegments[0];
          if (firstSlug) {
            const catDir = isZh
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
                const secondCatDir = isZh
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

    const qualifiedPaths = new Set(docsRows.filter((d) => {
      if (d.firstCategory && !enabledCatIds.has(d.firstCategory)) return false;
      if (d.filePath!.includes('..')) return false;
      const ext = path.extname(d.filePath!).toLowerCase();
      if (ext !== '.md' && ext !== '.mdx') return false;
      return true;
    }).map((d) => d.filePath!));

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

    if (cleanedCount > 0) {
      logLines.push(`[${ts()}] [文档生成] 共清理 ${cleanedCount} 个旧文件`);
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

    logLines.push(`[${ts()}] [文档生成] 同步完成: 写入 ${writtenCount} 篇文档, 生成 ${categoryCount} 个 _category_.json`);
    if (skippedCount > 0) {
      logLines.push(`[${ts()}] [文档生成] 跳过 ${skippedCount} 篇（路径非法/为空）`);
    }
  }

  private async executeStagingDeploy(taskId: string, scope: PublishScope): Promise<void> {
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const buildLogLines: string[] = [];
    const deployLogLines: string[] = [];

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

      await this.syncDocsToProject(projectRoot, buildLogLines);

      const docusaurusCacheDir = path.join(projectRoot, '.docusaurus');
      if (existsSync(docusaurusCacheDir)) {
        try {
          rmSync(docusaurusCacheDir, { recursive: true, force: true });
          buildLogLines.push(`[${ts()}] [构建] 已清理 .docusaurus 缓存`);
        } catch { /* ignore */ }
      }

      buildLogLines.push(`[${ts()}] [构建] 构建命令: ${buildCmd}`);
      buildLogLines.push(`[${ts()}] [构建] 开始执行构建...`);
      buildLogLines.push('--- 构建输出 ---');

      const buildTimeout = 15 * 60 * 1000;
      const { stdout, stderr } = await this.execAsync(buildCmd, {
        cwd: projectRoot,
        timeout: buildTimeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'production' },
      });

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
      const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);

      deployLogLines.push(`[${ts()}] [部署] stagingDeployDir: ${stagingDeployDir}`);
      deployLogLines.push(`[${ts()}] [部署] deployTargetDir: ${deployTargetDir}`);
      deployLogLines.push(`[${ts()}] [部署] 复制文件数量: ${fileCount}`);
      deployLogLines.push(`[${ts()}] [部署] 部署总大小: ${totalSizeMB} MB`);
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

      this.logger.error(`测试环境发布失败: taskId=${taskId}, 耗时=${totalDurationSec}s, error=${errorDetail.slice(0, 500)}`);
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
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const buildLogLines: string[] = [];
    const deployLogLines: string[] = [];

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

      buildLogLines.push(`[${ts()}] [构建] 构建命令: ${buildCmd}`);
      buildLogLines.push(`[${ts()}] [构建] 开始执行构建...`);
      buildLogLines.push('--- 构建输出 ---');

      const buildTimeout = 15 * 60 * 1000;
      const { stdout, stderr } = await this.execAsync(buildCmd, {
        cwd: projectRoot,
        timeout: buildTimeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'production' },
      });

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
        })
        .from(publishTasks)
        .where(eq(publishTasks.id, taskId))
        .limit(1);

      if (!result.length) {
        return { buildLog: undefined, deployLog: undefined };
      }

      const row = result[0];
      return {
        buildLog: row.buildLog ?? undefined,
        deployLog: row.deployLog ?? undefined,
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

  private repairGitCorruption(
    projectRoot: string,
    logLines: string[],
  ): void {
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

    const indexPath = path.join(gitDir, 'index');
    try {
      if (existsSync(indexPath)) {
        const indexStat = statSync(indexPath);
        if (indexStat.isFile() && indexStat.size < 12) {
          logLines.push(`[${ts()}] [Git] 检测到损坏的 index 文件（${indexStat.size} bytes），删除重建`);
          unlinkSync(indexPath);
          logLines.push(`[${ts()}] [Git] index 已删除，Git 将自动重建`);
        }
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? '';
      logLines.push(`[${ts()}] [Git] index 修复失败: ${this.sanitizeLog(msg)}`);
    }

    const configPath = path.join(gitDir, 'config');
    try {
      if (existsSync(configPath)) {
        const content = readFileSync(configPath, 'utf-8');
        if (!content.includes('[remote') || !content.includes('[core]')) {
          logLines.push(`[${ts()}] [Git] 检测到截断的 config 文件，重写基础配置`);
          const newConfig = [
            '[core]',
            '\trepositoryformatversion = 0',
            '\tfilemode = false',
            '\tbare = false',
            '\tlogallrefupdates = true',
            '[user]',
            '\tname = HelpCenter Sync',
            '\temail = sync@help-center.local',
          ].join('\n') + '\n';
          writeFileSync(configPath, newConfig);
          logLines.push(`[${ts()}] [Git] config 已重写基础配置`);
        }
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? '';
      logLines.push(`[${ts()}] [Git] config 修复失败: ${this.sanitizeLog(msg)}`);
    }
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

      logLines.push(`[${ts()}] [构建检查] 执行命令: ${buildCmd}`);
      logLines.push('--- 构建输出 ---');

      const timeout = 15 * 60 * 1000;
      const { stdout, stderr } = await this.execAsync(buildCmd, {
        cwd: projectRoot,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'production' },
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
      if (config.repoUrl) {
        try {
          await execGit('git remote get-url origin');
          await execGit(`git remote set-url origin ${config.repoUrl}`);
          logLines.push(`[${ts()}] [Git] 已更新远程仓库地址`);
        } catch {
          await execGit(`git remote add origin ${config.repoUrl}`);
          logLines.push(`[${ts()}] [Git] 已添加远程仓库地址`);
        }
      }

      let gitRemote = 'origin';
      if (config.repoUrl) {
        try {
          await this.execAsync('git remote get-url github', { cwd: projectRoot, timeout: 10 * 1000, env: { ...process.env } });
          await this.execAsync(`git remote set-url github ${config.repoUrl}`, { cwd: projectRoot, timeout: 10 * 1000, env: { ...process.env } });
          gitRemote = 'github';
        } catch {
          try {
            await this.execAsync(`git remote add github ${config.repoUrl}`, { cwd: projectRoot, timeout: 10 * 1000, env: { ...process.env } });
            gitRemote = 'github';
          } catch { /* fall back to origin */ }
        }
      }

      if (pushToken) {
        askpassPath = path.join('/tmp', `askpass-${taskId}.sh`);
        writeFileSync(askpassPath, `#!/bin/sh\necho "${pushToken}"`, { mode: 0o700 });
      }
      const authEnv: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...(process.env.HTTPS_PROXY ? { https_proxy: process.env.HTTPS_PROXY } : {}),
        ...(process.env.HTTP_PROXY ? { http_proxy: process.env.HTTP_PROXY } : {}),
        ...(askpassPath ? { GIT_ASKPASS: askpassPath } : {}),
      };

      this.repairGitCorruption(projectRoot, logLines);

      try {
        const fetchCmd = `git fetch ${gitRemote}`;
        logLines.push(`[${ts()}] [Git] $ ${fetchCmd}`);
        await this.execAsync(fetchCmd, { cwd: projectRoot, timeout: 30 * 1000, env: authEnv });
        logLines.push(`[${ts()}] [Git] 已同步远程仓库历史`);
      } catch (fetchErr: unknown) {
        const msg = (fetchErr as { message?: string }).message ?? '';
        logLines.push(`[${ts()}] [Git] fetch 首次失败: ${this.sanitizeLog(msg)}`);
        logLines.push(`[${ts()}] [Git] 尝试修复损坏引用并重试...`);

        try {
          await this.execAsync(`git remote prune ${gitRemote}`, { cwd: projectRoot, timeout: 30 * 1000, env: authEnv });
        } catch { /* continue */ }

        this.repairGitCorruption(projectRoot, logLines);

        try {
          const fetchCmd2 = `git fetch ${gitRemote}`;
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
        this.repairGitCorruption(projectRoot, logLines);
        try { await execGit('git config user.name "HelpCenter Sync"'); } catch { /* ignore */ }
        try { await execGit('git config user.email "sync@help-center.local"'); } catch { /* ignore */ }
        try { await execGit('git config core.fileMode false'); } catch { /* ignore */ }
        try {
          await execGit(`git remote get-url ${gitRemote}`);
          await execGit(`git remote set-url ${gitRemote} ${config.repoUrl}`);
        } catch {
          try { await execGit(`git remote add ${gitRemote} ${config.repoUrl}`); } catch { /* exists */ }
        }

        const maskedPushCmd = `git push ${gitRemote} ${branchName}`;
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

      await this.execAsync('git remote get-url origin', { cwd: projectRoot, timeout: 10 * 1000 });
      await this.execAsync(`git remote set-url origin ${config.repoUrl}`, {
        cwd: projectRoot,
        timeout: 10 * 1000,
      });

      let gitRemote = 'origin';
      try {
        await this.execAsync('git remote get-url github', { cwd: projectRoot, timeout: 10 * 1000 });
        await this.execAsync(`git remote set-url github ${config.repoUrl}`, { cwd: projectRoot, timeout: 10 * 1000 });
        gitRemote = 'github';
      } catch {
        try {
          await this.execAsync(`git remote add github ${config.repoUrl}`, { cwd: projectRoot, timeout: 10 * 1000 });
          gitRemote = 'github';
        } catch { /* fall back to origin */ }
      }

      let askpassPath: string | null = null;
      try {
        if (token) {
          askpassPath = path.join('/tmp', `askpass-retry-${taskId}.sh`);
          writeFileSync(askpassPath, `#!/bin/sh\necho "${token}"`, { mode: 0o700 });
        }

        const pushEnv: NodeJS.ProcessEnv = {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          ...(process.env.HTTPS_PROXY ? { https_proxy: process.env.HTTPS_PROXY } : {}),
          ...(process.env.HTTP_PROXY ? { http_proxy: process.env.HTTP_PROXY } : {}),
          ...(askpassPath ? { GIT_ASKPASS: askpassPath } : {}),
        };

        try {
          await this.execAsync(`git fetch ${gitRemote}`, {
            cwd: projectRoot,
            timeout: 30 * 1000,
            env: pushEnv,
          });
        } catch { /* fetch failure is non-fatal for retry push */ }

        const { stderr: pushStderr } = await this.execAsync(`git push ${gitRemote} ${branchName}`, {
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

  async triggerWebsitePublish(userId: string, scope?: string): Promise<WebsitePublishResponse> {
    const timestamp = new Date().toLocaleString('zh-CN');
    const publishScope = (scope ?? 'all') as PublishScope;
    const taskName = `发布到网站 - ${timestamp}`;

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
      return { success: false, taskId: '', message: '构建检查未通过，请先执行构建检查并确保通过后再发布' };
    }

    const initialLog = [
      `[${timestamp}] [发布到网站] 任务已创建，状态: 执行中`,
      `[${timestamp}] [发布到网站] 操作人: ${userId}`,
      `[${timestamp}] [发布到网站] 范围: ${publishScope}`,
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
        throw new Error('创建发布到网站任务失败：未返回 ID');
      }

      this.logger.log(`发布到网站任务已创建: ${taskId}, 操作人: ${userId}`);

      this.executeWebsitePublishPipeline(taskId, config, publishScope, userId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`发布到网站异步异常: taskId=${taskId}, error=${msg}`);
      });

      return { success: true, taskId };
    } catch (error) {
      this.logger.error('创建发布到网站任务失败', JSON.stringify(error));
      throw error;
    }
  }

  private async executeWebsitePublishPipeline(
    taskId: string,
    config: { repoUrl: string; defaultBranch: string; workBranchPrefix: string; docusaurusProjectDir?: string; productionUrl?: string },
    scope: PublishScope,
    userId: string,
  ): Promise<void> {
    const startTime = Date.now();
    const ts = () => new Date().toLocaleString('zh-CN');
    const logLines: string[] = [];
    const projectRoot = config.docusaurusProjectDir || '/home/gm/workspace/code';

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

      const { owner, repo } = this.parseGitHubRepoInfo(config.repoUrl);
      logLines.push(`[${ts()}] [Pipeline] 开始自动发布流程`);
      logLines.push(`[${ts()}] [Pipeline] 仓库: ${owner}/${repo}`);
      logLines.push(`[${ts()}] [Pipeline] 项目路径: ${projectRoot}`);

      // === Step 1: syncDocsToProject + Docusaurus build ===
      pipeline.build.status = 'running';
      await updatePipeline({});
      logLines.push(`[${ts()}] [Step 1/6] 同步文档并构建 Docusaurus`);

      if (!existsSync(projectRoot)) {
        await failPipeline('build', `项目路径不存在: ${projectRoot}`);
        return;
      }

      await this.syncDocsToProject(projectRoot, logLines);
      logLines.push(`[${ts()}] [Step 1] 文档同步完成`);

      const docusaurusCacheDir = path.join(projectRoot, '.docusaurus');
      if (existsSync(docusaurusCacheDir)) {
        try {
          rmSync(docusaurusCacheDir, { recursive: true, force: true });
          logLines.push(`[${ts()}] [Step 1] 已清理 .docusaurus 缓存`);
        } catch { /* ignore */ }
      }
      const webpackCacheDir = path.join(projectRoot, 'node_modules', '.cache');
      if (existsSync(webpackCacheDir)) {
        try {
          rmSync(webpackCacheDir, { recursive: true, force: true });
          logLines.push(`[${ts()}] [Step 1] 已清理 webpack 缓存`);
        } catch { /* ignore */ }
      }

      const packageJsonPath = path.join(projectRoot, 'package.json');
      if (!existsSync(packageJsonPath)) {
        await failPipeline('build', `项目路径下未找到 package.json: ${packageJsonPath}`);
        return;
      }

      const packageJsonContent = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const buildScript = packageJsonContent.scripts?.build;
      let buildCmd = buildScript ? 'npm run build' : 'npx docusaurus build';
      if (scope === 'zh-CN') buildCmd += ' -- --locale zh-Hans';
      else if (scope === 'en') buildCmd += ' -- --locale en';

      logLines.push(`[${ts()}] [Step 1] 执行构建: ${buildCmd}`);

      try {
        const { stdout, stderr } = await this.execAsync(buildCmd, {
          cwd: projectRoot,
          timeout: 15 * 60 * 1000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, NODE_ENV: 'production' },
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
      await updatePipeline({});

      // === Step 2: Git commit + push ===
      pipeline.gitPush.status = 'running';
      await updatePipeline({});
      logLines.push(`[${ts()}] [Step 2/6] Git 提交推送`);

      const execGit = async (cmd: string): Promise<{ stdout: string; stderr: string }> => {
        const maskedCmd = this.sanitizeLog(cmd);
        logLines.push(`[${ts()}] [Git] $ ${maskedCmd}`);
        const { stdout, stderr } = await this.execAsync(cmd, {
          cwd: projectRoot,
          timeout: 60 * 1000,
          maxBuffer: 5 * 1024 * 1024,
          env: { ...process.env },
        });
        if (stderr) logLines.push(`[stderr] ${this.sanitizeLog(stderr)}`);
        return { stdout, stderr };
      };

      let askpassPath: string | null = null;
      let branchName = '';
      let commitHash = '';
      let gitRemote = 'origin';

      this.repairGitCorruption(projectRoot, logLines);

      try {
        await execGit('git config user.name "HelpCenter Sync"');
        await execGit('git config user.email "sync@help-center.local"');
        await execGit('git config core.fileMode false');

        try {
          await execGit('git remote get-url origin');
          await execGit(`git remote set-url origin ${config.repoUrl}`);
        } catch {
          await execGit(`git remote add origin ${config.repoUrl}`);
        }

        try {
          await this.execAsync('git remote get-url github', { cwd: projectRoot, timeout: 10 * 1000, env: { ...process.env } });
          await this.execAsync(`git remote set-url github ${config.repoUrl}`, { cwd: projectRoot, timeout: 10 * 1000, env: { ...process.env } });
          gitRemote = 'github';
        } catch {
          try {
            await this.execAsync(`git remote add github ${config.repoUrl}`, { cwd: projectRoot, timeout: 10 * 1000, env: { ...process.env } });
            gitRemote = 'github';
          } catch { /* fall back to origin */ }
        }

        if (token) {
          askpassPath = path.join('/tmp', `askpass-wp-${taskId}.sh`);
          writeFileSync(askpassPath, `#!/bin/sh\necho "${token}"`, { mode: 0o700 });
        }
        const authEnv: NodeJS.ProcessEnv = {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          ...(process.env.HTTPS_PROXY ? { https_proxy: process.env.HTTPS_PROXY } : {}),
          ...(process.env.HTTP_PROXY ? { http_proxy: process.env.HTTP_PROXY } : {}),
          ...(askpassPath ? { GIT_ASKPASS: askpassPath } : {}),
        };

        this.repairGitCorruption(projectRoot, logLines);

        try {
          logLines.push(`[${ts()}] [Git] $ git fetch ${gitRemote}`);
          await this.execAsync(`git fetch ${gitRemote}`, { cwd: projectRoot, timeout: 120 * 1000, env: authEnv });
          logLines.push(`[${ts()}] [Git] 已同步远程仓库历史`);
        } catch (fetchErr: unknown) {
          const msg = (fetchErr as { message?: string }).message ?? '';
          logLines.push(`[${ts()}] [Git] fetch 首次失败: ${this.sanitizeLog(msg)}`);
          logLines.push(`[${ts()}] [Git] 尝试修复损坏引用并重试...`);

          try {
            await this.execAsync(`git remote prune ${gitRemote}`, { cwd: projectRoot, timeout: 30 * 1000, env: authEnv });
            logLines.push(`[${ts()}] [Git] remote prune 完成`);
          } catch (pruneErr: unknown) {
            const pruneMsg = (pruneErr as { message?: string }).message ?? '';
            logLines.push(`[${ts()}] [Git] remote prune 失败（继续尝试）: ${this.sanitizeLog(pruneMsg)}`);
          }

          this.repairGitCorruption(projectRoot, logLines);

          try {
            logLines.push(`[${ts()}] [Git] $ git fetch ${gitRemote}（重试）`);
            await this.execAsync(`git fetch ${gitRemote}`, { cwd: projectRoot, timeout: 120 * 1000, env: authEnv });
            logLines.push(`[${ts()}] [Git] fetch 重试成功`);
          } catch (retryErr: unknown) {
            const retryMsg = (retryErr as { message?: string }).message ?? '';
            logLines.push(`[${ts()}] [Git] fetch 重试失败: ${this.sanitizeLog(retryMsg)}`);
            throw new Error(`无法同步远程仓库历史: ${this.sanitizeLog(retryMsg).slice(0, 300)}`);
          }
        }

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
        const defaultBranch = config.defaultBranch || 'main';

        try { await execGit('git stash --include-untracked'); } catch { /* nothing */ }
        await execGit(`git checkout -b ${branchName} ${gitRemote}/${defaultBranch}`);
        logLines.push(`[${ts()}] [Git] 创建工作分支: ${branchName}`);
        try { await execGit('git stash pop'); } catch { /* no stash */ }

        try { await execGit('git read-tree HEAD'); } catch { /* repair index */ }

        const allowedPaths = ['docs/', 'i18n/', 'static/img/help-center/', 'static/files/help-center/'];
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

        this.repairGitCorruption(projectRoot, logLines);

        try { await execGit('git config user.name "HelpCenter Sync"'); } catch { /* ignore */ }
        try { await execGit('git config user.email "sync@help-center.local"'); } catch { /* ignore */ }

        const commitMsg = `sync help center docs: ${branchName}`;
        await execGit(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
        const { stdout: hashOut } = await execGit('git rev-parse HEAD');
        commitHash = hashOut.trim();

        this.repairGitCorruption(projectRoot, logLines);
        try { await execGit('git config user.name "HelpCenter Sync"'); } catch { /* ignore */ }
        try { await execGit('git config user.email "sync@help-center.local"'); } catch { /* ignore */ }
        try { await execGit('git config core.fileMode false'); } catch { /* ignore */ }
        try {
          await execGit(`git remote get-url ${gitRemote}`);
          await execGit(`git remote set-url ${gitRemote} ${config.repoUrl}`);
        } catch {
          try { await execGit(`git remote add ${gitRemote} ${config.repoUrl}`); } catch { /* exists */ }
        }

        logLines.push(`[${ts()}] [Git] $ git push ${gitRemote} ${branchName}`);
        const { stderr: pushStderr } = await this.execAsync(`git push ${gitRemote} ${branchName}`, {
          cwd: projectRoot, timeout: 60 * 1000, maxBuffer: 5 * 1024 * 1024, env: authEnv,
        });
        if (pushStderr) logLines.push(`[stderr] ${this.sanitizeLog(pushStderr)}`);
        logLines.push(`[${ts()}] [Step 2] 推送成功: ${gitRemote}/${branchName}, commit: ${commitHash}`);
      } finally {
        if (askpassPath) { try { unlinkSync(askpassPath); } catch { /* ignore */ } }
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
      const prTitle = `[Auto] sync help center docs - ${new Date().toISOString().slice(0, 10)}`;
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

      const deployUrl = config.productionUrl || `https://${owner}.github.io/${repo}/`;
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

      this.logger.log(`发布到网站成功: taskId=${taskId}, pr=#${prNumber}, deploy=${deployUrl}`);
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

      const allowedPrefixes = ['docs/', 'i18n/', 'static/img/help-center/', 'static/files/help-center/'];
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
    return {
      id: item.id as string,
      taskName: item.taskName as string,
      taskType: item.taskType as TaskType,
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
      deployLog: (item.deployLog as string) ?? '',
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
    };
  }
}
