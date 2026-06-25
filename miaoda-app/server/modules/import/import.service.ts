import { Injectable, Logger, Inject, HttpStatus } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { importTasks, docs, categories } from '@server/database/schema';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import { ResponseCode } from '@server/common/constants/api_response_code';
import type { ImportFeishuRequest, ImportFeishuResponse } from '@shared/api.interface';

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async importFeishuDoc(
    body: ImportFeishuRequest,
    userId: string,
  ): Promise<ImportFeishuResponse> {
    // Step 1: Create import_tasks record with status='待转换'
    const taskResult = await this.db
      .insert(importTasks)
      .values({
        sourceType: 'feishu',
        sourceUrl: body.sourceUrl,
        targetCategory: body.targetSecondCategory || body.targetFirstCategory,
        status: '待转换',
        createdBy: userId || undefined,
        updatedBy: userId || undefined,
      })
      .returning({ id: importTasks.id });

    const taskId: string = taskResult[0]?.id ?? '';

    if (!taskId) {
      throw new BusinessException(
        ResponseCode.INTERNAL_ERROR,
        '创建导入任务失败',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.log(`Created import task id=${taskId}`);

    // Step 2: Update status to '转换中'
    await this.db
      .update(importTasks)
      .set({
        status: '转换中',
        updatedBy: userId || undefined,
      })
      .where(eq(importTasks.id, taskId));

    try {
      // Step 3: Convert feishu doc to Markdown (simulated)
      // TODO: Replace with actual feishu API call
      const convertedMarkdown: string = this.simulateConversion(
        body.title,
        body.sourceUrl,
        body.summary,
      );

      // Step 4: Build file path for the doc
      const filePath: string = await this.buildFilePath(
        body.targetFirstCategory,
        body.targetSecondCategory,
        body.slug,
      );

      // Step 5: Create a draft doc record
      const docResult = await this.db
        .insert(docs)
        .values({
          title: body.title,
          summary: body.summary || null,
          firstCategory: body.targetFirstCategory,
          secondCategory: body.targetSecondCategory || null,
          slug: body.slug,
          filePath,
          markdownContent: convertedMarkdown,
          contentStatus: '有正文',
          publishStatus: '草稿',
          owner: body.owner || userId || undefined,
          sourceType: '飞书导入',
          sourceUrl: body.sourceUrl,
          wordCount: this.calculateWordCount(convertedMarkdown),
          createdBy: userId || undefined,
          updatedBy: userId || undefined,
        })
        .returning({ id: docs.id });

      const docId: string = docResult[0]?.id ?? '';

      // Step 6: Update import_tasks with convertedMarkdown, status='成功', and targetDocId
      await this.db
        .update(importTasks)
        .set({
          status: '成功',
          convertedMarkdown,
          targetDocId: docId,
          finishedAt: new Date(),
          updatedBy: userId || undefined,
        })
        .where(eq(importTasks.id, taskId));

      this.logger.log(`Import task id=${taskId} succeeded, doc id=${docId}`);

      return {
        taskId,
        status: '成功',
        convertedMarkdown,
      };
    } catch (error: unknown) {
      const errorMsg: string =
        error instanceof Error ? error.message : '未知错误';

      // Update import_tasks with error info
      await this.db
        .update(importTasks)
        .set({
          status: '失败',
          errorMessage: errorMsg,
          finishedAt: new Date(),
          updatedBy: userId || undefined,
        })
        .where(eq(importTasks.id, taskId));

      this.logger.log(`Import task id=${taskId} failed: ${errorMsg}`);

      return {
        taskId,
        status: '失败',
        errorMessage: errorMsg,
      };
    }
  }

  private simulateConversion(
    title: string,
    sourceUrl: string,
    summary?: string,
  ): string {
    return `# ${title}\n\n> 来源：${sourceUrl}\n\n## 概述\n\n${summary || '暂无摘要'}\n\n## 正文内容\n\n待补充...`;
  }

  private async buildFilePath(
    firstCategoryId: string,
    secondCategoryId?: string,
    slug?: string,
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

    return `${docusaurusPath}/${slug}.md`;
  }

  private calculateWordCount(markdownContent?: string): number {
    if (!markdownContent) return 0;
    const chineseChars: number =
      (markdownContent.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const englishWords: number =
      (markdownContent.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }
}
