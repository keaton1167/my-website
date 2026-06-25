import { request } from '@client/src/api';
import type { DashboardStatistics, RecentImportTask, RecentPublishTask, RecentUpdatedDoc } from '@shared/api.interface';

export async function getStatistics(): Promise<DashboardStatistics> {
  return request<DashboardStatistics>({ url: '/api/dashboard/statistics', method: 'GET' });
}

export async function getRecentImports(limit: number = 10): Promise<{ items: RecentImportTask[] }> {
  return request<{ items: RecentImportTask[] }>({ url: '/api/dashboard/recent-imports', method: 'GET', params: { limit } });
}

export async function getRecentPublishes(limit: number = 10): Promise<{ items: RecentPublishTask[] }> {
  return request<{ items: RecentPublishTask[] }>({ url: '/api/dashboard/recent-publishes', method: 'GET', params: { limit } });
}

export async function getRecentUpdatedDocs(limit: number = 10): Promise<{ items: RecentUpdatedDoc[] }> {
  return request<{ items: RecentUpdatedDoc[] }>({ url: '/api/dashboard/recent-updated-docs', method: 'GET', params: { limit } });
}
