import { Controller, Get, Post, Put, Query, Param, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import { TaskQueueService } from './task-queue.service';
import type {
  TaskQueueType,
  TaskQueueStatus,
  TaskQueueListResponse,
  EnqueueRequest,
  EnqueueResponse,
  TaskQueueRecord,
  CreateResponse,
  SuccessResponse,
} from '@shared/api.interface';

@Controller('api/task-queue')
export class TaskQueueController {
  constructor(private readonly taskQueueService: TaskQueueService) {}

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Get()
  async list(
    @Query('taskType') taskType?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<TaskQueueListResponse> {
    return this.taskQueueService.list({
      taskType: taskType as TaskQueueType | undefined,
      status: status as TaskQueueStatus | undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Get(':taskId')
  async getStatus(
    @Param('taskId') taskId: string,
  ): Promise<TaskQueueRecord | null> {
    return this.taskQueueService.getStatus(taskId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post()
  async enqueue(
    @Body() body: EnqueueRequest,
    @Req() req: Request,
  ): Promise<EnqueueResponse> {
    const { userId } = req.userContext;
    return this.taskQueueService.enqueue(body, userId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Put(':taskId/retry')
  async retry(
    @Param('taskId') taskId: string,
    @Req() req: Request,
  ): Promise<CreateResponse> {
    const { userId } = req.userContext;
    return this.taskQueueService.retry(taskId, userId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Put(':taskId/cancel')
  async cancel(
    @Param('taskId') taskId: string,
  ): Promise<SuccessResponse> {
    await this.taskQueueService.cancel(taskId);
    return { success: true };
  }
}
