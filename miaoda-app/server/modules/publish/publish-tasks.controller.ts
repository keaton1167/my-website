import { Controller, Get, Post, Query, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import { PublishService } from './publish.service';
import type {
  PublishTaskListParams,
  PublishTaskListResponse,
  PublishStatsResponse,
  TaskLogsResponse,
  TaskType,
  DeployEnvironment,
  TaskStatus,
} from '@shared/api.interface';

@Controller('api/publish-tasks')
export class PublishTasksController {
  constructor(private readonly publishService: PublishService) {}

  @Get('stats')
  async getStats(): Promise<PublishStatsResponse> {
    return this.publishService.getStats();
  }

  @Get()
  async getTaskList(
    @Query('taskType') taskType?: string,
    @Query('environment') environment?: string,
    @Query('status') status?: string,
    @Query('operator') operator?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<PublishTaskListResponse> {
    const params: PublishTaskListParams = {
      taskType: taskType as TaskType | undefined,
      environment: environment as DeployEnvironment | undefined,
      status: status as TaskStatus | undefined,
      operator: operator || undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    };
    return this.publishService.getTaskList(params);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post(':taskId/retry')
  async retryTask(
    @Param('taskId') taskId: string,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const { userId } = req.userContext;
    return this.publishService.retryTask(taskId, userId);
  }
}
