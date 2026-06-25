import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, XCircle, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { UserDisplay } from '@client/src/components/business-ui/user-display';
import { feishuMappingsApi } from '@client/src/api';
import type { FeishuDocMapping, FeishuSyncLogItem, SyncStatus } from '@shared/api.interface';

const LANGUAGE_LABELS: Record<string, string> = { 'zh-CN': '中文', en: '英文' };

const STATUS_LABEL: Record<string, string> = {
  未同步: '未同步',
  同步中: '同步中',
  同步成功: '同步成功',
  同步失败: '同步失败',
  已暂停: '已暂停',
};

const STATUS_STYLE: Record<string, string> = {
  未同步: 'bg-muted text-muted-foreground border-border',
  同步中: 'bg-primary/10 text-primary border-primary/20',
  同步成功: 'bg-success/10 text-success border-success/20',
  同步失败: 'bg-destructive/10 text-destructive border-destructive/20',
  已暂停: 'bg-warning/10 text-warning border-warning/20',
};

const formatLogDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

interface SyncLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapping: FeishuDocMapping | null;
  onResync: (id: string) => void;
}

const SyncLogDialog: React.FC<SyncLogDialogProps> = ({
  open,
  onOpenChange,
  mapping,
  onResync,
}) => {
  const [logs, setLogs] = useState<FeishuSyncLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const status = mapping?.syncStatus ?? '未同步';

  useEffect(() => {
    if (!mapping || !open) { setLogs([]); return; }
    setLogsLoading(true);
    feishuMappingsApi.getSyncLogs(mapping.id)
      .then((res: { items: FeishuSyncLogItem[] }) => setLogs(res.items))
      .catch(() => setLogs([]))
      .finally(() => setLogsLoading(false));
  }, [mapping, open]);

  const renderTimeline = () => {
    if (status === '未同步') {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Clock className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">该映射尚未执行同步，暂无日志。</p>
        </div>
      );
    }
    if (status === '同步中') {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mb-3 h-10 w-10 animate-spin opacity-40" />
          <p className="text-sm">同步任务正在执行中，请稍后刷新查看结果。</p>
        </div>
      );
    }
    if (status === '已暂停') {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Clock className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">该映射已暂停同步，暂无新的同步任务。</p>
        </div>
      );
    }
    if (logs.length === 0 && !logsLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <AlertCircle className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">暂无同步日志记录</p>
        </div>
      );
    }
    if (logsLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mb-3 h-10 w-10 animate-spin opacity-40" />
          <p className="text-sm">正在加载同步日志...</p>
        </div>
      );
    }
    const latestLog = logs[0];
    const isSuccess = latestLog?.status === '同步成功' || status === '同步成功';
    const isFileWriteFail = latestLog?.errorMessage?.startsWith('[文件写入]');
    const isCategoryFail = latestLog?.errorMessage?.startsWith('[目录文件]');
    const filePath = mapping?.helpCenterFilePath || '';
    const steps = [
      '开始同步',
      '已拉取飞书文档内容',
      '已转换为 Markdown',
      '已写入帮助中心文档',
      filePath ? `已生成目录文件` : '已生成目录文件',
      filePath ? `已写入 Markdown 文件: ${filePath}` : '已写入 Markdown 文件',
      isSuccess
        ? '同步成功'
        : isCategoryFail
          ? '目录文件生成失败'
          : isFileWriteFail
            ? '文件写入失败'
            : '同步失败',
    ];
    return (
      <div className="relative pl-6 space-y-0">
        {steps.map((step: string, i: number) => {
          const isLast = i === steps.length - 1;
          const isFailStep = step === '同步失败' || step === '文件写入失败' || step === '目录文件生成失败';
          const iconColor = isFailStep ? 'text-destructive' : isLast && isSuccess ? 'text-success' : 'text-primary';
          const Icon = isFailStep ? XCircle : isSuccess && isLast ? CheckCircle2 : RefreshCw;
          return (
            <div key={i} className="relative flex items-start gap-3 pb-4 last:pb-0">
              {!isLast && (
                <div className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-border" />
              )}
              <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${iconColor}`} />
              <span className={`text-sm leading-6 ${isLast ? 'font-medium' : ''} ${isFailStep ? 'text-destructive font-medium' : isLast && isSuccess ? 'text-success' : 'text-foreground'}`}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const latestLog = logs.length > 0 ? logs[0] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>同步日志 - {mapping?.helpCenterTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            <div>
              <span className="text-muted-foreground">飞书文档标题</span>
              <p className="mt-0.5 font-medium truncate">{mapping?.feishuDocTitle || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">帮助中心文档标题</span>
              <p className="mt-0.5 font-medium truncate">{mapping?.helpCenterTitle || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">同步方式</span>
              <p className="mt-0.5">{mapping?.syncMode || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">当前同步状态</span>
              <p className="mt-0.5">
                <Badge variant="outline" className={STATUS_STYLE[status]}>
                  {STATUS_LABEL[status]}
                </Badge>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">上次同步时间</span>
              <p className="mt-0.5">{formatLogDate(mapping?.lastSyncAt ?? '')}</p>
            </div>
            <div>
              <span className="text-muted-foreground">上次同步人</span>
              <p className="mt-0.5">{mapping?.lastSyncBy ? <UserDisplay value={[mapping.lastSyncBy]} size="small" /> : '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">负责人</span>
              <p className="mt-0.5">{mapping?.owner ? <UserDisplay value={[mapping.owner]} size="small" /> : '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">语言版本</span>
              <p className="mt-0.5">
                <Badge variant="outline" className={mapping?.language === 'en' ? 'bg-success/10 text-success border-success/20' : 'bg-primary/10 text-primary border-primary/20'}>
                  {LANGUAGE_LABELS[mapping?.language ?? 'zh-CN'] ?? '中文'}
                </Badge>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">翻译组 ID</span>
              <p className="mt-0.5 font-mono text-xs truncate" title={mapping?.translationGroupId || '-'}>
                {mapping?.translationGroupId ? `${mapping.translationGroupId.slice(0, 8)}...` : '-'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">翻译组状态</span>
              <p className="mt-0.5">
                {mapping?.translationStatus ? (
                  <Badge variant="outline" className={
                    mapping.translationStatus === '中英文完整' ? 'bg-success/10 text-success border-success/20' :
                    mapping.translationStatus === '英文待更新' ? 'bg-warning/10 text-warning border-warning/20' :
                    mapping.translationStatus === '仅英文' ? 'bg-success/10 text-success border-success/20' :
                    'bg-primary/10 text-primary border-primary/20'
                  }>
                    {mapping.translationStatus}
                  </Badge>
                ) : '-'}
              </p>
            </div>
          </div>
          {latestLog?.errorMessage && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span className="font-medium">失败原因：</span>{latestLog.errorMessage}
            </div>
          )}
          {latestLog?.buildCheckStatus && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">构建检查：</span>
              <Badge variant="outline" className={
                latestLog.buildCheckStatus === '成功' ? 'bg-success/10 text-success border-success/20' :
                latestLog.buildCheckStatus === '失败' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                'bg-muted text-muted-foreground border-border'
              }>
                {latestLog.buildCheckStatus}
              </Badge>
            </div>
          )}
          <div>
            <p className="mb-3 text-sm font-medium text-muted-foreground">同步步骤</p>
            {renderTimeline()}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button
            disabled={status === '同步中'}
            onClick={() => { if (mapping) onResync(mapping.id); }}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            重新同步
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SyncLogDialog;
