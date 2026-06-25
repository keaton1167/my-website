import { Injectable, Logger, Inject, OnModuleInit, BadRequestException } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, or, desc, sql, count, like, isNull } from 'drizzle-orm';
import { feishuDocMappings, feishuSyncTasks, categories, docs } from '@server/database/schema';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import { FeishuService, type DownloadResult } from './feishu.service';
import { SystemConfigService } from '@server/modules/system-config/system-config.service';
import { convertBlocksToMarkdown, generateFrontmatter, replaceTokenPaths } from './feishu-doc-converter';
import type { ConvertResult, BlockData, ConvertStats, BitableInfo } from './feishu-doc-converter';
import { processPptx, type PptxProcessResult } from './pptx-processor';

const BITABLE_DATE_TYPES = new Set([5, 1001, 1002]);
import type {
  FeishuDocMapping,
  FeishuMappingStatistics,
  FeishuMappingListParams,
  FeishuMappingListResponse,
  CreateFeishuMappingRequest,
  UpdateFeishuMappingRequest,
  FeishuSyncLogItem,
  FeishuSyncLogListResponse,
  SuccessResponse,
  CreateResponse,
  BatchActionResponse,
  BatchCreateFeishuMappingResponse,
  Language,
  PreviewMarkdownResponse,
  FeishuErrorCategory,
  DrivePermissionCheckResponse,
  RetryResourcesResponse,
  WikiDiagnoseResponse,
  WikiPreviewTreeResponse,
  WikiTreeNodeItem,
  WikiImportRequest,
  WikiImportResponse,
  WikiImportResultItem,
  SyncMode,
  ResourceRepairResult,
  ResourceRepairItem,
} from '@shared/api.interface';

@Injectable()
export class FeishuMappingsService implements OnModuleInit {
  private readonly logger = new Logger(FeishuMappingsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly feishuService: FeishuService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  private async getProjectRoot(): Promise<string> {
    const config = await this.systemConfigService.getConfig();
    return config.docusaurusProjectDir || '/home/workspace/docusaurus';
  }

  async onModuleInit(): Promise<void> {
    const nullRows = await this.db
      .select({ id: feishuDocMappings.id })
      .from(feishuDocMappings)
      .where(isNull(feishuDocMappings.translationGroupId));
    if (nullRows.length > 0) {
      for (const row of nullRows) {
        await this.db
          .update(feishuDocMappings)
          .set({ translationGroupId: randomUUID() })
          .where(eq(feishuDocMappings.id, row.id));
      }
      this.logger.log(`Backfilled translationGroupId for ${nullRows.length} mappings`);
    }
    await this.backfillHelpCenterUrls();
  }

  async getStatistics(): Promise<FeishuMappingStatistics> {
    const [totalResult, successResult, failedResult, pausedResult, todayResult] =
      await Promise.all([
        this.db.select({ count: count() }).from(feishuDocMappings),
        this.db
          .select({ count: count() })
          .from(feishuDocMappings)
          .where(eq(feishuDocMappings.syncStatus, '同步成功')),
        this.db
          .select({ count: count() })
          .from(feishuDocMappings)
          .where(eq(feishuDocMappings.syncStatus, '同步失败')),
        this.db
          .select({ count: count() })
          .from(feishuDocMappings)
          .where(eq(feishuDocMappings.syncStatus, '已暂停')),
        this.db
          .select({ count: count() })
          .from(feishuSyncTasks)
          .where(
            sql`(${feishuSyncTasks.createdAt})::date = CURRENT_DATE`,
          ),
      ]);

    return {
      totalCount: parseInt(String(totalResult[0]?.count ?? '0'), 10),
      syncSuccessCount: parseInt(String(successResult[0]?.count ?? '0'), 10),
      syncFailedCount: parseInt(String(failedResult[0]?.count ?? '0'), 10),
      pausedCount: parseInt(String(pausedResult[0]?.count ?? '0'), 10),
      todaySyncCount: parseInt(String(todayResult[0]?.count ?? '0'), 10),
    };
  }

  async getList(
    params: FeishuMappingListParams,
  ): Promise<FeishuMappingListResponse> {
    const {
      targetFirstCategory,
      targetSecondCategory,
      syncMode,
      syncStatus,
      language,
      owner,
      keyword,
      page = 1,
      pageSize = 20,
    } = params;

    const conditions = [];
    if (targetFirstCategory)
      conditions.push(eq(feishuDocMappings.targetFirstCategory, targetFirstCategory));
    if (targetSecondCategory)
      conditions.push(eq(feishuDocMappings.targetSecondCategory, targetSecondCategory));
    if (syncMode)
      conditions.push(eq(feishuDocMappings.syncMode, syncMode));
    if (syncStatus)
      conditions.push(eq(feishuDocMappings.syncStatus, syncStatus));
    if (language)
      conditions.push(eq(feishuDocMappings.language, language));
    if (keyword) {
      conditions.push(
        or(
          like(feishuDocMappings.feishuDocTitle, `%${keyword}%`),
          like(feishuDocMappings.helpCenterTitle, `%${keyword}%`),
        )!,
      );
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    const ownerCondition = owner
      ? sql`(owner).user_id = ${owner}`
      : undefined;

    const finalWhere =
      whereClause && ownerCondition
        ? and(whereClause, ownerCondition)
        : whereClause ?? ownerCondition ?? undefined;

    const offset = (page - 1) * pageSize;

    const [rows, totalResult] = await Promise.all([
      finalWhere
        ? this.db
            .select()
            .from(feishuDocMappings)
            .where(finalWhere)
            .orderBy(desc(feishuDocMappings.updatedAt))
            .limit(pageSize)
            .offset(offset)
        : this.db
            .select()
            .from(feishuDocMappings)
            .orderBy(desc(feishuDocMappings.updatedAt))
            .limit(pageSize)
            .offset(offset),
      finalWhere
        ? this.db
            .select({ count: count() })
            .from(feishuDocMappings)
            .where(finalWhere)
        : this.db.select({ count: count() }).from(feishuDocMappings),
    ]);

    const total = parseInt(String(totalResult[0]?.count ?? '0'), 10);
    const groupMap = new Map<string, { languages: Set<string>; zhUpdatedAt: string; enUpdatedAt: string }>();
    for (const row of rows) {
      const gid = row.translationGroupId ?? '';
      if (!gid) continue;
      if (!groupMap.has(gid)) {
        groupMap.set(gid, { languages: new Set(), zhUpdatedAt: '', enUpdatedAt: '' });
      }
      const g = groupMap.get(gid)!;
      const lang = (row.language as string) ?? 'zh-CN';
      g.languages.add(lang);
      const updatedAt = row.updatedAt?.toISOString() ?? '';
      if (lang === 'zh-CN') g.zhUpdatedAt = updatedAt;
      if (lang === 'en') g.enUpdatedAt = updatedAt;
    }

    const items: FeishuDocMapping[] = rows.map(
      (row: typeof feishuDocMappings.$inferSelect): FeishuDocMapping => {
        const gid = row.translationGroupId ?? '';
        const g = groupMap.get(gid);
        let translationStatus = '仅中文';
        if (g) {
          const hasZh = g.languages.has('zh-CN');
          const hasEn = g.languages.has('en');
          if (hasZh && hasEn) {
            translationStatus = g.enUpdatedAt >= g.zhUpdatedAt ? '中英文完整' : '英文待更新';
          } else if (hasEn && !hasZh) {
            translationStatus = '仅英文';
          }
        }
        return {
          id: row.id,
          feishuDocTitle: row.feishuDocTitle ?? '',
          feishuDocUrl: row.feishuDocUrl,
          feishuDocToken: row.feishuDocToken ?? '',
          targetFirstCategory: row.targetFirstCategory ?? '',
          targetSecondCategory: row.targetSecondCategory ?? '',
          helpCenterTitle: row.helpCenterTitle ?? '',
          helpCenterSlug: row.helpCenterSlug ?? '',
          helpCenterFilePath: row.helpCenterFilePath ?? '',
          helpCenterUrl: row.helpCenterUrl ?? '',
          language: (row.language as Language) ?? 'zh-CN',
          syncMode: (row.syncMode as FeishuDocMapping['syncMode']) ?? '手动同步',
          syncStatus: (row.syncStatus as FeishuDocMapping['syncStatus']) ?? '未同步',
          lastSyncAt: row.lastSyncAt?.toISOString() ?? '',
          lastSyncBy: row.lastSyncBy ?? '',
          owner: row.owner ?? '',
          enabled: row.enabled ?? true,
          translationGroupId: gid,
          targetDocumentId: row.targetDocumentId ?? '',
          translationStatus,
          createdAt: row.createdAt?.toISOString() ?? '',
          updatedAt: row.updatedAt?.toISOString() ?? '',
        };
      },
    );

    return { items, total };
  }

  async create(
    body: CreateFeishuMappingRequest,
    userId: string,
  ): Promise<CreateResponse> {
    const { helpCenterUrl, helpCenterFilePath } =
      await this.buildHelpCenterPaths(
        body.targetFirstCategory,
        body.targetSecondCategory,
        body.helpCenterSlug,
        body.language,
      );

    let translationGroupId: string;
    if (body.targetDocumentId) {
      const docRows = await this.db
        .select({ translationGroupId: docs.translationGroupId })
        .from(docs)
        .where(eq(docs.id, body.targetDocumentId))
        .limit(1);
      if (docRows.length === 0 || !docRows[0]?.translationGroupId) {
        throw new BadRequestException('目标文档不存在或缺少翻译组信息');
      }
      translationGroupId = docRows[0].translationGroupId;
      const existingInGroup = await this.db
        .select({ id: feishuDocMappings.id })
        .from(feishuDocMappings)
        .where(and(
          eq(feishuDocMappings.translationGroupId, translationGroupId),
          eq(feishuDocMappings.language, body.language),
        ))
        .limit(1);
      if (existingInGroup.length > 0) {
        throw new BadRequestException(
          `该翻译组下已存在${body.language === 'en' ? '英文' : '中文'}映射`,
        );
      }
    } else {
      translationGroupId = randomUUID();
    }

    const existingPath = await this.db
      .select({ id: feishuDocMappings.id })
      .from(feishuDocMappings)
      .where(and(
        eq(feishuDocMappings.language, body.language),
        eq(feishuDocMappings.helpCenterFilePath, helpCenterFilePath),
      ))
      .limit(1);
    if (existingPath.length > 0) {
      throw new BadRequestException(
        `该语言下已存在路径 "${helpCenterFilePath}" 的映射，请修改路径标识`,
      );
    }

    try {
      const result = await this.db
        .insert(feishuDocMappings)
        .values({
          feishuDocUrl: body.feishuDocUrl,
          feishuDocTitle: body.feishuDocTitle || null,
          feishuDocToken: body.feishuDocToken || null,
          targetFirstCategory: body.targetFirstCategory || null,
          targetSecondCategory: body.targetSecondCategory || null,
          helpCenterTitle: body.helpCenterTitle,
          helpCenterSlug: body.helpCenterSlug,
          helpCenterFilePath,
          helpCenterUrl,
          language: body.language,
          syncMode: body.syncMode,
          syncStatus: body.syncAfterSave ? '同步中' : '未同步',
          enabled: body.enabled ?? true,
          owner: body.owner || userId || undefined,
          translationGroupId,
          targetDocumentId: body.targetDocumentId || null,
          createdBy: userId || undefined,
          updatedBy: userId || undefined,
        })
        .returning({ id: feishuDocMappings.id });

      this.logger.log(`Created feishu doc mapping id=${result[0]?.id}, groupId=${translationGroupId}`);
      return { id: result[0]?.id ?? '' };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('duplicate key') || msg.includes('23505')) {
        throw new BadRequestException(
          `该语言下已存在路径 "${helpCenterFilePath}" 的映射，请修改路径标识`,
        );
      }
      this.logger.error(`Create mapping failed: ${msg}`);
      throw new BadRequestException('创建映射失败：' + (msg || '未知错误'));
    }
  }

  async batchCreate(
    items: CreateFeishuMappingRequest[],
    userId: string,
  ): Promise<BatchCreateFeishuMappingResponse> {
    const ids: string[] = [];
    for (const item of items) {
      const result = await this.create(item, userId);
      if (result.id) ids.push(result.id);
    }
    this.logger.log(`batchCreate completed, created ${ids.length} mappings`);
    return { ids, total: ids.length };
  }

  async update(
    id: string,
    body: UpdateFeishuMappingRequest,
    userId: string,
  ): Promise<SuccessResponse> {
    const updateValues: Record<string, unknown> = {
      updatedBy: userId || undefined,
    };

    if (body.feishuDocTitle !== undefined)
      updateValues.feishuDocTitle = body.feishuDocTitle;
    if (body.targetFirstCategory !== undefined)
      updateValues.targetFirstCategory = body.targetFirstCategory;
    if (body.targetSecondCategory !== undefined)
      updateValues.targetSecondCategory = body.targetSecondCategory;
    if (body.helpCenterTitle !== undefined)
      updateValues.helpCenterTitle = body.helpCenterTitle;
    if (body.helpCenterSlug !== undefined)
      updateValues.helpCenterSlug = body.helpCenterSlug;
    if (body.owner !== undefined) updateValues.owner = body.owner;
    if (body.syncMode !== undefined) updateValues.syncMode = body.syncMode;
    if (body.syncStatus !== undefined) updateValues.syncStatus = body.syncStatus;
    if (body.enabled !== undefined) updateValues.enabled = body.enabled;
    if (body.language !== undefined) updateValues.language = body.language;
    if (body.targetDocumentId !== undefined)
      updateValues.targetDocumentId = body.targetDocumentId || null;

    if (
      body.targetFirstCategory !== undefined ||
      body.targetSecondCategory !== undefined ||
      body.helpCenterSlug !== undefined
    ) {
      const existing = await this.db
        .select()
        .from(feishuDocMappings)
        .where(eq(feishuDocMappings.id, id))
        .limit(1);
      if (existing.length > 0) {
        const firstCat: string =
          body.targetFirstCategory ??
          existing[0]?.targetFirstCategory ??
          '';
        const secondCat: string =
          body.targetSecondCategory ??
          existing[0]?.targetSecondCategory ??
          '';
        const slug: string =
          body.helpCenterSlug ?? existing[0]?.helpCenterSlug ?? '';
        const lang: string =
          body.language ?? (existing[0]?.language as string) ?? 'zh-CN';
        const paths = await this.buildHelpCenterPaths(
          firstCat,
          secondCat,
          slug,
          lang,
        );
        updateValues.helpCenterUrl = paths.helpCenterUrl;
        updateValues.helpCenterFilePath = paths.helpCenterFilePath;
      }
    }

    await this.db
      .update(feishuDocMappings)
      .set(updateValues)
      .where(eq(feishuDocMappings.id, id));

    return { success: true };
  }

  async remove(id: string): Promise<SuccessResponse> {
    await this.db
      .delete(feishuDocMappings)
      .where(eq(feishuDocMappings.id, id));
    return { success: true };
  }

  async syncOne(id: string, userId: string): Promise<CreateResponse> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new BadRequestException('无效的映射 ID');
    }

