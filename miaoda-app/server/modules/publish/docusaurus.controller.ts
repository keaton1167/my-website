import { Controller, Post, Req, Body } from '@nestjs/common';
import type { Request } from 'express';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import { PublishService } from './publish.service';
import type { CreateResponse } from '@shared/api.interface';

@Controller('api/docusaurus')
export class DocusaurusController {
  constructor(private readonly publishService: PublishService) {}

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('build')
  async triggerBuild(
    @Req() req: Request,
    @Body() body: { publishScope?: string },
  ): Promise<CreateResponse> {
    const { userId } = req.userContext;
    return this.publishService.triggerBuild(userId, body?.publishScope);
  }
}
