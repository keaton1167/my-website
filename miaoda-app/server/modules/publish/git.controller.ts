import { Controller, Post, Get, Req, Body, Param } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import { PublishService } from './publish.service';
import type { GitCommitResponse, BuildCheckLogResponse, WebsitePublishRequest, WebsitePublishResponse, PublishPipelineDetail } from '@shared/api.interface';

@Controller('api/git')
export class GitController {
  constructor(private readonly publishService: PublishService) {}

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('commit-push')
  async commitPush(
    @Req() req: Request,
    @Body() body: { scope?: string; mappingId?: string },
  ): Promise<GitCommitResponse> {
    const { userId } = req.userContext;
    return this.publishService.triggerGitCommit(userId, body?.scope, body?.mappingId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post(':taskId/retry-push')
  async retryPush(
    @Req() req: Request,
    @Param('taskId') taskId: string,
  ): Promise<GitCommitResponse> {
    const { userId } = req.userContext;
    return this.publishService.retryGitPush(taskId, userId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('publish-website')
  async publishWebsite(
    @Req() req: Request,
    @Body() body: WebsitePublishRequest,
  ): Promise<WebsitePublishResponse> {
    const { userId } = req.userContext;
    return this.publishService.triggerWebsitePublish(
      userId,
      body?.scope,
      body?.previewOnly,
      body?.buildScope,
      body?.forceConfig,
    );
  }

  @NeedLogin()
  @Get(':taskId/pipeline')
  async getPipeline(
    @Param('taskId') taskId: string,
  ): Promise<PublishPipelineDetail> {
    return this.publishService.getPublishDetail(taskId);
  }

  @NeedLogin()
  @Get(':taskId/logs')
  async getGitLogs(
    @Param('taskId') taskId: string,
  ): Promise<BuildCheckLogResponse> {
    return this.publishService.getBuildCheckLogs(taskId);
  }
}
