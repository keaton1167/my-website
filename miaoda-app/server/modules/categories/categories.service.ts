import { Injectable, Logger, Inject, HttpStatus } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, asc, sql, count, ne } from 'drizzle-orm';
import { categories, docs } from '@server/database/schema';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import { ResponseCode } from '@server/common/constants/api_response_code';
import type {
  CategoryItem,
  CategoryListResponse,
  CategoryOption,
  CategoryDependenciesResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  ToggleCategoryStatusRequest,
  UpdateCategoryOrderRequest,
  SuccessResponse,
  CreateResponse,
} from '@shared/api.interface';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getList(params: {
    page: number;
    pageSize: number;
  }): Promise<CategoryListResponse> {
    const { page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const [items, totalResult, allCategories] = await Promise.all([
      this.db
        .select()
        .from(categories)
        .orderBy(asc(categories.level), asc(categories.sortOrder))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(categories),
      this.db
        .select({ id: categories.id, nameCn: categories.nameCn })
        .from(categories),
    ]);

    const total = parseInt(String(totalResult[0]?.total ?? '0'), 10);

    const nameMap = new Map<string, string>();
    for (const cat of allCategories) {
      nameMap.set(cat.id, cat.nameCn);
    }

    const categoryItems: CategoryItem[] = items.map(
      (item: typeof categories.$inferSelect): CategoryItem => ({
        id: item.id,
        parentId: item.parentId ?? '',
        parentName: item.parentId
          ? (nameMap.get(item.parentId) ?? '-')
          : '-',
        level: item.level,
        nameCn: item.nameCn,
        nameEn: item.nameEn ?? item.nameCn,
        slugEn: item.slugEn,
        docusaurusPath: item.docusaurusPath ?? '',
        order: item.sortOrder ?? 0,
        description: item.description ?? '',
        enabled: item.enabled ?? true,
        createdAt: item.createdAt?.toISOString() ?? '',
      }),
    );

    return { items: categoryItems, total };
  }

  async getOptions(
    enabled?: boolean,
  ): Promise<{ items: CategoryOption[] }> {
    const conditions = [];
    if (enabled !== undefined) {
      conditions.push(eq(categories.enabled, enabled));
    }

    const query =
      conditions.length > 0
        ? this.db
            .select({
              id: categories.id,
              nameCn: categories.nameCn,
              nameEn: categories.nameEn,
              level: categories.level,
              parentId: categories.parentId,
              slugEn: categories.slugEn,
              docusaurusPath: categories.docusaurusPath,
              enabled: categories.enabled,
            })
            .from(categories)
            .where(and(...conditions))
            .orderBy(asc(categories.level), asc(categories.sortOrder))
        : this.db
            .select({
              id: categories.id,
              nameCn: categories.nameCn,
              nameEn: categories.nameEn,
              level: categories.level,
              parentId: categories.parentId,
              slugEn: categories.slugEn,
              docusaurusPath: categories.docusaurusPath,
              enabled: categories.enabled,
            })
            .from(categories)
            .orderBy(asc(categories.level), asc(categories.sortOrder));

    const rows = await query;
    const items: CategoryOption[] = rows.map(
      (row: { id: string; nameCn: string; nameEn: string; level: number; parentId: string | null; slugEn: string; docusaurusPath: string | null; enabled: boolean | null }): CategoryOption => ({
        id: row.id,
        nameCn: row.nameCn,
        nameEn: row.nameEn ?? row.nameCn,
        level: row.level,
        parentId: row.parentId ?? '',
        slugEn: row.slugEn ?? undefined,
        docusaurusPath: row.docusaurusPath ?? undefined,
        enabled: row.enabled ?? true,
      }),
    );

    return { items };
  }

  async create(
    body: CreateCategoryRequest,
    userId: string,
  ): Promise<CreateResponse> {
    const docusaurusPath = await this.buildDocusaurusPath(
      body.parentId,
      body.slugEn,
    );

    await this.validatePathUniqueness(docusaurusPath);

    const result = await this.db
      .insert(categories)
      .values({
        parentId: body.parentId || null,
        level: body.level,
        nameCn: body.nameCn,
        nameEn: body.nameEn || null,
        slugEn: body.slugEn,
        docusaurusPath,
        sortOrder: body.order,
        description: body.description || null,
        enabled: body.enabled,
        createdBy: userId || undefined,
        updatedBy: userId || undefined,
      })
      .returning({ id: categories.id });

    this.logger.log(`Created category id=${result[0]?.id}`);
    return { id: result[0]?.id ?? '' };
  }

  async checkDependencies(
    id: string,
  ): Promise<CategoryDependenciesResponse> {
    const [childrenResult, docsResult] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(categories)
        .where(eq(categories.parentId, id)),
      this.db
        .select({ count: count() })
        .from(docs)
        .where(
          sql`${docs.firstCategory} = ${id} OR ${docs.secondCategory} = ${id}`,
        ),
    ]);

    const childCount = parseInt(String(childrenResult[0]?.count ?? '0'), 10);
    const docCount = parseInt(String(docsResult[0]?.count ?? '0'), 10);

    return {
      hasChildren: childCount > 0,
      hasDocs: docCount > 0,
      childCount,
      docCount,
    };
  }

  async update(
    id: string,
    body: UpdateCategoryRequest,
    userId: string,
  ): Promise<SuccessResponse> {
    const existing = await this.db
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new BusinessException(
        ResponseCode.BUSINESS_ERROR,
        '目录不存在',
        HttpStatus.NOT_FOUND,
      );
    }

    const currentCategory = existing[0]!;
    const updateValues: {
      nameCn?: string;
      nameEn?: string;
      slugEn?: string;
      level?: number;
      parentId?: string | null;
      sortOrder?: number;
      enabled?: boolean;
      description?: string;
      docusaurusPath?: string;
      updatedBy?: string;
    } = {
      updatedBy: userId || undefined,
    };

    if (body.nameCn !== undefined) updateValues.nameCn = body.nameCn;
    if (body.nameEn !== undefined) updateValues.nameEn = body.nameEn;
    if (body.slugEn !== undefined) updateValues.slugEn = body.slugEn;
    if (body.description !== undefined) updateValues.description = body.description;
    if (body.level !== undefined) updateValues.level = body.level;
    if (body.order !== undefined) updateValues.sortOrder = body.order;
    if (body.enabled !== undefined) updateValues.enabled = body.enabled;
    if (body.parentId !== undefined) {
      updateValues.parentId = body.parentId || null;
    }

    const newSlugEn = body.slugEn ?? currentCategory.slugEn;
    const newParentId =
      body.parentId !== undefined
        ? (body.parentId || null)
        : currentCategory.parentId;
    const newLevel = body.level ?? currentCategory.level;

    if (
      body.slugEn !== undefined ||
      body.parentId !== undefined ||
      body.level !== undefined
    ) {
      const newPath = await this.buildDocusaurusPath(
        newParentId ?? undefined,
        newSlugEn,
      );

      if (body.slugEn !== undefined || body.parentId !== undefined) {
        await this.validatePathUniqueness(newPath, id);
      }

      updateValues.docusaurusPath = newPath;
      updateValues.level = newLevel;

      if (body.parentId !== undefined || body.slugEn !== undefined) {
        await this.recalculateChildPaths(
          id,
          newPath,
        );
      }
    }

    await this.db
      .update(categories)
      .set(updateValues)
      .where(eq(categories.id, id));

    return { success: true };
  }

  async toggleStatus(
    id: string,
    body: ToggleCategoryStatusRequest,
    userId: string,
  ): Promise<SuccessResponse> {
    await this.db
      .update(categories)
      .set({ enabled: body.enabled, updatedBy: userId || undefined })
      .where(eq(categories.id, id));

    return { success: true };
  }

  async updateOrder(
    id: string,
    body: UpdateCategoryOrderRequest,
    userId: string,
  ): Promise<SuccessResponse> {
    await this.db
      .update(categories)
      .set({ sortOrder: body.order, updatedBy: userId || undefined })
      .where(eq(categories.id, id));

    return { success: true };
  }

  async remove(id: string): Promise<SuccessResponse> {
    const children = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, id));

    for (const child of children) {
      await this.db
        .update(docs)
        .set({ secondCategory: null })
        .where(eq(docs.secondCategory, child.id));

      await this.db
        .delete(categories)
        .where(eq(categories.id, child.id));
    }

    await this.db
      .update(docs)
      .set({ firstCategory: null })
      .where(eq(docs.firstCategory, id));

    await this.db
      .update(docs)
      .set({ secondCategory: null })
      .where(eq(docs.secondCategory, id));

    await this.db.delete(categories).where(eq(categories.id, id));

    this.logger.log(`Deleted category id=${id}, cascade removed ${children.length} children`);
    return { success: true };
  }

  private async buildDocusaurusPath(
    parentId: string | undefined,
    slugEn: string,
  ): Promise<string> {
    if (!parentId) {
      return `docs/${slugEn}`;
    }

    const parent = await this.db
      .select({ docusaurusPath: categories.docusaurusPath })
      .from(categories)
      .where(eq(categories.id, parentId))
      .limit(1);

    const parentPath = parent[0]?.docusaurusPath ?? '';
    return `${parentPath}/${slugEn}`;
  }

  private async recalculateChildPaths(
    parentId: string,
    parentPath: string,
  ): Promise<void> {
    const children = await this.db
      .select({ id: categories.id, slugEn: categories.slugEn })
      .from(categories)
      .where(eq(categories.parentId, parentId));

    for (const child of children) {
      const childPath = `${parentPath}/${child.slugEn}`;
      await this.db
        .update(categories)
        .set({ docusaurusPath: childPath })
        .where(eq(categories.id, child.id));
      await this.recalculateChildPaths(child.id, childPath);
    }
  }

  private async validatePathUniqueness(
    targetPath: string,
    excludeId?: string,
  ): Promise<void> {
    const conditions = [eq(categories.docusaurusPath, targetPath)];
    if (excludeId) {
      conditions.push(ne(categories.id, excludeId));
    }

    const existing = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(...conditions))
      .limit(1);

    if (existing.length > 0) {
      throw new BusinessException(
        ResponseCode.BUSINESS_ERROR,
        '当前帮助中心路径已存在，请更换目录路径标识',
        HttpStatus.CONFLICT,
      );
    }
  }
}
