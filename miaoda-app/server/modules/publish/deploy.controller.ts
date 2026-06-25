import { Controller, Post, Get, Req, Res, Body, Query, Logger, ConflictException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { existsSync, statSync } from 'fs';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import { PublishService } from './publish.service';
import type { CreateResponse, CreateRollbackRequest, StagingPreCheckResponse, ProductionPreCheckResponse, RollbackVersionsResponse, BuildScope } from '@shared/api.interface';

@Controller('api/deploy')
export class DeployController {
  private readonly logger = new Logger(DeployController.name);

  constructor(private readonly publishService: PublishService) {}

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Get('staging/precheck')
  async precheckStaging(): Promise<StagingPreCheckResponse> {
    return this.publishService.precheckStaging();
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('staging')
  async deployStaging(
    @Req() req: Request,
    @Body() body: { publishScope?: string },
  ): Promise<CreateResponse> {
    const { userId } = req.userContext;
    return this.publishService.deployStaging(userId, body?.publishScope);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Get('production/precheck')
  async precheckProduction(): Promise<ProductionPreCheckResponse> {
    return this.publishService.precheckProduction();
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('production')
  async deployProduction(
    @Req() req: Request,
    @Body() body: { publishScope?: string },
  ): Promise<CreateResponse> {
    const { userId } = req.userContext;
    return this.publishService.deployProduction(userId, body?.publishScope);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Get('rollback/versions')
  async getRollbackVersions(): Promise<RollbackVersionsResponse> {
    return this.publishService.getRollbackVersions();
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('rollback')
  async rollback(
    @Req() req: Request,
    @Body() body: CreateRollbackRequest,
  ): Promise<CreateResponse> {
    const { userId } = req.userContext;
    return this.publishService.rollback(
      userId,
      body.environment,
      body.versionTaskId,
      body.reason,
      body.publishScope,
    );
  }

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Post('draft-preview')
  async deployDraftPreview(@Req() req: Request): Promise<CreateResponse> {
    const { userId } = req.userContext;
    return this.publishService.deployDraftPreview(userId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('build-artifact')
  async buildArtifact(@Req() req: Request, @Body() body: { scope?: BuildScope }): Promise<CreateResponse> {
    const { userId } = req.userContext;
    return this.publishService.buildArtifact(userId, body?.scope);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Get('build-artifact/storage-url')
  async getBuildArtifactStorageUrl(
    @Query('taskId') taskId: string | undefined,
  ): Promise<{ downloadUrl: string }> {
    return this.publishService.uploadBuildArtifactToStorage(taskId || undefined);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Get('build-artifact/download')
  async downloadBuildArtifact(
    @Req() req: Request,
    @Query('taskId') taskId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const cookieHeader = req.headers.cookie;
    this.logger.log(`downloadBuildArtifact request: taskId=${taskId || 'latest'}, hasCookie=${!!cookieHeader}, cookieLength=${cookieHeader?.length || 0}, userAgent=${req.headers['user-agent'] || 'N/A'}, range=${req.headers.range || 'none'}`);
    try {
      const result = await this.publishService.downloadBuildArtifact(taskId || undefined);
      const fileExists = existsSync(result.filePath);
      const fileSize = fileExists ? statSync(result.filePath).size : 0;
      this.logger.log(`downloadBuildArtifact: zipPath=${result.filePath}, existsSync=${fileExists}, stat.size=${fileSize}, sending file...`);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      res.sendFile(result.filePath, (err: Error | null) => {
        if (err) {
          this.logger.error(`downloadBuildArtifact sendFile error: code=${(err as NodeJS.ErrnoException).code}, message=${err.message}, headersSent=${res.headersSent}`);
        } else {
          this.logger.log(`downloadBuildArtifact: sendFile completed successfully`);
        }
      });
    } catch (err) {
      if (err instanceof ConflictException && err.message === 'BUILD_ARTIFACT_FILE_NOT_FOUND') {
        this.logger.warn(`downloadBuildArtifact: file not found for taskId=${taskId || 'latest'}`);
        res.status(410).json({ error: '构建包文件已失效，请重新生成 build 包' });
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`downloadBuildArtifact error: ${errMsg}`);
        res.status(500).json({ error: errMsg });
      }
    }
  }

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Get('running-tasks')
  getRunningTasks(): string[] {
    return this.publishService.getRunningTaskTypes();
  }
}
