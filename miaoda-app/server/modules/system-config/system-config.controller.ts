import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import { SystemConfigService } from './system-config.service';
import type {
  SystemConfigResponse,
  UpdateSystemConfigRequest,
  CheckConnectionRequest,
  CheckConnectionResponse,
} from '@shared/api.interface';

@Controller('api/system-config')
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  async getConfig(): Promise<SystemConfigResponse> {
    return this.systemConfigService.getConfig();
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Patch()
  async updateConfig(
    @Body() dto: UpdateSystemConfigRequest,
  ): Promise<{ success: boolean; message: string }> {
    return this.systemConfigService.updateConfig(dto);
  }

  @CanRole(['super_admin', 'publish_admin'])
  @NeedLogin()
  @Post('check-connection')
  async checkConnection(
    @Body() dto: CheckConnectionRequest,
  ): Promise<CheckConnectionResponse> {
    return this.systemConfigService.checkConnection(dto);
  }
}
