import { Controller, Post, Get, Req, Body, Param } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import { PublishService } from './publish.service';
import type {
  BuildCheckRequest,
  BuildCheckResponse,
  BuildCheckLogResponse,
} from '@shared/api.interface';

@Controller('api/help-center')
export class HelpCenterController {
  constructor(private readonly publishService: PublishService) {}

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('build-check')
  async triggerBuildCheck(
    @Req() req: Request,
    @Body() body: BuildCheckRequest,
  ): Promise<BuildCheckResponse> {
    const { userId } = req.userContext;
    return this.publishService.triggerBuildCheck(userId, body.scope);
  }

  @Get('build-check/:taskId/logs')
  async getBuildCheckLogs(
    @Param('taskId') taskId: string,
  ): Promise<BuildCheckLogResponse> {
    return this.publishService.getBuildCheckLogs(taskId);
  }
}
