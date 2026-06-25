import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { DocumentsService } from './documents.service';
import type {
  DocListParams,
  CreateDocRequest,
  UpdateDocRequest,
  MoveDocRequest,
  BatchActionRequest,
  PreviewPathParams,
} from '@shared/api.interface';

@Controller('api/documents')
export class DocumentsController implements OnModuleInit {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(private readonly documentsService: DocumentsService) {}

  async onModuleInit(): Promise<void> {
    await this.documentsService.backfillTranslationGroups();
  }

  @Get('statistics')
  async getStatistics() {
    this.logger.log('getStatistics');
    return this.documentsService.getStatistics();
  }

  @Get()
  async getList(@Query() query: DocListParams) {
    const page = query.page ? parseInt(String(query.page), 10) : 1;
    const pageSize = query.pageSize
      ? parseInt(String(query.pageSize), 10)
      : 20;
    this.logger.log(
      `getList page=${page}, pageSize=${pageSize}`,
    );
    return this.documentsService.getList({
      ...query,
      page,
      pageSize,
    });
  }

  @Get('preview-path')
  async previewPath(@Query() query: PreviewPathParams) {
    return this.documentsService.previewPath({
      language: query.language,
      firstCategory: query.firstCategory,
      secondCategory: query.secondCategory,
      slug: query.slug,
      excludeId: query.excludeId,
    });
  }

  @Get('scan-pptx-pollution')
  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  async scanPptxPollution() {
    this.logger.log('scanPptxPollution');
    return this.documentsService.scanPptxPollution();
  }

  @Get(':id')
  async getDetail(@Param('id') id: string) {
    return this.documentsService.getDetail(id);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post()
  async create(@Req() req: Request, @Body() body: CreateDocRequest) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`create by userId=${userId}, title=${body.title}`);
    return this.documentsService.create(body, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateDocRequest,
  ) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`update id=${id} by userId=${userId}`);
    return this.documentsService.update(id, body, userId);
  }

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Patch(':id/submit-review')
  async submitReview(@Req() req: Request, @Param('id') id: string) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`submitReview id=${id} by userId=${userId}`);
    return this.documentsService.submitReview(id, userId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post(':id/approve')
  async approve(@Req() req: Request, @Param('id') id: string) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`approve id=${id} by userId=${userId}`);
    return this.documentsService.approve(id, userId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post(':id/reject')
  async reject(@Req() req: Request, @Param('id') id: string) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`reject id=${id} by userId=${userId}`);
    return this.documentsService.reject(id, userId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post(':id/archive')
  async archive(@Req() req: Request, @Param('id') id: string) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`archive id=${id} by userId=${userId}`);
    return this.documentsService.archive(id, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`remove id=${id} by userId=${userId}`);
    return this.documentsService.remove(id);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Patch(':id/move')
  async move(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: MoveDocRequest,
  ) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(
      `move id=${id} to firstCategory=${body.firstCategory} by userId=${userId}`,
    );
    return this.documentsService.move(id, body, userId);
  }

  @CanRole(['super_admin', 'publish_admin', 'content_editor'])
  @NeedLogin()
  @Post('batch-submit-review')
  async batchSubmitReview(@Req() req: Request, @Body() body: BatchActionRequest) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`batchSubmitReview count=${body.ids.length} by userId=${userId}`);
    return this.documentsService.batchSubmitReview(body.ids, userId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('batch-approve')
  async batchApprove(@Req() req: Request, @Body() body: BatchActionRequest) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`batchApprove count=${body.ids.length} by userId=${userId}`);
    return this.documentsService.batchApprove(body.ids, userId);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('batch-reject')
  async batchReject(@Req() req: Request, @Body() body: BatchActionRequest) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`batchReject count=${body.ids.length} by userId=${userId}`);
    return this.documentsService.batchReject(body.ids, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('batch-move')
  async batchMove(@Req() req: Request, @Body() body: BatchActionRequest) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`batchMove count=${body.ids.length} by userId=${userId}`);
    return this.documentsService.batchMove(body, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('batch-delete')
  async batchDelete(@Req() req: Request, @Body() body: BatchActionRequest) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`batchDelete count=${body.ids.length} by userId=${userId}`);
    return this.documentsService.batchDelete(body.ids, userId);
  }

  @Post('clean-pptx-pollution')
  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  async cleanPptxPollution() {
    this.logger.log('cleanPptxPollution');
    return this.documentsService.cleanPptxPollution();
  }
}