    const mapping = await this.db
      .select()
      .from(feishuDocMappings)
      .where(eq(feishuDocMappings.id, id))
      .limit(1);

    if (mapping.length === 0) throw new BadRequestException('映射不存在');

    const record = mapping[0];
    if (!record.feishuDocUrl) throw new BadRequestException('缺少飞书文档链接');

    await this.db
      .update(feishuDocMappings)
      .set({ syncStatus: '同步中', updatedBy: userId || undefined })
      .where(eq(feishuDocMappings.id, id));

    const taskResult = await this.db
      .insert(feishuSyncTasks)
      .values({
        mappingId: id,
        syncType: '手动同步',
        status: '同步中',
        createdBy: userId || undefined,
        updatedBy: userId || undefined,
      })
      .returning({ id: feishuSyncTasks.id });
    const taskId: string = taskResult[0]?.id ?? '';

    try {
      const documentSlug = path.basename(record.helpCenterFilePath ?? '', '.mdx') || record.helpCenterSlug || 'doc';
      const projectRoot = await this.getProjectRoot();
      const { markdown, title, stats } = await this.fetchFeishuDocMarkdown(record.feishuDocUrl, {
        documentSlug,
        downloadResources: true,
        projectRoot,
      });

      const resourceSummary = this.buildResourceSummary(stats);
      const frontmatter = generateFrontmatter(
        record.helpCenterTitle || title,
        1,
        undefined,
      );
      const fullContent = frontmatter + markdown;

      await this.db
        .update(feishuSyncTasks)
        .set({
          status: '成功',
          convertedMarkdown: fullContent,
          buildCheckStatus: '通过',
          errorMessage: resourceSummary || null,
          finishedAt: new Date(),
          updatedBy: userId || undefined,
        })
        .where(eq(feishuSyncTasks.id, taskId));

      await this.db
        .update(feishuDocMappings)
        .set({
          syncStatus: '同步成功',
          feishuDocTitle: title || record.feishuDocTitle,
          lastSyncAt: new Date(),
          lastSyncBy: userId || undefined,
          updatedBy: userId || undefined,
        })
        .where(eq(feishuDocMappings.id, id));

      let docId = record.targetDocumentId;

      if (docId) {
        await this.db
          .update(docs)
          .set({
            markdownContent: fullContent,
            contentStatus: '有正文',
            wordCount: this.calculateWordCount(markdown),
            updatedBy: userId || undefined,
          })
          .where(eq(docs.id, docId));
      } else {
        const existingDocs = await this.db
          .select({ id: docs.id })
          .from(docs)
          .where(and(
            eq(docs.language, record.language ?? 'zh-CN'),
            eq(docs.filePath, record.helpCenterFilePath ?? ''),
          ))
          .limit(1);

        if (existingDocs.length > 0) {
          docId = existingDocs[0].id;
          await this.db
            .update(docs)
            .set({
              markdownContent: fullContent,
              contentStatus: '有正文',
              wordCount: this.calculateWordCount(markdown),
              updatedBy: userId || undefined,
            })
            .where(eq(docs.id, docId));
        } else {
          const newDoc = await this.db
            .insert(docs)
            .values({
              title: record.helpCenterTitle || title || '',
              firstCategory: record.targetFirstCategory || null,
              secondCategory: record.targetSecondCategory || null,
              slug: record.helpCenterSlug || null,
              filePath: record.helpCenterFilePath || null,
              helpCenterUrl: record.helpCenterUrl || null,
              markdownContent: fullContent,
              contentStatus: '有正文',
              publishStatus: '草稿',
              sourceType: '飞书同步',
              sourceUrl: record.feishuDocUrl || null,
              language: (record.language as string) ?? 'zh-CN',
              translationGroupId: record.translationGroupId || randomUUID(),
              owner: record.owner || userId || undefined,
              createdBy: userId || undefined,
              updatedBy: userId || undefined,
              wordCount: this.calculateWordCount(markdown),
            })
            .returning({ id: docs.id });
          docId = newDoc[0]?.id ?? '';
        }

        await this.db
          .update(feishuDocMappings)
          .set({ targetDocumentId: docId })
          .where(eq(feishuDocMappings.id, id));
      }

      let writtenFilePath = '';
      if (record.helpCenterFilePath) {
        try {
          writtenFilePath = this.writeMarkdownFile(fullContent, record.helpCenterFilePath, projectRoot);
        } catch (writeError: unknown) {
          const writeMsg = writeError instanceof Error ? writeError.message : '未知错误';
          throw new Error(`[文件写入] ${writtenFilePath || record.helpCenterFilePath}: ${writeMsg}`);
        }
      }

      let categoryFilePaths: string[] = [];
      if (record.helpCenterFilePath && record.targetFirstCategory) {
        try {
          categoryFilePaths = await this.writeCategoryFiles(
            record.targetFirstCategory,
            record.targetSecondCategory || undefined,
            record.language ?? 'zh-CN',
            record.helpCenterFilePath,
            projectRoot,
          );
        } catch (catError: unknown) {
          const catMsg = catError instanceof Error ? catError.message : '未知错误';
          throw new Error(`[目录文件] ${catMsg}`);
        }
      }

      this.logger.log(`syncOne success id=${id}, taskId=${taskId}, docId=${docId}, file=${writtenFilePath || '(skipped)'}, categories=${JSON.stringify(categoryFilePaths)}, resources=${resourceSummary}`);
      return { id: taskId };
    } catch (error: unknown) {
      const errorMsg: string = error instanceof Error ? error.message : '未知错误';
      const isKnownStageError = errorMsg.startsWith('[文件写入]') || errorMsg.startsWith('[目录文件]');
      const taggedError = isKnownStageError
        ? errorMsg
        : `[${FeishuService.classifyError(errorMsg)}] ${errorMsg}`;
      this.logger.error(`syncOne failed id=${id}: ${taggedError}`);

      await this.db
        .update(feishuSyncTasks)
        .set({
          status: '失败',
          errorMessage: taggedError,
          finishedAt: new Date(),
          updatedBy: userId || undefined,
        })
        .where(eq(feishuSyncTasks.id, taskId));

      await this.db
        .update(feishuDocMappings)
        .set({
          syncStatus: '同步失败',
          lastSyncAt: new Date(),
          lastSyncBy: userId || undefined,
          updatedBy: userId || undefined,
        })
        .where(eq(feishuDocMappings.id, id));

      return { id: taskId };
    }
  }

  async syncBatch(ids: string[], userId: string): Promise<BatchActionResponse> {
    let successCount = 0;
    let failCount = 0;
    const errorMessages: string[] = [];

    for (const id of ids) {
      try {
        await this.syncOne(id, userId);
        successCount++;
      } catch (error: unknown) {
        const msg: string =
          error instanceof Error ? error.message : '未知错误';
        failCount++;
        errorMessages.push(`id=${id}: ${msg}`);
      }
    }

    return { successCount, failCount, skippedCount: 0, errorMessages };
  }

  async getSyncLogs(mappingId: string): Promise<FeishuSyncLogListResponse> {
    const rows = await this.db
      .select()
      .from(feishuSyncTasks)
      .where(eq(feishuSyncTasks.mappingId, mappingId))
      .orderBy(desc(feishuSyncTasks.createdAt));

    const totalResult = await this.db
      .select({ count: count() })
      .from(feishuSyncTasks)
      .where(eq(feishuSyncTasks.mappingId, mappingId));

    const total = parseInt(String(totalResult[0]?.count ?? '0'), 10);

    const mappingRows = await this.db
      .select({
        language: feishuDocMappings.language,
        feishuDocTitle: feishuDocMappings.feishuDocTitle,
        helpCenterTitle: feishuDocMappings.helpCenterTitle,
        helpCenterFilePath: feishuDocMappings.helpCenterFilePath,
      })
      .from(feishuDocMappings)
      .where(eq(feishuDocMappings.id, mappingId))
      .limit(1);

    const mappingDetail = mappingRows[0];

    const items: FeishuSyncLogItem[] = rows.map(
      (row: typeof feishuSyncTasks.$inferSelect): FeishuSyncLogItem => ({
        id: row.id,
        mappingId: row.mappingId,
        syncType: row.syncType ?? '',
        status: row.status ?? '',
        convertedMarkdown: row.convertedMarkdown ?? '',
        errorMessage: row.errorMessage ?? '',
        buildCheckStatus: row.buildCheckStatus ?? '',
        commitId: row.commitId ?? '',
        createdBy: row.createdBy ?? '',
        createdAt: row.createdAt?.toISOString() ?? '',
        finishedAt: row.finishedAt?.toISOString() ?? '',
        language: (mappingDetail?.language as Language) ?? undefined,
        feishuDocTitle: mappingDetail?.feishuDocTitle ?? undefined,
        helpCenterTitle: mappingDetail?.helpCenterTitle ?? undefined,
        helpCenterFilePath: mappingDetail?.helpCenterFilePath ?? undefined,
      }),
    );

    return { items, total };
  }

  async previewMarkdown(id: string): Promise<PreviewMarkdownResponse> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return { success: false, markdown: '', title: '', errorMessage: '无效的映射 ID', errorCategory: 'link_parse_error' };
    }
    const mapping = await this.db
      .select()
      .from(feishuDocMappings)
      .where(eq(feishuDocMappings.id, id))
      .limit(1);
    if (mapping.length === 0) {
      return { success: false, markdown: '', title: '', errorMessage: '映射不存在', errorCategory: 'link_parse_error' };
    }
    const record = mapping[0];
    if (!record.feishuDocUrl) {
      return { success: false, markdown: '', title: record.helpCenterTitle ?? '', errorMessage: '缺少飞书文档链接', errorCategory: 'link_parse_error' };
    }
    try {
      const { markdown, title } = await this.fetchFeishuDocMarkdown(record.feishuDocUrl);
      return { success: true, markdown, title: title || record.helpCenterTitle || '' };
    } catch (error: unknown) {
      const errorMsg: string = error instanceof Error ? error.message : '未知错误';
      const category: FeishuErrorCategory = FeishuService.classifyError(errorMsg);
      return { success: false, markdown: '', title: record.helpCenterTitle ?? '', errorMessage: errorMsg, errorCategory: category };
    }
  }

  private calculateWordCount(content: string): number {
    if (!content) return 0;
    const chineseChars = (content.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }

  private buildResourceSummary(stats: ConvertStats): string {
    const parts: string[] = [];
    if (stats.images > 0) parts.push(`图片 ${stats.images} 张`);
    if (stats.tables > 0) parts.push(`表格 ${stats.tables} 个`);
    if (stats.bitables > 0) parts.push(`多维表格 ${stats.bitables} 个`);
    if (stats.attachments > 0) parts.push(`附件 ${stats.attachments} 个`);
    if (parts.length === 0) return '';
    return `[资源处理] ${parts.join('，')}`;
  }

  async fetchFeishuDocMarkdown(
    feishuDocUrl: string,
    options?: { documentSlug?: string; downloadResources?: boolean; projectRoot?: string },
  ): Promise<{ markdown: string; title: string; stats: ConvertStats; downloadStats: { imgSuccess: number; imgFail: number; attSuccess: number; attFail: number } }> {
    if (!this.feishuService.isConfigured()) {
      throw new BadRequestException('飞书应用凭证未配置，请联系管理员配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
    }
    const parsed = FeishuService.parseDocToken(feishuDocUrl);
    const docToken = parsed.isWiki
      ? await this.feishuService.resolveWikiToken(parsed.token)
      : parsed.token;
    const [meta, blocks] = await Promise.all([
      this.feishuService.fetchDocumentMeta(docToken),
      this.feishuService.fetchDocumentBlocks(docToken),
    ]);

    const blockTypes = blocks.map((b) => (b as BlockData).block_type ?? 0);
    this.logger.log(`Block types in document: [${blockTypes.join(', ')}], total=${blocks.length}`);

    const bitableBlocks = blocks.filter((b) => ((b as BlockData).block_type ?? 0) === 18);
    for (const blk of bitableBlocks) {
      const bd = blk as BlockData;
      const rawTok = bd.bitable?.token ?? '';
      const masked = rawTok ? `${rawTok.slice(0, 8)}...${rawTok.slice(-6)}` : 'N/A';
      this.logger.log(
        `[diagnostic] bitable block: blockId=${(bd.block_id ?? '').slice(0, 12)}... ` +
        `rawToken=${masked} hasTableField=${!!bd.table} hasBitableField=${!!bd.bitable}`,
      );
    }

    for (const block of blocks) {
      const b = block as Record<string, unknown>;
      const bt = (b.block_type as number) ?? 0;
      const bid = ((b.block_id as string) ?? '').slice(0, 12);
      const hasFile = !!b.file;
      const hasDrive = !!(b.drive || b.file_view || b.view);
      const hasAttachment = !!(b as Record<string, unknown>).attachment;
      const hasMedia = !!(b.image || b.video || b.audio);
      const hasChildren = Array.isArray(b.children) && (b.children as unknown[]).length > 0;

      let fileName = '';
      let fileExt = '';
      let maskedToken = 'N/A';

      if (hasFile) {
        const f = b.file as Record<string, unknown>;
        fileName = (f.name as string) ?? '';
        fileExt = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
        const tok = (f.token as string) ?? '';
        maskedToken = tok ? `${tok.slice(0, 6)}...${tok.slice(-4)}` : 'N/A';
      } else if (hasDrive) {
        const d = (b.drive ?? b.file_view ?? b.view) as Record<string, unknown>;
        fileName = ((d.name ?? d.title) as string) ?? '';
        fileExt = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
        const tok = (d.token as string) ?? '';
        maskedToken = tok ? `${tok.slice(0, 6)}...${tok.slice(-4)}` : 'N/A';
      }

      if (hasFile || hasDrive || hasAttachment || hasMedia || (bt >= 18 && bt <= 48)) {
        const extraKeys = Object.keys(b).filter(
          (k) => !['block_id', 'block_type', 'parent_id', 'children'].includes(k),
        );
        this.logger.log(
          `[block-diag] id=${bid} type=${bt} file=${hasFile} drive=${hasDrive} ` +
          `attachment=${hasAttachment} media=${hasMedia} children=${hasChildren} ` +
          `fileName=${fileName || 'N/A'} ext=${fileExt || 'N/A'} token=${maskedToken} ` +
          `keys=${extraKeys.join(',')}`,
        );
      }
    }

    const convertResult: ConvertResult = convertBlocksToMarkdown(
      blocks,
      undefined,
      { skipResources: !options?.downloadResources },
    );

    let finalMarkdown = convertResult.markdown;
    const imagePathMap = new Map<string, string>();
    const attachmentPathMap = new Map<string, string>();
    let imgSuccess = 0;
    let imgFail = 0;
    let attSuccess = 0;
    let attFail = 0;
    let bitableSuccess = 0;
    let bitableFail = 0;

    for (const bitableInfo of convertResult.bitableInfos) {
      const placeholder = `[bitable_token_${bitableInfo.placeholderKey}]`;
      try {
        const tables = await this.feishuService.fetchBitableData(bitableInfo.appToken, bitableInfo.tableId);
        const hasError = tables.length === 1 && tables[0].errorCode;
        if (hasError) {
          const errCode = tables[0].errorCode ?? 0;
          const errMsg = tables[0].errorMsg ?? '';
          const errHint = this.getBitableErrorHint(errCode, errMsg, bitableInfo);
          this.logger.warn(
            `Bitable fetch failed: appToken=${bitableInfo.appToken.slice(0, 8)}... ` +
            `tableId=${bitableInfo.tableId ?? 'all'} [${errCode}] ${errMsg}`,
          );
          finalMarkdown = finalMarkdown.replaceAll(placeholder, errHint);
          bitableFail++;
        } else if (tables.length > 0 && tables[0].fields.length > 0) {
          const validTables = tables.filter((t) => t.fields.length > 0);
          const bitableMd = validTables.map((table) => {
            const header = `| ${table.fields.join(' | ')} |`;
            const separator = `| ${table.fields.map(() => '---').join(' | ')} |`;
            const rows = table.records.map((record) => {
              const cells = table.fields.map((field) => {
                const val = record[field];
                if (val === null || val === undefined) return '';
                if (typeof val === 'number' && BITABLE_DATE_TYPES.has(table.fieldTypes[field])) {
                  return dayjs(val).format('YYYY/MM/DD');
                }
                if (typeof val === 'object') return this.formatBitableCell(val);
                return String(val).replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
              });
              return `| ${cells.join(' | ')} |`;
            });
            return `**${table.name}**\n\n${header}\n${separator}\n${rows.join('\n')}`;
          }).join('\n\n');
          finalMarkdown = finalMarkdown.replaceAll(placeholder, bitableMd);
          bitableSuccess += validTables.length;
        } else {
          finalMarkdown = finalMarkdown.replaceAll(
            placeholder,
            '> [多维表格: 获取成功但无数据，可能表格为空或字段未返回]',
          );
          bitableFail++;
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        this.logger.warn(`Bitable fetch exception: appToken=${bitableInfo.appToken.slice(0, 8)}... ${e.message ?? 'unknown'}`);
        finalMarkdown = finalMarkdown.replaceAll(
          placeholder,
          `> [多维表格: 获取异常 — ${e.message ?? '未知错误'}]`,
        );
        bitableFail++;
      }
    }

    if (options?.downloadResources && options?.documentSlug) {
      const slug = options.documentSlug;
      const imageErrors = new Map<string, string>();
      const attachmentErrors = new Map<string, string>();

      for (const token of convertResult.imageTokens) {
        const relPath = `static/img/help-center/${slug}/${this.sanitizeFileName(token)}.png`;
        const absPath = path.resolve(options?.projectRoot || process.cwd(), relPath);
        if (fs.existsSync(absPath) && fs.statSync(absPath).size > 0) {
          const publicPath = '/' + relPath.replace(/^static\//, '');
          imagePathMap.set(token, publicPath);
          imgSuccess++;
          this.logger.log(`[图片复用] token=${token.slice(0, 12)}... 文件已存在，跳过下载`);
          continue;
        }
        if (fs.existsSync(absPath)) {
          this.logger.warn(`[图片重下] token=${token.slice(0, 12)}... 文件 0 字节，重新下载`);
        }
        const result = await this.feishuService.downloadMedia(token);
        if (result.buffer) {
          const localPath = this.saveResourceFile(result.buffer, relPath, options?.projectRoot);
          imagePathMap.set(token, localPath);
          imgSuccess++;
        } else {
          const errMsg = this.buildResourceErrorMessage(result);
          imageErrors.set(token, errMsg);
          imagePathMap.set(token, '');
          imgFail++;
        }
      }

      const pptxResults = new Map<string, { attName: string; attExt: string; pptxResult: PptxProcessResult; imgDir: string }>();

      for (const att of convertResult.attachmentTokens) {
        const relPath = `static/files/help-center/${slug}/${this.sanitizeFileName(att.name)}`;
        const absPath = path.resolve(options?.projectRoot || process.cwd(), relPath);
        const isPptx = att.ext === '.pptx';
        const isPpt = att.ext === '.ppt';
        let attBuffer: Buffer | null = null;

        if (fs.existsSync(absPath) && fs.statSync(absPath).size > 0) {
          const publicPath = '/' + relPath.replace(/^static\//, '');
          attachmentPathMap.set(att.token, publicPath);
          attSuccess++;
          this.logger.log(`[附件复用] token=${att.token.slice(0, 12)}... 文件已存在，跳过下载`);
          if (isPptx) {
            attBuffer = fs.readFileSync(absPath);
          }
        } else {
          if (fs.existsSync(absPath)) {
            this.logger.warn(`[附件重下] token=${att.token.slice(0, 12)}... 文件 0 字节，重新下载`);
          }
          const dlResult = await this.feishuService.downloadMedia(att.token);
          if (dlResult.buffer) {
            const localPath = this.saveResourceFile(dlResult.buffer, relPath, options?.projectRoot);
            attachmentPathMap.set(att.token, localPath);
            attSuccess++;
            attBuffer = dlResult.buffer;
          } else {
            const errMsg = this.buildResourceErrorMessage(dlResult);
            attachmentErrors.set(att.token, errMsg);
            attachmentPathMap.set(att.token, '');
            attFail++;
          }
        }

        if (attBuffer && isPptx) {
          const isPkHeader = attBuffer.length >= 2 && attBuffer[0] === 0x50 && attBuffer[1] === 0x4B;
          if (!isPkHeader) {
            this.logger.warn(`[PPTX异常] 文件头非 PK: ${att.name}, 头部=${attBuffer.slice(0, 4).toString('hex')}`);
          } else {
            const pptxResult = await processPptx(attBuffer);
            if (!pptxResult.skipped) {
              const imgDir = `static/img/help-center/${slug}/ppt-${this.sanitizeFileName(att.name)}`;
              for (const img of pptxResult.extractedImages) {
                const imgRelPath = `${imgDir}/${this.sanitizeFileName(img.fileName)}`;
                const imgAbsPath = path.resolve(options?.projectRoot || process.cwd(), imgRelPath);
                if (!fs.existsSync(imgAbsPath)) {
                  this.saveResourceFile(img.buffer, imgRelPath, options?.projectRoot);
                }
              }
              if (pptxResult.thumbnailBuffer) {
                const thumbRelPath = `${imgDir}/thumbnail.jpeg`;
                const thumbAbsPath = path.resolve(options?.projectRoot || process.cwd(), thumbRelPath);
                if (!fs.existsSync(thumbAbsPath)) {
                  this.saveResourceFile(pptxResult.thumbnailBuffer, thumbRelPath, options?.projectRoot);
                }
              }
              const downloadPath = attachmentPathMap.get(att.token) ?? '';
              const publicImgDir = '/' + imgDir.replace(/^static\//, '');
              const manifest = {
                originalFileName: att.name,
                displayName: att.name,
                storageFileName: this.sanitizeFileName(att.name),
                fileName: att.name,
                fileType: 'pptx',
                downloadUrl: downloadPath,
                fileUrl: downloadPath,
                thumbnailUrl: pptxResult.thumbnailBuffer ? `${publicImgDir}/thumbnail.jpeg` : null,
                slideCount: pptxResult.slideCount,
                mediaImages: pptxResult.extractedImages.map((img: { fileName: string }) =>
                  `${publicImgDir}/${this.sanitizeFileName(img.fileName)}`
                ),
                previewable: true,
              };
              const manifestRelPath = `${imgDir}/manifest.json`;
              this.saveResourceFile(Buffer.from(JSON.stringify(manifest)), manifestRelPath, options?.projectRoot);
              pptxResults.set(att.token, { attName: att.name, attExt: att.ext, pptxResult, imgDir });
            }
          }
        } else if (attBuffer && isPpt) {
          this.logger.log(`PPT 格式(.ppt)不支持文本提取，仅保存原始文件: ${att.name}`);
        }
      }

      finalMarkdown = replaceTokenPaths(
        finalMarkdown,
        new Map([...imagePathMap].filter(([, v]) => v !== '').map(([k, v]) => [k, v])),
        new Map([...attachmentPathMap].filter(([, v]) => v !== '').map(([k, v]) => [k, v])),
      );

      for (const [token] of imagePathMap) {
        const errMsg = imageErrors.get(token);
        if (errMsg) {
          finalMarkdown = finalMarkdown.replaceAll(
            `![图片](img_token_${token})`,
            errMsg,
          );
        }
      }
      for (const [token] of attachmentPathMap) {
        const errMsg = attachmentErrors.get(token);
        if (errMsg) {
          const attInfo = convertResult.attachmentTokens.find((a) => a.token === token);
          const name = attInfo?.name ?? '附件';
          finalMarkdown = finalMarkdown.replaceAll(
            `[${name}](att_token_${token})`,
            `[${name} ${errMsg}]`,
          );
        }
      }


    }

    const totalRes = convertResult.stats.images + convertResult.stats.attachments + convertResult.stats.bitables;
    if (totalRes > 0 || convertResult.stats.tables > 0) {
      this.logger.log(
        `Fetched feishu doc token=${docToken.slice(0, 12)}..., title=${meta.title}, blocks=${blocks.length}, ` +
        `images=${convertResult.stats.images}(ok=${imgSuccess},fail=${imgFail}), ` +
        `tables=${convertResult.stats.tables}, bitables=${convertResult.stats.bitables}(ok=${bitableSuccess},fail=${bitableFail}), ` +
        `attachments=${convertResult.stats.attachments}(ok=${attSuccess},fail=${attFail})`,
      );
    } else {
      this.logger.log(`Fetched feishu doc token=${docToken.slice(0, 12)}..., title=${meta.title}, blocks=${blocks.length}`);
    }

    convertResult.stats.images = imgSuccess + imgFail;
    convertResult.stats.bitables = bitableSuccess + bitableFail;
    const downloadStats = { imgSuccess, imgFail, attSuccess, attFail };
    return { markdown: finalMarkdown, title: meta.title, stats: convertResult.stats, downloadStats };
  }

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/[\x00-\x1f]/g, '')
      .slice(0, 100);
  }

  private formatBitableCell(val: unknown): string {
    if (Array.isArray(val)) {
      return val.map((v: unknown) => {
        if (typeof v === 'object' && v !== null) {
          const obj = v as Record<string, unknown>;
          return String(obj.text ?? obj.name ?? obj.value ?? JSON.stringify(obj));
        }
        return String(v);
      }).join(', ');
    }
    if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>;
      if (obj.text !== undefined) return String(obj.text);
      if (obj.link !== undefined) return `[${obj.text ?? 'link'}](${obj.link})`;
      return String(obj.text ?? obj.name ?? obj.value ?? JSON.stringify(val).slice(0, 50));
    }
    return String(val);
  }

  private getBitableErrorHint(code: number, msg: string, info: BitableInfo): string {
    if (code === 91402) {
      return `> [多维表格: 资源不存在(code=91402)，appToken=${info.appToken.slice(0, 8)}... tableId=${info.tableId ?? 'N/A'}，请检查表格是否已被删除或token是否正确]`;
    }
    if (code === 91403) {
      return `> [多维表格: 权限不足(code=91403)，请将应用添加为该多维表格的协作者]`;
    }
    if (code === 1254043) {
      return `> [多维表格: 内嵌表格不支持通过API读取(code=1254043)，请手动复制表格内容]`;
    }
    return `> [多维表格: 获取失败(code=${code}, msg=${msg})]`;
  }

  private getFileExtension(fileName: string): string {
    const dotIdx = fileName.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < fileName.length - 1) {
      return fileName.slice(dotIdx);
    }
    return '';
  }

  private buildResourceErrorMessage(result: DownloadResult): string {
    const status = result.statusCode;
    const code = result.apiCode;
    if (code === 99991672) {
      return '[资源下载失败: 权限 scope 缺失。请在飞书开放平台开通 drive:drive:readonly 权限并确保管理员已审批]';
    }
    if (status === 403 && code === undefined) {
      return '[资源下载失败: 资源级权限不足。drive:drive:readonly 已开通但应用无权访问该资源，请检查知识库成员角色的下载权限和文档协作者设置]';
    }
    if (code === 1770032 || code === 131006) {
      return '[资源下载失败: 文档/知识库权限不足。请在飞书中将应用添加为该文档的协作者（可阅读权限）]';
    }
    if (status === 404 || code === 1770002) {
      return '[资源下载失败: 资源不存在或token无效]';
    }
    if (code !== undefined) {
      return `[资源下载失败: 飞书API错误(code=${code}, ${result.apiMsg ?? ''})]`;
    }
    if (status) {
      return `[资源下载失败: HTTP ${status}]`;
    }
    return `[资源下载失败: ${result.error ?? '未知错误'}]`;
  }

  async checkDrivePermission(mappingId: string): Promise<DrivePermissionCheckResponse> {
    const mapping = await this.db
      .select()
      .from(feishuDocMappings)
      .where(eq(feishuDocMappings.id, mappingId))
      .limit(1);
    if (mapping.length === 0) throw new BadRequestException('映射不存在');
    const record = mapping[0];
    if (!record.feishuDocUrl) throw new BadRequestException('缺少飞书文档链接');

    const parsed = FeishuService.parseDocToken(record.feishuDocUrl);
    const docToken = parsed.isWiki
      ? await this.feishuService.resolveWikiToken(parsed.token)
      : parsed.token;

    const blocks = await this.feishuService.fetchDocumentBlocks(docToken);
    let testMediaToken: string | undefined;
    let testDriveToken: string | undefined;

    for (const block of blocks) {
      const b = block as Record<string, unknown>;
      const bt = (b.block_type as number) ?? 0;
      if (bt === 27 && !testMediaToken) {
        const img = b.image as Record<string, unknown> | undefined;
        const tok = img?.token as string | undefined;
        if (tok) testMediaToken = tok;
      }
      if ((bt === 26 || bt === 20 || bt === 23 || bt === 24) && !testDriveToken) {
        const fileObj = (b.file ?? b.file_view ?? b.view ?? b.drive) as Record<string, unknown> | undefined;
        const tok = fileObj?.token as string | undefined;
        if (tok) testDriveToken = tok;
      }
      if (testMediaToken && testDriveToken) break;
    }

    this.logger.log(
      `checkDrivePermission docToken=${docToken.slice(0, 12)}... mediaToken=${testMediaToken ? testMediaToken.slice(0, 8) + '...' : 'N/A'} driveToken=${testDriveToken ? testDriveToken.slice(0, 8) + '...' : 'N/A'}`,
    );

    return this.feishuService.checkDrivePermission(docToken, testMediaToken, testDriveToken);
  }

  async diagnoseBlocks(mappingId: string): Promise<import('@shared/api.interface').BlockDiagnosticResponse> {
    const mapping = await this.db
      .select()
      .from(feishuDocMappings)
      .where(eq(feishuDocMappings.id, mappingId))
      .limit(1);
    if (mapping.length === 0) throw new BadRequestException('映射不存在');
    const record = mapping[0];
    if (!record.feishuDocUrl) throw new BadRequestException('缺少飞书文档链接');

    const parsed = FeishuService.parseDocToken(record.feishuDocUrl);
    const docToken = parsed.isWiki
      ? await this.feishuService.resolveWikiToken(parsed.token)
      : parsed.token;

    const blocks = await this.feishuService.fetchDocumentBlocks(docToken);

    const BLOCK_TYPE_NAMES: Record<number, string> = {
      20: 'file_view', 23: 'file', 24: 'view', 26: 'audio', 27: 'image',
    };
    const targetTypes = new Set([20, 23, 24, 26, 27]);
    const items: import('@shared/api.interface').BlockDiagnosticItem[] = [];

    for (const block of blocks) {
      const b = block as Record<string, unknown>;
      const bt = (b.block_type as number) ?? 0;
      if (!targetTypes.has(bt)) continue;

      const fileObj = b.file as Record<string, unknown> | undefined;
      const fileViewObj = b.file_view as Record<string, unknown> | undefined;
      const viewObj = b.view as Record<string, unknown> | undefined;
      const driveObj = b.drive as Record<string, unknown> | undefined;
      const imageObj = b.image as Record<string, unknown> | undefined;

      let tokenSourceField = 'N/A';
      let tokenFieldName = 'N/A';
      let rawToken = '';
      let fileName = '';

      if (bt === 27 && imageObj?.token) {
        rawToken = imageObj.token as string;
        tokenSourceField = 'image';
        tokenFieldName = 'token';
        fileName = `image_${rawToken.slice(0, 8)}.png`;
      } else {
        const candidate = fileObj ?? fileViewObj ?? viewObj ?? driveObj;
        if (candidate?.token) {
          rawToken = candidate.token as string;
          tokenSourceField = fileObj ? 'file' : fileViewObj ? 'file_view' : viewObj ? 'view' : 'drive';
          tokenFieldName = 'token';
          fileName = (candidate.name as string) || (candidate.title as string) || '';
        }
      }

      const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
      const maskedToken = rawToken ? `${rawToken.slice(0, 4)}...${rawToken.slice(-4)}` : 'N/A';

      const mediasResult: { httpStatus: number; ok: boolean; detail: string } = { httpStatus: 0, ok: false, detail: '' };
      const filesResult: { httpStatus: number; ok: boolean; detail: string } = { httpStatus: 0, ok: false, detail: '' };

      if (rawToken) {
        const dlMedia = await this.feishuService.downloadMedia(rawToken);
        if (dlMedia.buffer) {
          mediasResult.ok = true;
          mediasResult.httpStatus = 200;
          mediasResult.detail = `成功，大小 ${dlMedia.buffer.length} bytes`;
        } else {
          mediasResult.ok = false;
          mediasResult.httpStatus = dlMedia.statusCode ?? 0;
          mediasResult.detail = dlMedia.error ?? '未知错误';
        }

        if (bt !== 27) {
          const dlFiles = await this.feishuService.downloadDriveFile(rawToken);
          if (dlFiles.buffer) {
            filesResult.ok = true;
            filesResult.httpStatus = 200;
            filesResult.detail = `成功，大小 ${dlFiles.buffer.length} bytes`;
          } else {
            filesResult.ok = false;
            filesResult.httpStatus = dlFiles.statusCode ?? 0;
            filesResult.detail = dlFiles.error ?? '未知错误';
          }
        } else {
          filesResult.detail = '图片类型，无需测试 files API';
        }
      }

      items.push({
        blockId: ((b.block_id as string) || '').slice(0, 8),
        blockType: bt,
        blockTypeName: BLOCK_TYPE_NAMES[bt] ?? `type_${bt}`,
        hasFile: !!fileObj,
        hasFileView: !!fileViewObj,
        hasView: !!viewObj,
        hasDrive: !!driveObj,
        hasImage: !!imageObj,
        tokenSourceField,
        tokenFieldName,
        maskedToken,
        fileName,
        extension: ext,
        downloadMediasResult: mediasResult,
        downloadFilesResult: filesResult,
      });
    }

    const attachmentItems = items.filter(i => i.blockType !== 27);
    const mediasOk = attachmentItems.length === 0 || attachmentItems.every(i => i.downloadMediasResult.ok);
    const filesOk = attachmentItems.length === 0 || attachmentItems.every(i => i.downloadFilesResult.ok);

    let conclusion: string;
    if (mediasOk && !filesOk) {
      conclusion = '附件 token 应使用 medias API（/drive/v1/medias/:token/download），files API 返回 403。当前代码已修复为统一使用 medias API。';
    } else if (mediasOk && filesOk) {
      conclusion = '两种 API 均可下载，建议使用 medias API（文档内嵌素材标准接口）。';
    } else if (!mediasOk) {
      conclusion = 'medias API 下载失败，请检查资源级权限（知识库安全设置 → 允许下载）。';
    } else {
      conclusion = '无附件 block 需要诊断。';
    }

    return { docToken: docToken.slice(0, 12) + '...', blocks: items, conclusion };
  }

  async retryResourceDownload(mappingId: string): Promise<RetryResourcesResponse> {
    const mapping = await this.db
      .select()
      .from(feishuDocMappings)
      .where(eq(feishuDocMappings.id, mappingId))
      .limit(1);
    if (mapping.length === 0) throw new BadRequestException('映射不存在');
    const record = mapping[0];
    if (!record.feishuDocUrl) throw new BadRequestException('缺少飞书文档链接');

    const projectRoot = await this.getProjectRoot();
    const documentSlug = path.basename(record.helpCenterFilePath ?? '', '.mdx') || record.helpCenterSlug || 'doc';

    const { markdown, stats, downloadStats } = await this.fetchFeishuDocMarkdown(record.feishuDocUrl, {
      documentSlug,
      downloadResources: true,
      projectRoot,
    });

    const frontmatter = generateFrontmatter(
      record.helpCenterTitle || '文档',
      1,
      undefined,
    );
    const fullContent = frontmatter + markdown;

    if (record.helpCenterFilePath) {
      this.writeMarkdownFile(fullContent, record.helpCenterFilePath, projectRoot);
    }

    if (record.targetDocumentId) {
      await this.db
        .update(docs)
        .set({
          markdownContent: fullContent,
          wordCount: this.calculateWordCount(markdown),
        })
        .where(eq(docs.id, record.targetDocumentId));
    }

    const { imgSuccess: imgOk, imgFail: imgFailCount, attSuccess: attOk, attFail: attFailCount } = downloadStats;

    this.logger.log(
      `retryResourceDownload id=${mappingId}: images=${stats.images}(ok=${imgOk}), attachments=${stats.attachments}(ok=${attOk})`,
    );

    return {
      success: imgFailCount === 0 && attFailCount === 0,
      imagesRetried: stats.images,
      imagesSuccess: imgOk,
      attachmentsRetried: stats.attachments,
      attachmentsSuccess: attOk,
      errorMessage: imgFailCount + attFailCount > 0
        ? `${imgFailCount} 个图片和 ${attFailCount} 个附件下载失败，请先通过「诊断权限」排查问题`
        : undefined,
    };
  }

  private saveResourceFile(buffer: Buffer, relativePath: string, projectRoot?: string): string {
    if (!buffer || buffer.length === 0) {
      this.logger.warn(`[资源跳过] 空文件未保存: ${relativePath}`);
      return '/' + relativePath.replace(/^static\//, '');
    }
    const absolutePath = path.resolve(projectRoot || process.cwd(), relativePath);
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absolutePath, buffer);
    const actualSize = fs.statSync(absolutePath).size;
    if (actualSize === 0) {
      this.logger.warn(`[资源异常] 写入后文件仍为 0 字节: ${relativePath}`);
    }
    const publicPath = '/' + relativePath.replace(/^static\//, '');
    return publicPath;
  }

  private writeMarkdownFile(content: string, relativePath: string, projectRoot?: string): string {
    const absolutePath = path.resolve(projectRoot || process.cwd(), relativePath);
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absolutePath, content, 'utf-8');
    return relativePath;
  }

  private writeCategoryJson(dirPath: string, label: string, position: number, projectRoot?: string): string {
    const root = projectRoot || process.cwd();
    const categoryFile = path.join(dirPath, '_category_.json');
    const absolutePath = path.resolve(root, categoryFile);
    if (!fs.existsSync(path.resolve(root, dirPath))) {
      fs.mkdirSync(path.resolve(root, dirPath), { recursive: true });
    }
    let data: Record<string, unknown> = { label, position };
    if (fs.existsSync(absolutePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
        data = { ...existing, label, position };
      } catch {
        data = { label, position };
      }
    }
    fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    return categoryFile;
  }

  private async writeCategoryFiles(
    firstCategoryId: string,
    secondCategoryId: string | undefined,
    language: string,
    docFilePath: string,
    projectRoot?: string,
  ): Promise<string[]> {
    const basePrefix = language === 'en'
      ? 'i18n/en/docusaurus-plugin-content-docs/current'
      : 'docs';
    const isEn = language === 'en';
    const filePathDir = path.dirname(docFilePath);
    const pathSegments = filePathDir.split('/').filter(Boolean);
    const firstSlug = pathSegments[pathSegments.length - 2] || '';
    const secondSlug = pathSegments[pathSegments.length - 1] || '';
    const writtenPaths: string[] = [];

    if (firstCategoryId) {
      const firstCat = await this.db
        .select({
          nameCn: categories.nameCn,
          nameEn: categories.nameEn,
          sortOrder: categories.sortOrder,
        })
        .from(categories)
        .where(eq(categories.id, firstCategoryId))
        .limit(1);

      if (firstCat.length > 0) {
        const cat = firstCat[0];
        const label = isEn ? (cat.nameEn || cat.nameCn) : cat.nameCn;
        const firstDir = path.join(basePrefix, firstSlug);
        const written = this.writeCategoryJson(firstDir, label, cat.sortOrder ?? 0, projectRoot);
        writtenPaths.push(written);
      }
    }

    if (secondCategoryId && secondSlug) {
      const secondCat = await this.db
        .select({
          nameCn: categories.nameCn,
          nameEn: categories.nameEn,
          sortOrder: categories.sortOrder,
        })
        .from(categories)
        .where(eq(categories.id, secondCategoryId))
        .limit(1);

      if (secondCat.length > 0) {
        const cat = secondCat[0];
        const label = isEn ? (cat.nameEn || cat.nameCn) : cat.nameCn;
        const secondDir = path.join(basePrefix, firstSlug, secondSlug);
        const written = this.writeCategoryJson(secondDir, label, cat.sortOrder ?? 0, projectRoot);
        writtenPaths.push(written);
      }
    }

    return writtenPaths;
  }

  private async buildHelpCenterPaths(
    firstCategoryId: string,
    secondCategoryId: string | undefined,
    slug: string,
    language: string = 'zh-CN',
  ): Promise<{ helpCenterUrl: string; helpCenterFilePath: string }> {
    const config = await this.systemConfigService.getConfig();
    const base = (config.productionUrl || '').replace(/\/+$/, '');
    let firstSlug = '';
    let secondSlug = '';

    if (firstCategoryId) {
      const firstCat = await this.db
        .select({ slugEn: categories.slugEn })
        .from(categories)
        .where(eq(categories.id, firstCategoryId))
        .limit(1);
      firstSlug = firstCat[0]?.slugEn ?? '';
    }
    if (secondCategoryId) {
      const secondCat = await this.db
        .select({ slugEn: categories.slugEn })
        .from(categories)
        .where(eq(categories.id, secondCategoryId))
        .limit(1);
      secondSlug = secondCat[0]?.slugEn ?? '';
    }

    const pathParts = [firstSlug, secondSlug, slug].filter(Boolean);
    const joined = pathParts.join('/');
    const helpCenterFilePath =
      language === 'en'
        ? `i18n/en/docusaurus-plugin-content-docs/current/${joined}.mdx`
        : `docs/${joined}.mdx`;
    const helpCenterUrl =
      language === 'en'
        ? `${base}/en/docs/${joined}`
        : `${base}/docs/${joined}`;

    return { helpCenterUrl, helpCenterFilePath };
  }

  private computeHelpCenterUrlFromFile(
    filePath: string,
    language: string,
    base: string,
    enI18nDocsDir: string,
    defaultDocsDir: string,
  ): string {
    if (!filePath) return '';
    const stripped = filePath.replace(/\.(mdx|md)$/, '');
    if (language === 'en') {
      const rel = stripped.replace(new RegExp(`^${enI18nDocsDir}`), '');
      return `${base}/en/${defaultDocsDir}${rel}`;
    }
    return `${base}/${stripped}`;
  }

  private async backfillHelpCenterUrls(): Promise<void> {
    const config = await this.systemConfigService.getConfig();
    if (!config.productionUrl) return;
    const base = config.productionUrl.replace(/\/+$/, '');
    const enI18nDocsDir = config.enI18nDocsDir || 'i18n/en/docusaurus-plugin-content-docs/current';
    const defaultDocsDir = config.defaultDocsDir || 'docs';

    const rows = await this.db
      .select({
        id: feishuDocMappings.id,
        helpCenterFilePath: feishuDocMappings.helpCenterFilePath,
        helpCenterUrl: feishuDocMappings.helpCenterUrl,
        language: feishuDocMappings.language,
        targetDocumentId: feishuDocMappings.targetDocumentId,
      })
      .from(feishuDocMappings);

    let mappingUpdated = 0;
    let docsUpdated = 0;

    for (const row of rows) {
      if (!row.helpCenterFilePath) continue;
      const correctUrl = this.computeHelpCenterUrlFromFile(
        row.helpCenterFilePath,
        row.language ?? 'zh-CN',
        base,
        enI18nDocsDir,
        defaultDocsDir,
      );
      if (!correctUrl || correctUrl === row.helpCenterUrl) continue;

      await this.db
        .update(feishuDocMappings)
        .set({ helpCenterUrl: correctUrl })
        .where(eq(feishuDocMappings.id, row.id));
      mappingUpdated++;

      if (row.targetDocumentId) {
        await this.db
          .update(docs)
          .set({ helpCenterUrl: correctUrl })
          .where(eq(docs.id, row.targetDocumentId));
        docsUpdated++;
      }
    }

    this.logger.log(
      `Backfilled helpCenterUrl: ${mappingUpdated} mappings, ${docsUpdated} docs updated`,
    );
  }

  // ========== Wiki Knowledge Base Import ==========

  private generateSlug(title: string): string {
    const base = title
      .toLowerCase()
      .replace(/[\u4e00-\u9fff]/g, (ch: string) => ch)
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      || 'doc';
    const suffix = Math.random().toString(36).substring(2, 6);
    return `${base}-${suffix}`;
  }

  async wikiDiagnose(wikiUrl: string): Promise<WikiDiagnoseResponse> {
    return this.feishuService.diagnoseWikiAccess(wikiUrl);
  }

  async wikiListSpaces(): Promise<import('@shared/api.interface').WikiListSpacesResponse> {
    return this.feishuService.listSpaces();
  }

  async wikiPreviewTree(wikiUrl: string): Promise<WikiPreviewTreeResponse> {
    const parsed = this.feishuService.parseWikiUrl(wikiUrl);
    let spaceId = '';
    let spaceName = '';
    let rootNodeToken = '';
    let host = parsed.host;

    if (parsed.type === 'node' && parsed.nodeToken) {
      rootNodeToken = parsed.nodeToken;
      try {
        const info = await this.feishuService.getWikiSpaceInfo(parsed.nodeToken);
        spaceId = info.spaceId;
        spaceName = info.spaceName;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误';
        throw new BadRequestException(`知识库节点解析失败: ${msg}`);
      }
    } else if (parsed.type === 'space' && parsed.spaceId) {
      spaceId = parsed.spaceId;
    } else {
      throw new BadRequestException('无法解析知识库链接');
    }

    if (!host) host = 'feishu.cn';

    const { tree, truncated, totalNodes } = await this.feishuService.listWikiTree(
      spaceId,
      rootNodeToken || undefined,
      5,
      200,
      host,
    );

    this.logger.log(`wikiPreviewTree: spaceId=${spaceId}, root=${rootNodeToken || 'all'}, nodes=${totalNodes}, truncated=${truncated}`);

    const existingUrls = new Set<string>();
    const existingTokens = new Set<string>();
    const allMappings = await this.db
      .select({
        feishuDocUrl: feishuDocMappings.feishuDocUrl,
        feishuDocToken: feishuDocMappings.feishuDocToken,
      })
      .from(feishuDocMappings);
    for (const m of allMappings) {
      if (m.feishuDocUrl) existingUrls.add(m.feishuDocUrl);
      if (m.feishuDocToken) existingTokens.add(m.feishuDocToken);
    }

    let totalDocCount = 0;
    let existingMappingCount = 0;

    const markExisting = (nodes: WikiTreeNodeItem[]): void => {
      for (const node of nodes) {
        if (node.nodeType === 'docx') {
          totalDocCount++;
          if (existingUrls.has(node.wikiUrl) || existingTokens.has(node.objToken)) {
            node.existingMapping = true;
            existingMappingCount++;
          }
        }
        if (node.children.length > 0) markExisting(node.children);
      }
    };
    markExisting(tree);

    return {
      spaceId,
      spaceName,
      rootNodeToken,
      tree,
      totalDocCount,
      existingMappingCount,
      importableCount: totalDocCount - existingMappingCount,
      truncated,
    };
  }

  async wikiImport(
    body: WikiImportRequest,
    userId: string,
  ): Promise<WikiImportResponse> {
    const { selectedNodes, targetFirstCategory, targetSecondCategory, owner, language, syncMode, syncAfterCreate } = body;

    if (!selectedNodes || selectedNodes.length === 0) {
      throw new BadRequestException('未选择任何文档');
    }

    const existingUrls = new Set<string>();
    const existingTokens = new Set<string>();
    const allMappings = await this.db
      .select({
        feishuDocUrl: feishuDocMappings.feishuDocUrl,
        feishuDocToken: feishuDocMappings.feishuDocToken,
      })
      .from(feishuDocMappings);
    for (const m of allMappings) {
      if (m.feishuDocUrl) existingUrls.add(m.feishuDocUrl);
      if (m.feishuDocToken) existingTokens.add(m.feishuDocToken);
    }

    const usedSlugByLang = new Map<string, Set<string>>();
    const slugRows = await this.db
      .select({ helpCenterSlug: feishuDocMappings.helpCenterSlug, language: feishuDocMappings.language })
      .from(feishuDocMappings);
    for (const row of slugRows) {
      if (row.helpCenterSlug && row.language) {
        const langKey = `${row.language}:${row.helpCenterSlug}`;
        if (!usedSlugByLang.has(row.language)) usedSlugByLang.set(row.language, new Set());
        usedSlugByLang.get(row.language)!.add(langKey);
      }
    }

    const items: WikiImportResultItem[] = [];
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (const node of selectedNodes) {
      if (existingUrls.has(node.wikiUrl) || existingTokens.has(node.objToken)) {
        skipCount++;
        items.push({
          title: node.title,
          wikiUrl: node.wikiUrl,
          status: 'skipped',
          reason: '已存在相同映射',
        });
        continue;
      }

      const nodeLang = node.language || language;
      const nodeFirstCat = node.targetFirstCategory || targetFirstCategory;
      const nodeSecondCat = node.targetSecondCategory || targetSecondCategory;
      const nodeOwner = node.owner || owner || userId;
      const nodeSyncMode = node.syncMode || syncMode || '手动同步';
      const nodeHelpTitle = node.helpCenterTitle || node.title;

      let slug = node.helpCenterSlug || this.generateSlug(node.title);
      let attempts = 0;
      const langSlugs = usedSlugByLang.get(nodeLang) || new Set<string>();
      while (langSlugs.has(`${nodeLang}:${slug}`) && attempts < 10) {
        attempts++;
        slug = `${node.helpCenterSlug || this.generateSlug(node.title)}-${attempts}`;
      }
      const langKey = `${nodeLang}:${slug}`;
      if (!usedSlugByLang.has(nodeLang)) usedSlugByLang.set(nodeLang, new Set());
      usedSlugByLang.get(nodeLang)!.add(langKey);

      try {
        const createReq: CreateFeishuMappingRequest = {
          feishuDocUrl: node.wikiUrl,
          feishuDocTitle: node.title,
          feishuDocToken: node.objToken,
          targetFirstCategory: nodeFirstCat,
          targetSecondCategory: nodeSecondCat || undefined,
          helpCenterTitle: nodeHelpTitle,
          helpCenterSlug: slug,
          language: nodeLang,
          owner: nodeOwner,
          syncMode: nodeSyncMode,
          enabled: true,
          syncAfterSave: false,
        };

        const result = await this.create(createReq, userId);
        successCount++;

        let reason: string | undefined;
        if (syncAfterCreate && result.id) {
          try {
            await this.syncOne(result.id, userId);
            reason = '已同步为草稿';
          } catch (syncErr: unknown) {
            const syncMsg = syncErr instanceof Error ? syncErr.message : '同步失败';
            reason = `映射创建成功，但同步失败: ${syncMsg}`;
          }
        }

        items.push({
          title: node.title,
          wikiUrl: node.wikiUrl,
          status: 'success',
          mappingId: result.id,
          reason,
        });
      } catch (err: unknown) {
        failCount++;
        const msg = err instanceof Error ? err.message : '未知错误';
        items.push({
          title: node.title,
          wikiUrl: node.wikiUrl,
          status: 'failed',
          reason: msg,
        });
      }
    }

    this.logger.log(
      `wikiImport completed: total=${selectedNodes.length}, success=${successCount}, failed=${failCount}, skipped=${skipCount}`,
    );

    return {
      totalCount: selectedNodes.length,
      successCount,
      failCount,
      skipCount,
      items,
    };
  }

  async repairMissingImages(mappingIds: string[]): Promise<ResourceRepairResult[]> {
    const results: ResourceRepairResult[] = [];
    const projectRoot = await this.getProjectRoot();
    const allowedBase = path.resolve(projectRoot, 'static/img/help-center');

    for (const mappingId of mappingIds) {
      const mapping = await this.db
        .select()
        .from(feishuDocMappings)
        .where(eq(feishuDocMappings.id, mappingId))
        .limit(1);
      if (mapping.length === 0) {
        this.logger.warn(`[repairMissingImages] mapping not found: ${mappingId}`);
        continue;
      }
      const record = mapping[0];
      if (!record.targetDocumentId) {
        this.logger.warn(`[repairMissingImages] no targetDocumentId for mapping: ${mappingId}`);
        continue;
      }

      const docRows = await this.db
        .select()
        .from(docs)
        .where(eq(docs.id, record.targetDocumentId))
        .limit(1);
      if (docRows.length === 0) {
        this.logger.warn(`[repairMissingImages] doc not found: ${record.targetDocumentId}`);
        continue;
      }
      const doc = docRows[0];
      const md = doc.markdownContent || '';

      const imgRegex = /!\[[^\]]*\]\((\/img\/help-center\/[^)]+)\)/g;
      const htmlImgRegex = /<img\s[^>]*src=["'](\/img\/help-center\/[^"']+)["'][^>]*>/gi;
      const missingImages: string[] = [];

      let match: RegExpExecArray | null;
      while ((match = imgRegex.exec(md)) !== null) {
        const fullPath = match[1];
        const absPath = path.resolve(projectRoot, 'static' + fullPath);
        if (!fs.existsSync(absPath) || fs.statSync(absPath).size === 0) {
          missingImages.push(fullPath);
        }
      }
      while ((match = htmlImgRegex.exec(md)) !== null) {
        const fullPath = match[1];
        const absPath = path.resolve(projectRoot, 'static' + fullPath);
        if (!fs.existsSync(absPath) || fs.statSync(absPath).size === 0) {
          if (!missingImages.includes(fullPath)) {
            missingImages.push(fullPath);
          }
        }
      }

      if (missingImages.length === 0) {
        this.logger.log(`[repairMissingImages] no missing images for doc: ${doc.title}`);
        results.push({
          mappingId,
          docTitle: doc.title,
          docId: doc.id,
          totalMissing: 0,
          repaired: 0,
          failed: 0,
          resourceStatusAfter: '正常',
          remainingIssues: 0,
          items: [],
        });
        continue;
      }

      const tokenMap = new Map<string, { token: string; source: 'feishu_source' | 'filename_fallback' }>();
      let feishuParseOk = false;

      try {
        if (record.feishuDocUrl) {
          const parsed = FeishuService.parseDocToken(record.feishuDocUrl);
          const docToken = parsed.isWiki
            ? await this.feishuService.resolveWikiToken(parsed.token)
            : parsed.token;
          const blocks = await this.feishuService.fetchDocumentBlocks(docToken);
          const convertResult = convertBlocksToMarkdown(blocks, undefined, { skipResources: false });
          const slug = path.basename(record.helpCenterFilePath ?? '', '.mdx') || record.helpCenterSlug || 'doc';

          for (const token of convertResult.imageTokens) {
            const expectedPath = `/img/help-center/${slug}/${this.sanitizeFileName(token)}.png`;
            tokenMap.set(expectedPath, { token, source: 'feishu_source' });
          }
          feishuParseOk = true;
          this.logger.log(`[repairMissingImages] feishu re-parse ok for doc: ${doc.title}, found ${convertResult.imageTokens.length} image tokens`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'unknown';
        this.logger.warn(`[repairMissingImages] feishu re-parse failed for doc: ${doc.title}, falling back to filename: ${errMsg}`);
      }

      const items: ResourceRepairItem[] = [];

      for (const missingPath of missingImages) {
        const fileName = path.basename(missingPath, '.png');
        let tokenEntry = tokenMap.get(missingPath);
        let token: string;
        let tokenSource: 'feishu_source' | 'filename_fallback';

        if (tokenEntry) {
          token = tokenEntry.token;
          tokenSource = tokenEntry.source;
        } else {
          token = fileName;
          tokenSource = 'filename_fallback';
          if (feishuParseOk) {
            this.logger.warn(`[repairMissingImages] token not found in feishu re-parse for path: ${missingPath}, using filename fallback`);
          }
        }

        const relPath = 'static' + missingPath;
        const absPath = path.resolve(projectRoot, relPath);

        if (!absPath.startsWith(allowedBase + path.sep) && absPath !== allowedBase) {
          this.logger.error(`[repairMissingImages] path safety check failed: ${missingPath}`);
          items.push({
            token,
            targetPath: missingPath,
            success: false,
            tokenSource,
            errorReason: '路径安全校验失败: 目标路径超出允许目录',
          });
          continue;
        }

        try {
          const result = await this.feishuService.downloadMedia(token);
          if (!result.buffer || result.buffer.length === 0) {
            const errMsg = this.buildResourceErrorMessage(result);
            this.logger.warn(`[repairMissingImages] download failed token=${token} source=${tokenSource} doc=${doc.title}: ${errMsg}`);
            items.push({
              token,
              targetPath: missingPath,
              success: false,
              tokenSource,
              errorReason: errMsg,
            });
            continue;
          }

          if (result.buffer.length < 8 || result.buffer[0] !== 0x89 || result.buffer[1] !== 0x50) {
            if (!result.buffer.slice(0, 4).toString().includes('{')) {
              this.logger.warn(`[repairMissingImages] downloaded file may not be valid PNG: token=${token}, size=${result.buffer.length}`);
            }
          }

          this.saveResourceFile(result.buffer, relPath, projectRoot);
          this.logger.log(`[repairMissingImages] repaired: token=${token} source=${tokenSource} path=${missingPath} size=${result.buffer.length}`);
          items.push({
            token,
            targetPath: missingPath,
            success: true,
            tokenSource,
            fileSize: result.buffer.length,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : '未知错误';
          this.logger.error(`[repairMissingImages] unexpected error token=${token} source=${tokenSource} doc=${doc.title}: ${errMsg}`);
          items.push({
            token,
            targetPath: missingPath,
            success: false,
            tokenSource,
            errorReason: errMsg,
          });
        }
      }

      const repaired = items.filter(i => i.success).length;
      const failed = items.filter(i => !i.success).length;

      let remainingMissingImages = 0;
      let remainingZeroByte = 0;
      const allImgRegex = /!\[[^\]]*\]\((\/img\/help-center\/[^)]+)\)/g;
      const allHtmlImgRegex = /<img\s[^>]*src=["'](\/img\/help-center\/[^"']+)["'][^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = allImgRegex.exec(md)) !== null) {
        const fp = path.resolve(projectRoot, 'static' + m[1]);
        if (!fs.existsSync(fp)) { remainingMissingImages++; continue; }
        if (fs.statSync(fp).size === 0) remainingZeroByte++;
      }
      while ((m = allHtmlImgRegex.exec(md)) !== null) {
        const fp = path.resolve(projectRoot, 'static' + m[1]);
        if (!fs.existsSync(fp)) { remainingMissingImages++; continue; }
        if (fs.statSync(fp).size === 0) remainingZeroByte++;
      }

      const allAttRegex = /\[[^\]]*\]\((\/files\/help-center\/[^)]+)\)/g;
      while ((m = allAttRegex.exec(md)) !== null) {
        const fp = path.resolve(projectRoot, 'static' + m[1]);
        if (!fs.existsSync(fp)) { remainingZeroByte++; continue; }
        if (fs.statSync(fp).size === 0) remainingZeroByte++;
      }

      const remainingIssues = remainingMissingImages + remainingZeroByte;
      const resourceStatusAfter = remainingIssues === 0 ? '正常' as const : '异常' as const;

      await this.db
        .update(docs)
        .set({
          resourceStatus: resourceStatusAfter,
          missingImagesCount: remainingMissingImages,
          zeroByteAttachmentsCount: remainingZeroByte,
          lastResourceCheckedAt: new Date(),
        })
        .where(eq(docs.id, doc.id));

      const logSummary = items.map(i =>
        `${i.success ? '✓' : '✗'} ${i.targetPath} [${i.tokenSource}] ${i.success ? `size=${i.fileSize}` : i.errorReason}`
      ).join('\n');

      await this.db
        .insert(feishuSyncTasks)
        .values({
          mappingId,
          syncType: '资源修复',
          status: failed === 0 ? '成功' : '部分成功',
          errorMessage: `修复 ${repaired}/${items.length} 张图片\n${logSummary}`,
          finishedAt: new Date(),
        });

      this.logger.log(
        `[repairMissingImages] doc=${doc.title} total=${missingImages.length} repaired=${repaired} failed=${failed} statusAfter=${resourceStatusAfter} remaining=${remainingIssues}`,
      );

      results.push({
        mappingId,
        docTitle: doc.title,
        docId: doc.id,
        totalMissing: missingImages.length,
        repaired,
        failed,
        resourceStatusAfter,
        remainingIssues,
        items,
      });
    }

    return results;
  }
}
