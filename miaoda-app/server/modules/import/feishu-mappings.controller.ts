import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Logger,
} from '@nestjs/common';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { FeishuMappingsService } from './feishu-mappings.service';
import type {
  FeishuMappingListParams,
  CreateFeishuMappingRequest,
  UpdateFeishuMappingRequest,
  BatchSyncRequest,
  BatchCreateFeishuMappingRequest,
  WikiDiagnoseRequest,
  WikiPreviewTreeRequest,
  WikiImportRequest,
  RepairImagesRequest,
} from '@shared/api.interface';

@Controller('api/feishu-doc-mappings')
export class FeishuMappingsController {
  private readonly logger = new Logger(FeishuMappingsController.name);

  constructor(private readonly feishuMappingsService: FeishuMappingsService) {}

  @Get('statistics')
  async getStatistics() {
    this.logger.log('getMappingStatistics');
    return this.feishuMappingsService.getStatistics();
  }

  @Get()
  async getList(@Query() query: FeishuMappingListParams) {
    const page = query.page ? parseInt(String(query.page), 10) : 1;
    const pageSize = query.pageSize
      ? parseInt(String(query.pageSize), 10)
      : 20;
    this.logger.log(`getMappingList page=${page}, pageSize=${pageSize}`);
    return this.feishuMappingsService.getList({ ...query, page, pageSize });
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('create')
  async create(
    @Req() req: Request,
    @Body() body: CreateFeishuMappingRequest,
  ) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(
      `createMapping by userId=${userId}, title=${body.helpCenterTitle}`,
    );
    return this.feishuMappingsService.create(body, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('batch-create')
  async batchCreate(
    @Req() req: Request,
    @Body() body: BatchCreateFeishuMappingRequest,
  ) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(
      `batchCreateMapping count=${body.items.length} by userId=${userId}`,
    );
    return this.feishuMappingsService.batchCreate(body.items, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('update')
  async update(
    @Req() req: Request,
    @Body() body: UpdateFeishuMappingRequest & { id: string },
  ) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`updateMapping id=${body.id} by userId=${userId}`);
    return this.feishuMappingsService.update(body.id, body, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('delete')
  async remove(@Req() req: Request, @Body() body: { id: string }) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`deleteMapping id=${body.id} by userId=${userId}`);
    return this.feishuMappingsService.remove(body.id);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('sync-one')
  async syncOne(@Req() req: Request, @Body() body: { id: string }) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`syncOne id=${body.id} by userId=${userId}`);
    return this.feishuMappingsService.syncOne(body.id, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('sync-batch')
  async syncBatch(@Req() req: Request, @Body() body: BatchSyncRequest) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(
      `syncBatch count=${body.ids.length} by userId=${userId}`,
    );
    return this.feishuMappingsService.syncBatch(body.ids, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('preview-markdown')
  async previewMarkdown(@Body() body: { id: string }) {
    this.logger.log(`previewMarkdown id=${body.id}`);
    return this.feishuMappingsService.previewMarkdown(body.id);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('check-drive-permission')
  async checkDrivePermission(@Body() body: { id: string }) {
    this.logger.log(`checkDrivePermission id=${body.id}`);
    return this.feishuMappingsService.checkDrivePermission(body.id);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('diagnose-blocks')
  async diagnoseBlocks(@Body() body: { id: string }) {
    this.logger.log(`diagnoseBlocks id=${body.id}`);
    return this.feishuMappingsService.diagnoseBlocks(body.id);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('retry-resources')
  async retryResources(@Body() body: { id: string }) {
    this.logger.log(`retryResources id=${body.id}`);
    return this.feishuMappingsService.retryResourceDownload(body.id);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Get('wiki/list-spaces')
  async wikiListSpaces() {
    this.logger.log('wikiListSpaces');
    return this.feishuMappingsService.wikiListSpaces();
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('wiki/diagnose')
  async wikiDiagnose(@Body() body: WikiDiagnoseRequest) {
    this.logger.log(`wikiDiagnose url=${body.wikiUrl?.slice(0, 60)}`);
    return this.feishuMappingsService.wikiDiagnose(body.wikiUrl);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('wiki/preview-tree')
  async wikiPreviewTree(@Body() body: WikiPreviewTreeRequest) {
    this.logger.log(`wikiPreviewTree url=${body.wikiUrl?.slice(0, 60)}`);
    return this.feishuMappingsService.wikiPreviewTree(body.wikiUrl);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('wiki/import')
  async wikiImport(
    @Req() req: Request,
    @Body() body: WikiImportRequest,
  ) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(
      `wikiImport count=${body.selectedNodes?.length} by userId=${userId}`,
    );
    return this.feishuMappingsService.wikiImport(body, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('repair-images')
  async repairImages(@Req() req: Request, @Body() body: RepairImagesRequest) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(
      `repairImages ids=${JSON.stringify(body.ids)} by userId=${userId}`,
    );
    return this.feishuMappingsService.repairMissingImages(body.ids);
  }

  @Get(':mappingId/logs')
  async getSyncLogs(@Param('mappingId') mappingId: string) {
    this.logger.log(`getSyncLogs mappingId=${mappingId}`);
    return this.feishuMappingsService.getSyncLogs(mappingId);
  }
}
