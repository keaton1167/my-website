import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, sql } from 'drizzle-orm';
import { docs, importTasks, publishTasks } from '@server/database/schema';
import type {
  DashboardStatistics,
  RecentImportTask,
  RecentPublishTask,
  RecentUpdatedDoc,
} from '@shared/api.interface';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getStatistics(): Promise<DashboardStatistics> {
    this.logger.log('Fetching dashboard statistics');

    try {
      const totalResult = await this.db
        .select({ count: count() })
        .from(docs);
      const totalDocs: number = totalResult[0]?.count ?? 0;

      const draftResult = await this.db
        .select({ count: count() })
        .from(docs)
        .where(eq(docs.publishStatus, '草稿'));
      const draftCount: number = draftResult[0]?.count ?? 0;

      const pendingReviewResult = await this.db
        .select({ count: count() })
        .from(docs)
        .where(eq(docs.publishStatus, '待审核'));
      const pendingReviewCount: number = pendingReviewResult[0]?.count ?? 0;

      const pendingPublishResult = await this.db
        .select({ count: count() })
        .from(docs)
        .where(eq(docs.publishStatus, '待发布'));
      const pendingPublishCount: number = pendingPublishResult[0]?.count ?? 0;

      const publishedResult = await this.db
        .select({ count: count() })
        .from(docs)
        .where(eq(docs.publishStatus, '已发布'));
      const publishedCount: number = publishedResult[0]?.count ?? 0;

      const noContentResult = await this.db
        .select({ count: count() })
        .from(docs)
        .where(eq(docs.contentStatus, '无正文'));
      const noContentCount: number = noContentResult[0]?.count ?? 0;

      const failedImportResult = await this.db
        .select({ count: count() })
        .from(docs)
        .where(and(eq(docs.sourceType, '飞书导入'), eq(docs.contentStatus, '转换失败')));
      const failedImportCount: number = failedImportResult[0]?.count ?? 0;

      return {
        totalDocs,
        draftCount,
        pendingReviewCount,
        pendingPublishCount,
        publishedCount,
        noContentCount,
        failedImportCount,
      };
    } catch (err) {
      this.logger.error(`getStatistics failed: ${JSON.stringify(err)}`);
      throw err;
    }
  }

  async getRecentImports(limit: number = 10): Promise<{ items: RecentImportTask[] }> {
    this.logger.log(`Fetching recent imports, limit: ${limit}`);

    try {
      const rows = await this.db
        .select({
          id: importTasks.id,
          sourceUrl: importTasks.sourceUrl,
          status: importTasks.status,
          createdAt: importTasks.createdAt,
          createdBy: importTasks.createdBy,
        })
        .from(importTasks)
        .orderBy(desc(importTasks.createdAt))
        .limit(limit);

      const items: RecentImportTask[] = rows.map(
        (row: { id: string; sourceUrl: string; status: string | null; createdAt: Date; createdBy: string | null }) => {
          const urlParts: string[] = row.sourceUrl.split('/');
          const extractedTitle: string = urlParts[urlParts.length - 1] || row.sourceUrl;
          return {
            id: row.id,
            title: extractedTitle,
            sourceUrl: row.sourceUrl,
            status: row.status ?? '待转换',
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
            createdBy: row.createdBy ?? '',
          };
        },
      );

      return { items };
    } catch (err) {
      this.logger.error(`getRecentImports failed: ${JSON.stringify(err)}`);
      throw err;
    }
  }

  async getRecentPublishes(limit: number = 10): Promise<{ items: RecentPublishTask[] }> {
    this.logger.log(`Fetching recent publishes, limit: ${limit}`);

    try {
      const rows = await this.db
        .select({
          id: publishTasks.id,
          taskName: publishTasks.taskName,
          taskType: publishTasks.taskType,
          environment: publishTasks.environment,
          status: publishTasks.status,
          createdAt: publishTasks.createdAt,
          operator: publishTasks.operator,
        })
        .from(publishTasks)
        .orderBy(desc(publishTasks.createdAt))
        .limit(limit);

      const items: RecentPublishTask[] = rows.map(
        (row: { id: string; taskName: string; taskType: string; environment: string | null; status: string | null; createdAt: Date; operator: string | null }) => ({
          id: row.id,
          taskName: row.taskName,
          taskType: row.taskType,
          environment: row.environment ?? '',
          status: row.status ?? '待执行',
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
          operator: row.operator ?? '',
        }),
      );

      return { items };
    } catch (err) {
      this.logger.error(`getRecentPublishes failed: ${JSON.stringify(err)}`);
      throw err;
    }
  }

  async getRecentUpdatedDocs(limit: number = 10): Promise<{ items: RecentUpdatedDoc[] }> {
    this.logger.log(`Fetching recent updated docs, limit: ${limit}`);

    try {
      const rows = await this.db
        .select({
          id: docs.id,
          title: docs.title,
          firstCategory: docs.firstCategory,
          publishStatus: docs.publishStatus,
          updatedAt: docs.updatedAt,
          owner: docs.owner,
        })
        .from(docs)
        .orderBy(desc(docs.updatedAt))
        .limit(limit);

      const items: RecentUpdatedDoc[] = rows.map(
        (row: { id: string; title: string; firstCategory: string | null; publishStatus: string | null; updatedAt: Date; owner: string | null }) => ({
          id: row.id,
          title: row.title,
          firstCategory: row.firstCategory ?? '',
          publishStatus: row.publishStatus ?? '草稿',
          updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
          owner: row.owner ?? '',
        }),
      );

      return { items };
    } catch (err) {
      this.logger.error(`getRecentUpdatedDocs failed: ${JSON.stringify(err)}`);
      throw err;
    }
  }
}
