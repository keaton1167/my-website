import {
  Controller,
  Post,
  Body,
  Req,
  HttpStatus,
} from '@nestjs/common';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import { ImportService } from './import.service';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import { ResponseCode } from '@server/common/constants/api_response_code';
import type { ImportFeishuRequest, ImportFeishuResponse } from '@shared/api.interface';

@Controller('api/import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @CanRole(['super_admin', 'content_editor'])
  @NeedLogin()
  @Post('feishu-doc')
  async importFeishuDoc(
    @Req() req: Request & { userContext: { userId: string } },
    @Body() body: ImportFeishuRequest,
  ): Promise<ImportFeishuResponse> {
    const { userId } = req.userContext;

    if (!body.sourceUrl) {
      throw new BusinessException(
        ResponseCode.BAD_REQUEST,
        '飞书文档链接不能为空',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.title) {
      throw new BusinessException(
        ResponseCode.BAD_REQUEST,
        '文档标题不能为空',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.slug) {
      throw new BusinessException(
        ResponseCode.BAD_REQUEST,
        '英文路径标识不能为空',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.targetFirstCategory) {
      throw new BusinessException(
        ResponseCode.BAD_REQUEST,
        '目标一级目录不能为空',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.owner) {
      throw new BusinessException(
        ResponseCode.BAD_REQUEST,
        '负责人不能为空',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.importService.importFeishuDoc(body, userId);
  }
}
