import type { FeishuSyncLogItem } from '@shared/api.interface';

export interface SyncLogsResult {
  items: FeishuSyncLogItem[];
  total: number;
}
