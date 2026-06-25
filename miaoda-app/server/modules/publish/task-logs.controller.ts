import { Controller, Get, Param } from '@nestjs/common';
import { PublishService } from './publish.service';
import type { TaskLogsResponse } from '@shared/api.interface';

@Controller('api/tasks')
export class TaskLogsController {
  constructor(private readonly publishService: PublishService) {}

  @Get(':taskId/logs')
  async getTaskLogs(@Param('taskId') taskId: string): Promise<TaskLogsResponse> {
    return this.publishService.getTaskLogs(taskId);
  }
}
