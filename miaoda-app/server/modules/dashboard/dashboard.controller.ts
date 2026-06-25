import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import type {
  DashboardStatistics,
  RecentImportTask,
  RecentPublishTask,
  RecentUpdatedDoc,
} from '@shared/api.interface';

@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('statistics')
  async getStatistics(): Promise<DashboardStatistics> {
    return this.dashboardService.getStatistics();
  }

  @Get('recent-imports')
  async getRecentImports(
    @Query('limit') limit?: string,
  ): Promise<{ items: RecentImportTask[] }> {
    const parsedLimit: number = limit ? parseInt(limit, 10) : 10;
    return this.dashboardService.getRecentImports(parsedLimit);
  }

  @Get('recent-publishes')
  async getRecentPublishes(
    @Query('limit') limit?: string,
  ): Promise<{ items: RecentPublishTask[] }> {
    const parsedLimit: number = limit ? parseInt(limit, 10) : 10;
    return this.dashboardService.getRecentPublishes(parsedLimit);
  }

  @Get('recent-updated-docs')
  async getRecentUpdatedDocs(
    @Query('limit') limit?: string,
  ): Promise<{ items: RecentUpdatedDoc[] }> {
    const parsedLimit: number = limit ? parseInt(limit, 10) : 10;
    return this.dashboardService.getRecentUpdatedDocs(parsedLimit);
  }
}
