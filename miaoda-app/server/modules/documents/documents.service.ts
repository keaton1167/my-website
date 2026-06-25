import { Injectable, Logger, Inject, HttpStatus } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, or, desc, sql, count, like, ne, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { docs, categories, systemConfig } from '@server/database/schema';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import { ResponseCode } from '@server/common/constants/api_response_code';
import type {
  DocItem,
  DocDetailResponse,
  DocStatistics,
  DocListResponse,
  DocListParams,
  CreateDocRequest,
  UpdateDocRequest,
  MoveDocRequest,
  BatchActionResponse,
  BatchActionRequest,
  SuccessResponse,
  CreateResponse,
  Language,
  TranslationStatus,
} from '@shared/api.interface';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async backfillTranslationGroups(): Promise<void> {
    try {
      const nullRows = await this.db
        .select({ id: docs.id })
        .from(docs)
        .where(isNull(docs.translationGroupId));
      if (nullRows.length === 0) return;
      for (const row of nullRows) {
        await this.db
          .update(docs)
          .set({ translationGroupId: randomUUID() })
          .where(eq(docs.id, row.id));
      }
      this.logger.log(`Backfilled translationGroupId for ${nullRows.length} docs`);
    } catch (e: unknown) {
      this.logger.log(`backfillTranslationGroups error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async getStatistics(): Promise<DocStatistics> {
    const [totalResult, draftResult, noContentResult, pendingReviewResult, pendingPublishResult, publishedResult, failedImportResult, resourceErrorResult] =
      await Promise.all([
        this.db.select({ count: count() }).from(docs),
        this.db
          .select({ count: count() })
          .from(docs)
          .where(eq(docs.publishStatus, '草稿')),
        this.db
          .select({ count: count() })
          .from(docs)
          .where(eq(docs.contentStatus, '无正文')),
        this.db
          .select({ count: count() })
          .from(docs)
          .where(eq(docs.publishStatus, '待审核')),
        this.db
          .select({ count: count() })
          .from(docs)
          .where(eq(docs.publishStatus, '待发布')),
        this.db
          .select({ count: count() })
          .from(docs)
          .where(eq(docs.publishStatus, '已发布')),
        this.db
          .select({ count: count() })
          .from(docs)
          .where(
            and(
              eq(docs.sourceType, '飞书导入'),
              eq(docs.contentStatus, '转换失败'),
            ),
          ),
        this.db
          .select({ count: count() })
          .from(docs)
          .where(eq(docs.resourceStatus, '异常')),
      ]);

    const failedImportRaw = parseInt(
      String(failedImportResult[0]?.count ?? '0'),
      10,
    );
    const resourceErrorCount = parseInt(
      String(resourceErrorResult[0]?.count ?? '0'),
      10,
    );

    return {
      totalDocs: parseInt(String(totalResult[0]?.count ?? '0'), 10),
      draftCount: parseInt(String(draftResult[0]?.count ?? '0'), 10),
      noContentCount: parseInt(
        String(noContentResult[0]?.count ?? '0'),
        10,
      ),
      pendingReviewCount: parseInt(
        String(pendingReviewResult[0]?.count ?? '0'),
        10,
      ),
      pendingPublishCount: parseInt(
        String(pendingPublishResult[0]?.count ?? '0'),
        10,
      ),
      publishedCount: parseInt(
        String(publishedResult[0]?.count ?? '0'),
        10,
      ),
      failedImportCount: failedImportRaw + resourceErrorCount,
      resourceErrorCount,
    };
  }

  async getList(params: DocListParams): Promise<DocListResponse> {
    const {
      firstCategory,
      secondCategory,
      publishStatus,
      contentStatus,
      language,
      owner,
      keyword,
      translationStatus,
      page = 1,
      pageSize = 20,
    } = params;

    const conditions = [];
    if (firstCategory) {
      const catRow = await this.db
        .select({ nameCn: categories.nameCn })
        .from(categories)
        .where(eq(categories.id, firstCategory))
        .limit(1);
      const catName = catRow[0]?.nameCn;
      conditions.push(
        catName
          ? or(eq(docs.firstCategory, firstCategory), eq(docs.firstCategory, catName))!
          : eq(docs.firstCategory, firstCategory),
      );
    }
    if (secondCategory) {
      const catRow = await this.db
        .select({ nameCn: categories.nameCn })
        .from(categories)
        .where(eq(categories.id, secondCategory))
        .limit(1);
      const catName = catRow[0]?.nameCn;
      conditions.push(
        catName
          ? or(eq(docs.secondCategory, secondCategory), eq(docs.secondCategory, catName))!
          : eq(docs.secondCategory, secondCategory),
      );
    }
    if (publishStatus) conditions.push(eq(docs.publishStatus, publishStatus));
    if (contentStatus) conditions.push(eq(docs.contentStatus, contentStatus));
    if (translationStatus === '仅中文') {
      conditions.push(eq(docs.language, 'zh-CN'));
      conditions.push(sql`NOT EXISTS (SELECT 1 FROM docs e WHERE e.translation_group_id = ${docs.translationGroupId} AND e.language = 'en')`);
    } else if (translationStatus === '仅英文') {
      conditions.push(eq(docs.language, 'en'));
      conditions.push(sql`NOT EXISTS (SELECT 1 FROM docs z WHERE z.translation_group_id = ${docs.translationGroupId} AND z.language = 'zh-CN')`);
    } else if (translationStatus === '中英文完整' || translationStatus === '英文待更新') {
      conditions.push(sql`${docs.translationGroupId} IS NOT NULL`);
    } else if (language) {
      conditions.push(eq(docs.language, language));
    }
    if (keyword) {
      conditions.push(
        or(like(docs.title, `%${keyword}%`), like(docs.summary, `%${keyword}%`))!,
      );
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    // owner filter uses raw SQL because owner is user_profile type
    const ownerCondition = owner
      ? sql`(owner).user_id = ${owner}`
      : undefined;

    const finalWhere =
      whereClause && ownerCondition
        ? and(whereClause, ownerCondition)
        : whereClause ?? ownerCondition ?? undefined;

    const offset = (page - 1) * pageSize;

    const [items, totalResult] = await Promise.all([
      finalWhere
        ? this.db
            .select()
            .from(docs)
            .where(finalWhere)
            .orderBy(desc(docs.updatedAt))
            .limit(pageSize)
            .offset(offset)
        : this.db
            .select()
            .from(docs)
            .orderBy(desc(docs.updatedAt))
            .limit(pageSize)
            .offset(offset),
      finalWhere
        ? this.db.select({ count: count() }).from(docs).where(finalWhere)
        : this.db.select({ count: count() }).from(docs),
    ]);

    const total = parseInt(String(totalResult[0]?.count ?? '0'), 10);
    const docItems: DocItem[] = items.map(
      (item: typeof docs.$inferSelect): DocItem => ({
        id: item.id,
        title: item.title,
        summary: item.summary ?? '',
        firstCategory: item.firstCategory ?? '',
        secondCategory: item.secondCategory ?? '',
        slug: item.slug ?? '',
        filePath: item.filePath ?? '',
        helpCenterUrl: item.helpCenterUrl ?? '',
        language: (item.language as Language) ?? 'zh-CN',
        translationGroupId: item.translationGroupId ?? null,
        contentStatus: (item.contentStatus as DocItem['contentStatus']) ?? '无正文',
        publishStatus: (item.publishStatus as DocItem['publishStatus']) ?? '草稿',
        owner: item.owner ?? '',
        lastPublisher: item.lastPublisher ?? '',
        wordCount: item.wordCount ?? 0,
        sourceType: (item.sourceType as DocItem['sourceType']) ?? '手动创建',
        sourceUrl: item.sourceUrl ?? '',
        updatedAt: item.updatedAt?.toISOString() ?? '',
        publishedAt: item.publishedAt?.toISOString() ?? '',
      }),
    );

    await this.attachTranslationStatus(docItems);

    if (translationStatus === '中英文完整' || translationStatus === '英文待更新') {
      const filtered = docItems.filter((d: DocItem) => d.translationStatus === translationStatus);
      const manualOffset = (page - 1) * pageSize;
      return { items: filtered.slice(manualOffset, manualOffset + pageSize), total: filtered.length };
    }

    return { items: docItems, total };
  }

  async create(
    body: CreateDocRequest,
    userId: string,
  ): Promise<CreateResponse> {
    const filePath = await this.buildFilePath(
      body.firstCategory,
      body.secondCategory,
      body.slug,
      body.language,
    );
    const helpCenterUrl = filePath
      ? await this.buildHelpCenterUrl(filePath, body.language, body.translationGroupId || null)
      : '';
    const wordCount = this.calculateWordCount(body.markdownContent);

    const contentStatus = body.markdownContent ? '有正文' : '无正文';

    await this.validatePathUniqueness(body.language, filePath);

    const translationGroupId = body.translationGroupId || randomUUID();

    if (body.translationGroupId) {
      await this.validateGroupLanguageUnique(body.translationGroupId, body.language);
    }

    const result = await this.db
      .insert(docs)
      .values({
        title: body.title,
        summary: body.summary || null,
        firstCategory: body.firstCategory || null,
        secondCategory: body.secondCategory || null,
        slug: body.slug,
        language: body.language,
        filePath,
        helpCenterUrl,
        markdownContent: body.markdownContent || null,
        contentStatus,
        publishStatus: '草稿',
        owner: body.owner || userId || undefined,
        wordCount,
        sourceType: body.sourceType || '手动创建',
        sourceUrl: body.sourceUrl || null,
        translationGroupId,
        createdBy: userId || undefined,
        updatedBy: userId || undefined,
      })
      .returning({ id: docs.id });

    this.logger.log(`Created doc id=${result[0]?.id}`);
    return { id: result[0]?.id ?? '' };
  }

  async update(
    id: string,
    body: UpdateDocRequest,
    userId: string,
  ): Promise<SuccessResponse> {
    const CONTENT_FIELDS = ['title', 'firstCategory', 'secondCategory', 'slug', 'markdownContent'] as const;
    const hasContentChange = CONTENT_FIELDS.some((f) => body[f] !== undefined);

    let existingDoc: typeof docs.$inferSelect | null = null;
    if (hasContentChange) {
      const rows = await this.db.select().from(docs).where(eq(docs.id, id)).limit(1);
      existingDoc = rows[0] ?? null;
      if (existingDoc && (existingDoc.publishStatus === '待发布' || existingDoc.publishStatus === '已发布')) {
        // editing content-affecting fields resets status to draft
      }
    }

    const updateValues: Record<string, unknown> = {
      updatedBy: userId || undefined,
      updatedAt: new Date(),
    };

    if (existingDoc && (existingDoc.publishStatus === '待发布' || existingDoc.publishStatus === '已发布')) {
      updateValues.publishStatus = '草稿';
    }

    if (body.title !== undefined) updateValues.title = body.title;
    if (body.summary !== undefined) updateValues.summary = body.summary;
    if (body.firstCategory !== undefined)
      updateValues.firstCategory = body.firstCategory;
    if (body.secondCategory !== undefined)
      updateValues.secondCategory = body.secondCategory;
    if (body.slug !== undefined) updateValues.slug = body.slug;
    if (body.owner !== undefined) updateValues.owner = body.owner;
    if (body.publishStatus !== undefined)
      updateValues.publishStatus = body.publishStatus;

    if (body.markdownContent !== undefined) {
      updateValues.markdownContent = body.markdownContent;
      updateValues.wordCount = this.calculateWordCount(body.markdownContent);
      updateValues.contentStatus = body.markdownContent ? '有正文' : '无正文';
    }

    // Recalculate filePath if category or slug changed
    if (
      body.firstCategory !== undefined ||
      body.secondCategory !== undefined ||
      body.slug !== undefined
    ) {
      if (!existingDoc) {
        const rows = await this.db.select().from(docs).where(eq(docs.id, id)).limit(1);
        existingDoc = rows[0] ?? null;
      }
      if (existingDoc) {
        const firstCat: string =
          body.firstCategory ?? existingDoc.firstCategory ?? '';
        const secondCat: string =
          body.secondCategory ?? existingDoc.secondCategory ?? '';
        const slug: string = body.slug ?? existingDoc.slug ?? '';
        const lang: Language = (existingDoc.language as Language) ?? 'zh-CN';
        const newFilePath = await this.buildFilePath(
          firstCat,
          secondCat,
          slug,
          lang,
        );
        updateValues.filePath = newFilePath;
        updateValues.helpCenterUrl = newFilePath
          ? await this.buildHelpCenterUrl(newFilePath, lang, existingDoc.translationGroupId)
          : '';
        await this.validatePathUniqueness(lang, newFilePath, id);
      }
    }

    await this.db
      .update(docs)
      .set(updateValues)
      .where(eq(docs.id, id));

    return { success: true };
  }

  async submitReview(id: string, userId: string): Promise<SuccessResponse> {
    const existing = await this.db
      .select({ publishStatus: docs.publishStatus, contentStatus: docs.contentStatus })
      .from(docs)
      .where(eq(docs.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new BusinessException(
        ResponseCode.NOT_FOUND,
        '文档不存在',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing[0].publishStatus !== '草稿') {
      throw new BusinessException(
        ResponseCode.BUSINESS_ERROR,
        '只有草稿状态的文档可以提交审核',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (existing[0].contentStatus === '无正文') {
      throw new BusinessException(
        ResponseCode.BUSINESS_ERROR,
        '请先补充正文后再提交审核',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.db
      .update(docs)
      .set({
        publishStatus: '待审核',
        updatedBy: userId || undefined,
      })
      .where(eq(docs.id, id));

    return { success: true };
  }

  async approve(id: string, userId: string): Promise<SuccessResponse> {
    const existing = await this.db
      .select({ publishStatus: docs.publishStatus })
      .from(docs)
      .where(eq(docs.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new BusinessException(
        ResponseCode.NOT_FOUND,
        '文档不存在',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing[0].publishStatus !== '待审核') {
      throw new BusinessException(
        ResponseCode.BUSINESS_ERROR,
        '只有待审核状态的文档可以审核通过',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.db
      .update(docs)
      .set({
        publishStatus: '待发布',
        updatedBy: userId || undefined,
      })
      .where(eq(docs.id, id));

    return { success: true };
  }

  async archive(id: string, userId: string): Promise<SuccessResponse> {
    const existing = await this.db
      .select({ publishStatus: docs.publishStatus })
      .from(docs)
      .where(eq(docs.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new BusinessException(
        ResponseCode.NOT_FOUND,
        '文档不存在',
        HttpStatus.NOT_FOUND,
      );
    }

    const currentStatus = existing[0].publishStatus;
    if (currentStatus !== '待发布' && currentStatus !== '已发布') {
      throw new BusinessException(
        ResponseCode.BUSINESS_ERROR,
        '只有待发布或已发布状态的文档可以归档',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.db
      .update(docs)
      .set({
        publishStatus: '已归档',
        updatedBy: userId || undefined,
      })
      .where(eq(docs.id, id));

    return { success: true };
  }

  async reject(id: string, userId: string): Promise<SuccessResponse> {
    const existing = await this.db
      .select({ publishStatus: docs.publishStatus })
      .from(docs)
      .where(eq(docs.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new BusinessException(
        ResponseCode.NOT_FOUND,
        '文档不存在',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing[0].publishStatus !== '待审核') {
      throw new BusinessException(
        ResponseCode.BUSINESS_ERROR,
        '只有待审核状态的文档可以驳回',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.db
      .update(docs)
      .set({
        publishStatus: '草稿',
        updatedBy: userId || undefined,
      })
      .where(eq(docs.id, id));

    return { success: true };
  }

  async remove(id: string): Promise<SuccessResponse> {
    await this.db.delete(docs).where(eq(docs.id, id));
    return { success: true };
  }

  async move(
    id: string,
    body: MoveDocRequest,
    userId: string,
  ): Promise<SuccessResponse> {
    const existing = await this.db
      .select()
      .from(docs)
      .where(eq(docs.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new BusinessException(
        ResponseCode.NOT_FOUND,
        '文档不存在',
        HttpStatus.NOT_FOUND,
      );
    }

    const slug: string = existing[0]?.slug ?? '';
    const lang: Language = (existing[0]?.language as Language) ?? 'zh-CN';
    const filePath = await this.buildFilePath(
      body.firstCategory,
      body.secondCategory,
      slug,
      lang,
    );
    const helpCenterUrl = filePath
      ? await this.buildHelpCenterUrl(filePath, lang, existing[0]?.translationGroupId)
      : '';

    await this.db
      .update(docs)
      .set({
        firstCategory: body.firstCategory,
        secondCategory: body.secondCategory || null,
        filePath,
        helpCenterUrl,
        updatedBy: userId || undefined,
      })
      .where(eq(docs.id, id));

    return { success: true };
  }

  private calculateWordCount(markdownContent?: string): number {
    if (!markdownContent) return 0;
    const chineseChars =
      (markdownContent.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const englishWords =
      (markdownContent.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }

  private async getSystemConfigValue(): Promise<{
    enI18nDocsDir: string;
    defaultDocsDir: string;
    productionUrl: string;
  }> {
    const rows = await this.db
      .select({
        enI18nDocsDir: systemConfig.enI18nDocsDir,
        defaultDocsDir: systemConfig.defaultDocsDir,
        productionUrl: systemConfig.productionUrl,
      })
      .from(systemConfig)
      .limit(1);
    return {
      enI18nDocsDir: rows[0]?.enI18nDocsDir ?? 'i18n/en/docusaurus-plugin-content-docs/current',
      defaultDocsDir: rows[0]?.defaultDocsDir ?? 'docs',
      productionUrl: rows[0]?.productionUrl ?? '',
    };
  }

  private async buildFilePath(
    firstCategoryId: string,
    secondCategoryId?: string,
    slug?: string,
    language?: Language,
  ): Promise<string> {
    if (!slug) return '';

    let docusaurusPath = '';
    if (secondCategoryId) {
      const secondCat = await this.db
        .select({ docusaurusPath: categories.docusaurusPath })
        .from(categories)
        .where(eq(categories.id, secondCategoryId))
        .limit(1);
      docusaurusPath = secondCat[0]?.docusaurusPath ?? '';
    } else if (firstCategoryId) {
      const firstCat = await this.db
        .select({ docusaurusPath: categories.docusaurusPath })
        .from(categories)
        .where(eq(categories.id, firstCategoryId))
        .limit(1);
      docusaurusPath = firstCat[0]?.docusaurusPath ?? '';
    }

    if (language === 'en' && docusaurusPath) {
      const config = await this.getSystemConfigValue();
      docusaurusPath = docusaurusPath.replace(
        new RegExp(`^${config.defaultDocsDir}`),
        config.enI18nDocsDir,
      );
    }

    return `${docusaurusPath}/${slug}.mdx`;
  }

  private async buildHelpCenterUrl(
    filePath: string,
    language?: Language,
    translationGroupId?: string | null,
  ): Promise<string> {
    if (!filePath) return '';
    const config = await this.getSystemConfigValue();
    if (!config.productionUrl) return '';
    const base = config.productionUrl.replace(/\/+$/, '');
    const relativePath = filePath.replace(/\.mdx$/, '');
    if (language === 'en') {
      let hasChineseSibling = false;
      if (translationGroupId) {
        const siblings = await this.db
          .select({ id: docs.id })
          .from(docs)
          .where(
            and(
              eq(docs.translationGroupId, translationGroupId),
              eq(docs.language, 'zh-CN'),
            ),
          )
          .limit(1);
        hasChineseSibling = siblings.length > 0;
      }
      if (hasChineseSibling) {
        const rel = relativePath.replace(
          new RegExp(`^${config.enI18nDocsDir}`),
          '',
        );
        return `${base}/en/${config.defaultDocsDir}${rel}`;
      }
      const rel = relativePath.replace(
        new RegExp(`^${config.enI18nDocsDir}`),
        '',
      );
      return `${base}/${config.defaultDocsDir}${rel}`;
    }
    return `${base}/${relativePath}`;
  }

  private async validatePathUniqueness(
    language: Language,
    filePath: string,
    excludeId?: string,
  ): Promise<void> {
    if (!filePath) return;
    const conditions = [
      eq(docs.language, language),
      eq(docs.filePath, filePath),
    ];
    if (excludeId) {
      conditions.push(ne(docs.id, excludeId));
    }
    const existing = await this.db
      .select({ id: docs.id })
      .from(docs)
      .where(and(...conditions))
      .limit(1);
    if (existing.length > 0) {
      throw new BusinessException(
        ResponseCode.BUSINESS_ERROR,
        '该语言下文件路径已存在，请更换路径标识',
        HttpStatus.CONFLICT,
      );
    }
  }

  async previewPath(params: {
    language: Language;
    firstCategory: string;
    secondCategory?: string;
    slug: string;
    excludeId?: string;
  }): Promise<{ filePath: string; helpCenterUrl: string; pathExists: boolean }> {
    const filePath = await this.buildFilePath(
      params.firstCategory,
      params.secondCategory,
      params.slug,
      params.language,
    );
    const helpCenterUrl = filePath
      ? await this.buildHelpCenterUrl(filePath, params.language)
      : '';

    let pathExists = false;
    if (filePath) {
      const conditions = [
        eq(docs.language, params.language),
        eq(docs.filePath, filePath),
      ];
      if (params.excludeId) {
        conditions.push(ne(docs.id, params.excludeId));
      }
      const existing = await this.db
        .select({ id: docs.id })
        .from(docs)
        .where(and(...conditions))
        .limit(1);
      pathExists = existing.length > 0;
    }

    return { filePath, helpCenterUrl, pathExists };
  }

  async getDetail(id: string): Promise<DocDetailResponse> {
    const rows = await this.db
      .select()
      .from(docs)
      .where(eq(docs.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new BusinessException(
        ResponseCode.NOT_FOUND,
        '文档不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    const item = rows[0];
    const docItem: DocItem = {
      id: item.id,
      title: item.title,
      summary: item.summary ?? '',
      firstCategory: item.firstCategory ?? '',
      secondCategory: item.secondCategory ?? '',
      slug: item.slug ?? '',
      filePath: item.filePath ?? '',
      helpCenterUrl: item.helpCenterUrl ?? '',
      language: (item.language as Language) ?? 'zh-CN',
      translationGroupId: item.translationGroupId ?? null,
      contentStatus: (item.contentStatus as DocItem['contentStatus']) ?? '无正文',
      publishStatus: (item.publishStatus as DocItem['publishStatus']) ?? '草稿',
      owner: item.owner ?? '',
      lastPublisher: item.lastPublisher ?? '',
      wordCount: item.wordCount ?? 0,
      sourceType: (item.sourceType as DocItem['sourceType']) ?? '手动创建',
      sourceUrl: item.sourceUrl ?? '',
      updatedAt: item.updatedAt?.toISOString() ?? '',
      publishedAt: item.publishedAt?.toISOString() ?? '',
    };

    let relatedZhDoc: DocItem | null = null;
    let relatedEnDoc: DocItem | null = null;

    if (docItem.translationGroupId) {
      const siblings = await this.db
        .select()
        .from(docs)
        .where(
          and(
            eq(docs.translationGroupId, docItem.translationGroupId),
            ne(docs.id, id),
          ),
        );
      for (const sib of siblings) {
        const sibItem: DocItem = {
          id: sib.id,
          title: sib.title,
          summary: sib.summary ?? '',
          firstCategory: sib.firstCategory ?? '',
          secondCategory: sib.secondCategory ?? '',
          slug: sib.slug ?? '',
          filePath: sib.filePath ?? '',
          helpCenterUrl: sib.helpCenterUrl ?? '',
          language: (sib.language as Language) ?? 'zh-CN',
          translationGroupId: sib.translationGroupId ?? null,
          contentStatus: (sib.contentStatus as DocItem['contentStatus']) ?? '无正文',
          publishStatus: (sib.publishStatus as DocItem['publishStatus']) ?? '草稿',
          owner: sib.owner ?? '',
          lastPublisher: sib.lastPublisher ?? '',
          wordCount: sib.wordCount ?? 0,
          sourceType: (sib.sourceType as DocItem['sourceType']) ?? '手动创建',
          sourceUrl: sib.sourceUrl ?? '',
          updatedAt: sib.updatedAt?.toISOString() ?? '',
          publishedAt: sib.publishedAt?.toISOString() ?? '',
        };
        if (sibItem.language === 'zh-CN') relatedZhDoc = sibItem;
        else if (sibItem.language === 'en') relatedEnDoc = sibItem;
      }
    }

    await this.attachTranslationStatus([docItem]);

    return { ...docItem, markdownContent: item.markdownContent ?? '', relatedZhDoc, relatedEnDoc };
  }

  private async attachTranslationStatus(docItems: DocItem[]): Promise<void> {
    const groupIds = docItems
      .map((d: DocItem) => d.translationGroupId)
      .filter((gid: string | null): gid is string => !!gid);
    if (groupIds.length === 0) {
      docItems.forEach((d: DocItem) => { d.translationStatus = d.language === 'en' ? '仅英文' : '仅中文'; });
      return;
    }
    const groupDocs = await this.db
      .select({ translationGroupId: docs.translationGroupId, language: docs.language, updatedAt: docs.updatedAt })
      .from(docs)
      .where(inArray(docs.translationGroupId, groupIds));
    const groupMap = new Map<string, Map<string, Date>>();
    for (const gd of groupDocs) {
      const gid = gd.translationGroupId ?? '';
      if (!gid) continue;
      if (!groupMap.has(gid)) groupMap.set(gid, new Map());
      const lang = gd.language ?? 'zh-CN';
      const existing = groupMap.get(gid)!.get(lang);
      if (!existing || (gd.updatedAt && gd.updatedAt > existing)) {
        groupMap.get(gid)!.set(lang, gd.updatedAt ?? new Date(0));
      }
    }
    for (const d of docItems) {
      const gid = d.translationGroupId;
      if (!gid) {
        d.translationStatus = d.language === 'en' ? '仅英文' : '仅中文';
        continue;
      }
      const langTimes = groupMap.get(gid);
      if (!langTimes) {
        d.translationStatus = d.language === 'en' ? '仅英文' : '仅中文';
        continue;
      }
      const hasZh = langTimes.has('zh-CN');
      const hasEn = langTimes.has('en');
      if (hasZh && hasEn) {
        const zhTime = langTimes.get('zh-CN')!;
        const enTime = langTimes.get('en')!;
        if (zhTime > enTime) {
          d.translationStatus = '英文待更新' as TranslationStatus;
        } else {
          d.translationStatus = '中英文完整' as TranslationStatus;
        }
      } else if (hasZh) {
        d.translationStatus = '仅中文' as TranslationStatus;
      } else if (hasEn) {
        d.translationStatus = '仅英文' as TranslationStatus;
      } else {
        d.translationStatus = d.language === 'en' ? '仅英文' : '仅中文';
      }
    }
  }

  private async validateGroupLanguageUnique(
    groupId: string,
    language: Language,
    excludeId?: string,
  ): Promise<void> {
    const conditions = [
      eq(docs.translationGroupId, groupId),
      eq(docs.language, language),
    ];
    if (excludeId) conditions.push(ne(docs.id, excludeId));
    const existing = await this.db
      .select({ id: docs.id })
      .from(docs)
      .where(and(...conditions))
      .limit(1);
    if (existing.length > 0) {
      throw new BusinessException(
        ResponseCode.BUSINESS_ERROR,
        '该翻译组下已存在同语言文档',
        HttpStatus.CONFLICT,
      );
    }
  }

  async batchSubmitReview(ids: string[], userId: string): Promise<BatchActionResponse> {
    let successCount = 0;
    let skippedCount = 0;
    const errorMessages: string[] = [];
    for (const id of ids) {
      try {
        await this.submitReview(id, userId);
        successCount++;
      } catch (e: unknown) {
        if (e instanceof BusinessException) {
          skippedCount++;
        } else {
          errorMessages.push(`文档 ${id}: ${e instanceof Error ? e.message : '操作失败'}`);
        }
      }
    }
    return { successCount, failCount: errorMessages.length, skippedCount, errorMessages };
  }

  async batchApprove(ids: string[], userId: string): Promise<BatchActionResponse> {
    let successCount = 0;
    let skippedCount = 0;
    const errorMessages: string[] = [];
    for (const id of ids) {
      try {
        await this.approve(id, userId);
        successCount++;
      } catch (e: unknown) {
        if (e instanceof BusinessException) {
          skippedCount++;
        } else {
          errorMessages.push(`文档 ${id}: ${e instanceof Error ? e.message : '操作失败'}`);
        }
      }
    }
    return { successCount, failCount: errorMessages.length, skippedCount, errorMessages };
  }

  async batchReject(ids: string[], userId: string): Promise<BatchActionResponse> {
    let successCount = 0;
    let skippedCount = 0;
    const errorMessages: string[] = [];
    for (const id of ids) {
      try {
        await this.reject(id, userId);
        successCount++;
      } catch (e: unknown) {
        if (e instanceof BusinessException) {
          skippedCount++;
        } else {
          errorMessages.push(`文档 ${id}: ${e instanceof Error ? e.message : '操作失败'}`);
        }
      }
    }
    return { successCount, failCount: errorMessages.length, skippedCount, errorMessages };
  }

  async batchMove(body: BatchActionRequest, userId: string): Promise<BatchActionResponse> {
    let successCount = 0;
    const errorMessages: string[] = [];
    for (const id of body.ids) {
      try {
        await this.move(id, { firstCategory: body.firstCategory ?? '', secondCategory: body.secondCategory }, userId);
        successCount++;
      } catch (e: unknown) {
        errorMessages.push(`文档 ${id}: ${e instanceof Error ? e.message : '操作失败'}`);
      }
    }
    return { successCount, failCount: body.ids.length - successCount, skippedCount: 0, errorMessages };
  }

  async batchDelete(ids: string[], userId: string): Promise<BatchActionResponse> {
    let successCount = 0;
    const errorMessages: string[] = [];
    for (const id of ids) {
      try {
        await this.remove(id);
        successCount++;
      } catch (e: unknown) {
        errorMessages.push(`文档 ${id}: ${e instanceof Error ? e.message : '操作失败'}`);
      }
    }
    return { successCount, failCount: ids.length - successCount, skippedCount: 0, errorMessages };
  }
  async scanPptxPollution(): Promise<import('@shared/api.interface').PptxPollutionScanResult> {
    const allDocs = await this.db
      .select({
        id: docs.id,
        title: docs.title,
        slug: docs.slug,
        markdownContent: docs.markdownContent,
      })
      .from(docs);

    const pollutedDocuments: import('@shared/api.interface').PptxPollutionScanResult['pollutedDocuments'] = [];
    const pptxReferenceDocuments: import('@shared/api.interface').PptxPollutionScanResult['pptxReferenceDocuments'] = [];

    for (const doc of allDocs) {
      const content = doc.markdownContent || '';
      const patterns: string[] = [];

      if (content.includes('幻灯片内容摘要')) patterns.push('幻灯片内容摘要');
      if (content.includes('点击下载')) patterns.push('点击下载');
      if (content.includes('缩略图') && content.includes('ppt-')) patterns.push('缩略图(带ppt-路径)');
      if (content.includes('<details>') && content.includes('<summary>')) patterns.push('<details>+<summary>幻灯片提取块');

      const hasPptxRef = content.includes('.pptx') || content.includes('.ppt');
      if (hasPptxRef) {
        pptxReferenceDocuments.push({
          id: String(doc.id),
          title: doc.title || '',
          slug: doc.slug || '',
        });
      }

      if (patterns.length > 0) {
        pollutedDocuments.push({
          id: String(doc.id),
          title: doc.title || '',
          slug: doc.slug || '',
          patterns,
        });
      }
    }

    this.logger.log(`PPTX pollution scan completed: ${pollutedDocuments.length} polluted, ${pptxReferenceDocuments.length} with references`);
    return {
      totalPolluted: pollutedDocuments.length,
      pollutedDocuments,
      totalPptxReferences: pptxReferenceDocuments.length,
      pptxReferenceDocuments,
    };
  }

  async cleanPptxPollution(): Promise<import('@shared/api.interface').CleanPptxPollutionResult> {
    const scanResult = await this.scanPptxPollution();
    const cleanedDocuments: Array<{ id: string; title: string; slug: string }> = [];
    const errors: string[] = [];

    for (const doc of scanResult.pollutedDocuments) {
      try {
        const row = await this.db
          .select({ markdownContent: docs.markdownContent })
          .from(docs)
          .where(eq(docs.id, doc.id))
          .limit(1);

        if (!row.length || !row[0].markdownContent) continue;

        let content = row[0].markdownContent;

        content = content.replace(/^>\s+\*\*\[.*?-\s*点击下载\]\(.*?\)\*\*\s*$/gm, '');
        content = content.replace(/^!\[.*?缩略图\]\(.*?ppt-.*?\)\s*$/gm, '');
        content = content.replace(/<details>\s*\n\s*<summary>幻灯片内容摘要[\s\S]*?<\/details>/g, '');
        content = content.replace(/\n{3,}/g, '\n\n');
        content = content.trim();

        await this.db
          .update(docs)
          .set({ markdownContent: content })
          .where(eq(docs.id, doc.id));

        cleanedDocuments.push({ id: doc.id, title: doc.title, slug: doc.slug });
        this.logger.log(`Cleaned PPTX pollution in doc: ${doc.title} (${doc.id})`);
      } catch (e) {
        const errMsg = `Failed to clean doc ${doc.title} (${doc.id}): ${e instanceof Error ? e.message : 'unknown error'}`;
        errors.push(errMsg);
        this.logger.error(errMsg);
      }
    }

    return { totalCleaned: cleanedDocuments.length, cleanedDocuments, errors };
  }
}
