import { Injectable, Logger, Inject, BadRequestException } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, count } from 'drizzle-orm';
import { taskQueue } from '@server/database/schema';
import type {
  TaskQueueType,
  TaskQueueStatus,
  TaskQueueRecord,
  TaskQueueListParams,
  TaskQueueListResponse,
  EnqueueRequest,
  EnqueueResponse,
  CreateResponse,
} from '@shared/api.interface';

export type TaskQueueHandlerFn = (
  payload: Record<string, unknown>,
  taskId: string,
  log: (line: string) => void,
) => Promise<Record<string, unknown> | void>;

const MAX_LOG_SIZE = 50 * 1024;
const MAX_ERROR_SIZE = 10 * 1024;

@Injectable()
export class TaskQueueService {
  private readonly logger = new Logger(TaskQueueService.name);
  private readonly handlers = new Map<TaskQueueType, TaskQueueHandlerFn>();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  registerHandler(taskType: TaskQueueType, handler: TaskQueueHandlerFn): void {
    this.handlers.set(taskType, handler);
    this.logger.log(`Registered handler for task type: ${taskType}`);
  }

  async enqueue(req: EnqueueRequest, userId?: string): Promise<EnqueueResponse> {
    const [record] = await this.db
      .insert(taskQueue)
      .values({
        taskType: req.taskType,
        title: req.title,
        status: 'pending',
        priority: req.priority ?? 0,
        payload: req.payload ?? null,
        parentTaskId: req.parentTaskId ?? null,
        refType: req.refType ?? null,
        refId: req.refId ?? null,
        maxRetries: req.maxRetries ?? 0,
        createdBy: userId ?? null,
      })
      .returning({ id: taskQueue.id });

    const taskId = record.id;
    this.executeTask(taskId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Task execution error: taskId=${taskId}, error=${msg}`);
    });

    return { id: taskId };
  }

  async updateStatus(
    taskId: string,
    status: TaskQueueStatus,
    extra?: {
      result?: Record<string, unknown>;
      logs?: string;
      errorMessage?: string;
    },
  ): Promise<void> {
    const now = new Date();
    const updateData: Record<string, unknown> = {
      status,
      updatedAt: now,
    };

    if (status === 'running') {
      updateData.startedAt = now;
    }

    if (status === 'success' || status === 'failed' || status === 'cancelled') {
      updateData.finishedAt = now;
    }

    if (extra?.result !== undefined) {
      updateData.result = extra.result;
    }

    if (extra?.logs !== undefined) {
      updateData.logs = extra.logs.length > MAX_LOG_SIZE
        ? extra.logs.slice(0, MAX_LOG_SIZE)
        : extra.logs;
    }

    if (extra?.errorMessage !== undefined) {
      updateData.errorMessage = extra.errorMessage.length > MAX_ERROR_SIZE
        ? extra.errorMessage.slice(0, MAX_ERROR_SIZE)
        : extra.errorMessage;
    }

    await this.db.update(taskQueue).set(updateData).where(eq(taskQueue.id, taskId));
  }

  async retry(taskId: string, userId: string): Promise<CreateResponse> {
    const records = await this.db
      .select()
      .from(taskQueue)
      .where(eq(taskQueue.id, taskId))
      .limit(1);

    if (records.length === 0) {
      throw new BadRequestException(`Task not found: ${taskId}`);
    }

    const original = records[0];
    if (original.status !== 'failed') {
      throw new BadRequestException(
        `Only failed tasks can be retried, current status: ${original.status}`,
      );
    }

    const [newRecord] = await this.db
      .insert(taskQueue)
      .values({
        taskType: original.taskType,
        title: `${original.title} (retry #${original.retryCount + 1})`,
        status: 'pending',
        priority: original.priority,
        payload: original.payload,
        parentTaskId: original.parentTaskId,
        refType: original.refType,
        refId: original.refId,
        maxRetries: original.maxRetries,
        createdBy: userId,
      })
      .returning({ id: taskQueue.id });

    this.executeTask(newRecord.id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Task retry execution error: taskId=${newRecord.id}, error=${msg}`);
    });

    await this.db
      .update(taskQueue)
      .set({ retryCount: original.retryCount + 1, updatedAt: new Date() })
      .where(eq(taskQueue.id, taskId));

    return { id: newRecord.id };
  }

  async cancel(taskId: string): Promise<void> {
    const records = await this.db
      .select({ id: taskQueue.id, status: taskQueue.status })
      .from(taskQueue)
      .where(eq(taskQueue.id, taskId))
      .limit(1);

    if (records.length === 0) {
      throw new BadRequestException(`Task not found: ${taskId}`);
    }

    const currentStatus = records[0].status;
    if (currentStatus !== 'pending' && currentStatus !== 'running') {
      throw new BadRequestException(
        `Cannot cancel task in ${currentStatus} status, only pending or running tasks can be cancelled`,
      );
    }

    await this.updateStatus(taskId, 'cancelled');
  }

  async getStatus(taskId: string): Promise<TaskQueueRecord | null> {
    const records = await this.db
      .select({
        id: taskQueue.id,
        taskType: taskQueue.taskType,
        title: taskQueue.title,
        status: taskQueue.status,
        priority: taskQueue.priority,
        payload: taskQueue.payload,
        result: taskQueue.result,
        logs: taskQueue.logs,
        errorMessage: taskQueue.errorMessage,
        retryCount: taskQueue.retryCount,
        maxRetries: taskQueue.maxRetries,
        parentTaskId: taskQueue.parentTaskId,
        refType: taskQueue.refType,
        refId: taskQueue.refId,
        startedAt: taskQueue.startedAt,
        finishedAt: taskQueue.finishedAt,
        createdBy: taskQueue.createdBy,
        createdAt: taskQueue.createdAt,
        updatedAt: taskQueue.updatedAt,
      })
      .from(taskQueue)
      .where(eq(taskQueue.id, taskId))
      .limit(1);

    if (records.length === 0) return null;
    return this.toRecord(records[0]);
  }

  async list(params: TaskQueueListParams): Promise<TaskQueueListResponse> {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 20, 100);
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (params.taskType) {
      conditions.push(eq(taskQueue.taskType, params.taskType));
    }
    if (params.status) {
      conditions.push(eq(taskQueue.status, params.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const selectCols = {
      id: taskQueue.id,
      taskType: taskQueue.taskType,
      title: taskQueue.title,
      status: taskQueue.status,
      priority: taskQueue.priority,
      payload: taskQueue.payload,
      result: taskQueue.result,
      logs: taskQueue.logs,
      errorMessage: taskQueue.errorMessage,
      retryCount: taskQueue.retryCount,
      maxRetries: taskQueue.maxRetries,
      parentTaskId: taskQueue.parentTaskId,
      refType: taskQueue.refType,
      refId: taskQueue.refId,
      startedAt: taskQueue.startedAt,
      finishedAt: taskQueue.finishedAt,
      createdBy: taskQueue.createdBy,
      createdAt: taskQueue.createdAt,
      updatedAt: taskQueue.updatedAt,
    };

    const query = whereClause
      ? this.db.select(selectCols).from(taskQueue).where(whereClause)
      : this.db.select(selectCols).from(taskQueue);

    const [items, totalResult] = await Promise.all([
      query.orderBy(desc(taskQueue.createdAt)).limit(pageSize).offset(offset),
      whereClause
        ? this.db.select({ count: count() }).from(taskQueue).where(whereClause)
        : this.db.select({ count: count() }).from(taskQueue),
    ]);

    const total = Number(totalResult[0].count);
    return {
      items: items.map((item) => this.toRecord(item)),
      total,
    };
  }

  private async executeTask(taskId: string): Promise<void> {
    const records = await this.db
      .select()
      .from(taskQueue)
      .where(eq(taskQueue.id, taskId))
      .limit(1);

    if (records.length === 0) {
      this.logger.error(`Task not found for execution: ${taskId}`);
      return;
    }

    const task = records[0];
    const ts = () => new Date().toLocaleString('zh-CN');
    const logLines: string[] = [];
    logLines.push(`[${ts()}] Starting task: ${task.title}`);

    await this.updateStatus(taskId, 'running');

    const handler = this.handlers.get(task.taskType as TaskQueueType);
    if (!handler) {
      logLines.push(`[${ts()}] No handler registered for task type: ${task.taskType}`);
      await this.updateStatus(taskId, 'failed', {
        logs: logLines.join('\n'),
        errorMessage: `No handler registered for task type: ${task.taskType}`,
      });
      return;
    }

    const logFn = (line: string): void => {
      logLines.push(`[${ts()}] ${line}`);
    };

    try {
      const payload = (task.payload ?? {}) as Record<string, unknown>;
      const result = await handler(payload, taskId, logFn);
      logLines.push(`[${ts()}] Task completed successfully`);
      await this.updateStatus(taskId, 'success', {
        logs: logLines.join('\n'),
        ...(result ? { result } : {}),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logLines.push(`[${ts()}] Task failed: ${msg}`);
      this.logger.error(`Task execution failed: taskId=${taskId}, error=${msg}`);

      await this.updateStatus(taskId, 'failed', {
        logs: logLines.join('\n'),
        errorMessage: msg,
      });

      if (task.maxRetries > 0 && task.retryCount < task.maxRetries) {
        this.logger.log(`Scheduling auto-retry for task ${taskId} (${task.retryCount + 1}/${task.maxRetries})`);
        const retryDelay = Math.min(1000 * Math.pow(2, task.retryCount), 30000);
        setTimeout(() => {
          this.retry(taskId, task.createdBy ?? '').catch((retryErr: unknown) => {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            this.logger.error(`Auto-retry failed: taskId=${taskId}, error=${retryMsg}`);
          });
        }, retryDelay);
      }
    }
  }

  private toRecord(row: Record<string, unknown>): TaskQueueRecord {
    return {
      id: row.id as string,
      taskType: row.taskType as TaskQueueType,
      title: row.title as string,
      status: row.status as TaskQueueStatus,
      priority: row.priority as number,
      payload: row.payload as Record<string, unknown> | null,
      result: row.result as Record<string, unknown> | null,
      logs: row.logs as string | null,
      errorMessage: row.errorMessage as string | null,
      retryCount: row.retryCount as number,
      maxRetries: row.maxRetries as number,
      parentTaskId: row.parentTaskId as string | null,
      refType: row.refType as string | null,
      refId: row.refId as string | null,
      startedAt: row.startedAt ? new Date(row.startedAt as string).toISOString() : null,
      finishedAt: row.finishedAt ? new Date(row.finishedAt as string).toISOString() : null,
      createdBy: row.createdBy as string | null,
      createdAt: new Date(row.createdAt as string).toISOString(),
      updatedAt: new Date(row.updatedAt as string).toISOString(),
    };
  }
}
