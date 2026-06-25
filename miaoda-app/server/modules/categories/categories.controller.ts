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
} from '@nestjs/common';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { CategoriesService } from './categories.service';
import type {
  CategoryListParams,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  ToggleCategoryStatusRequest,
  UpdateCategoryOrderRequest,
} from '@shared/api.interface';

@Controller('api/categories')
export class CategoriesController {
  private readonly logger = new Logger(CategoriesController.name);

  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async getList(@Query() query: CategoryListParams) {
    const page = query.page ? parseInt(String(query.page), 10) : 1;
    const pageSize = query.pageSize ? parseInt(String(query.pageSize), 10) : 20;
    this.logger.log(`getList page=${page}, pageSize=${pageSize}`);
    return this.categoriesService.getList({ page, pageSize });
  }

  @Get('options')
  async getOptions(@Query('enabled') enabled?: string) {
    const enabledBool =
      enabled !== undefined ? enabled === 'true' : undefined;
    this.logger.log(`getOptions enabled=${enabledBool}`);
    return this.categoriesService.getOptions(enabledBool);
  }

  @Get(':id/dependencies')
  async checkDependencies(@Param('id') id: string) {
    this.logger.log(`checkDependencies id=${id}`);
    return this.categoriesService.checkDependencies(id);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post()
  async create(@Req() req: Request, @Body() body: CreateCategoryRequest) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`create by userId=${userId}, nameCn=${body.nameCn}`);
    return this.categoriesService.create(body, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateCategoryRequest,
  ) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`update id=${id} by userId=${userId}`);
    return this.categoriesService.update(id, body, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Patch(':id/toggle-status')
  async toggleStatus(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ToggleCategoryStatusRequest,
  ) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(
      `toggleStatus id=${id} enabled=${body.enabled} by userId=${userId}`,
    );
    return this.categoriesService.toggleStatus(id, body, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Patch(':id/update-order')
  async updateOrder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateCategoryOrderRequest,
  ) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(
      `updateOrder id=${id} order=${body.order} by userId=${userId}`,
    );
    return this.categoriesService.updateOrder(id, body, userId);
  }

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const userId: string = req.userContext?.userId ?? '';
    this.logger.log(`remove id=${id} by userId=${userId}`);
    return this.categoriesService.remove(id);
  }
}
