import React from 'react';
import { Badge } from '@client/src/components/ui/badge';
import type { SyncMode, SyncStatus } from '@shared/api.interface';

export const SYNC_MODE_OPTIONS: SyncMode[] = ['手动同步', '定时同步', '事件触发同步'];
export const SYNC_STATUS_OPTIONS: SyncStatus[] = ['未同步', '同步中', '同步成功', '同步失败', '已暂停'];

const SYNC_STATUS_STYLE: Record<SyncStatus, string> = {
  未同步: 'bg-muted text-muted-foreground border-border',
  同步中: 'bg-primary/10 text-primary border-primary/20',
  同步成功: 'bg-success/10 text-success border-success/20',
  同步失败: 'bg-destructive/10 text-destructive border-destructive/20',
  已暂停: 'bg-warning/10 text-warning border-warning/20',
};

const SYNC_MODE_STYLE: Record<SyncMode, string> = {
  手动同步: 'bg-muted text-muted-foreground border-border',
  定时同步: 'bg-primary/10 text-primary border-primary/20',
  事件触发同步: 'bg-warning/10 text-warning border-warning/20',
};

const TRANSLATION_STATUS_STYLE: Record<string, string> = {
  '仅中文': 'bg-primary/10 text-primary border-primary/20',
  '仅英文': 'bg-success/10 text-success border-success/20',
  '中英文完整': 'bg-success/10 text-success border-success/20',
  '英文待更新': 'bg-warning/10 text-warning border-warning/20',
};

const LANG_LABELS: Record<string, string> = { 'zh-CN': '中文', en: '英文' };
const LANG_STYLE: Record<string, string> = {
  'zh-CN': 'bg-primary/10 text-primary border-primary/20',
  en: 'bg-success/10 text-success border-success/20',
};

export function LanguageBadge({ language }: { language: string }) {
  const label = LANG_LABELS[language] ?? '中文';
  const style = LANG_STYLE[language] ?? LANG_STYLE['zh-CN'];
  return <Badge variant="outline" className={style}>{label}</Badge>;
}

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  return <Badge variant="outline" className={SYNC_STATUS_STYLE[status]}>{status}</Badge>;
}

export function TranslationStatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-muted-foreground">-</span>;
  return <Badge variant="outline" className={TRANSLATION_STATUS_STYLE[status] ?? 'bg-muted text-muted-foreground'}>{status}</Badge>;
}

export function SyncModeBadge({ mode }: { mode: SyncMode }) {
  return <Badge variant="outline" className={SYNC_MODE_STYLE[mode]}>{mode}</Badge>;
}

export const formatDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
