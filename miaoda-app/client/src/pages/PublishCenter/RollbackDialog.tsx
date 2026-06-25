import React, { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Undo2, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@client/src/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Textarea } from '@client/src/components/ui/textarea';
import { Label } from '@client/src/components/ui/label';
import { Button } from '@client/src/components/ui/button';
import { publishApi } from '@client/src/api';
import type { PublishTaskItem, DeployEnvironment, PublishScope, RollbackVersionItem } from '@shared/api.interface';
import dayjs from 'dayjs';

const ENV_TASK_TYPE_MAP: Record<string, string> = {
  '测试环境': '预览环境发布',
  '正式环境': '正式发布',
};

interface RollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  publishScope?: PublishScope;
}

const RollbackDialog: React.FC<RollbackDialogProps> = ({
  open,
  onOpenChange,
  onSuccess,
  publishScope,
}) => {
  const [environment, setEnvironment] = useState<DeployEnvironment | ''>('');
  const [versionTaskId, setVersionTaskId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [stagingVersions, setStagingVersions] = useState<PublishTaskItem[]>([]);
  const [productionVersions, setProductionVersions] = useState<RollbackVersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState<boolean>(false);
  const [submitLoading, setSubmitLoading] = useState<boolean>(false);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);

  const fetchVersions = useCallback(async (env: DeployEnvironment) => {
    setVersionsLoading(true);
    try {
      if (env === '正式环境') {
        const result = await publishApi.getRollbackVersions();
        setProductionVersions(result.items);
        setStagingVersions([]);
      } else {
        const result = await publishApi.getPublishTaskList({
          taskType: ENV_TASK_TYPE_MAP[env] as PublishTaskItem['taskType'],
          status: '成功',
          environment: env,
          page: 1,
          pageSize: 50,
        });
        setStagingVersions(result.items);
        setProductionVersions([]);
      }
    } catch {
      toast.error('获取历史版本失败');
      setStagingVersions([]);
      setProductionVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && environment) {
      fetchVersions(environment as DeployEnvironment);
    }
  }, [open, environment, fetchVersions]);

  const handleEnvironmentChange = (val: string) => {
    setEnvironment(val as DeployEnvironment);
    setVersionTaskId('');
    setStagingVersions([]);
    setProductionVersions([]);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setEnvironment('');
      setVersionTaskId('');
      setReason('');
      setStagingVersions([]);
      setProductionVersions([]);
      setConfirmOpen(false);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    if (!environment || !versionTaskId || !reason.trim()) return;
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setSubmitLoading(true);
    try {
      await publishApi.rollback({
        environment: environment as DeployEnvironment,
        versionTaskId,
        reason: reason.trim(),
        publishScope,
      });
      toast.success('恢复任务已创建');
      setConfirmOpen(false);
      handleOpenChange(false);
      onSuccess();
    } catch {
      toast.error('创建恢复任务失败');
    } finally {
      setSubmitLoading(false);
    }
  };

  const isProduction = environment === '正式环境';
  const hasVersions = isProduction ? productionVersions.length > 0 : stagingVersions.length > 0;
  const canSubmit = !!environment && !!versionTaskId && !!reason.trim() && hasVersions;

  const selectedProductionVersion = productionVersions.find(
    (v: RollbackVersionItem) => v.versionId === versionTaskId,
  );
  const selectedStagingVersion = stagingVersions.find(
    (v: PublishTaskItem) => v.id === versionTaskId,
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="size-4" />
              恢复历史版本
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>恢复环境</Label>
              <Select
                value={environment}
                onValueChange={handleEnvironmentChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择恢复环境" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="测试环境">预览环境</SelectItem>
                  <SelectItem value="正式环境">正式发布</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>历史版本</Label>
              {environment ? (
                versionsLoading ? (
                  <div className="flex items-center h-9 px-3 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 mr-2 animate-spin" />
                    加载中...
                  </div>
                ) : !hasVersions ? (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground text-center">
                    {isProduction
                      ? '暂无可恢复版本（首次发布后需再发布一次才能生成备份）'
                      : '暂无可恢复的成功发布版本'}
                  </div>
                ) : isProduction ? (
                  <div className="space-y-2">
                    <Select value={versionTaskId} onValueChange={setVersionTaskId}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择历史版本" />
                      </SelectTrigger>
                      <SelectContent>
                        {productionVersions.map((v: RollbackVersionItem) => (
                          <SelectItem key={v.versionId} value={v.versionId}>
                            {v.sourceTaskName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedProductionVersion && (
                      <div className="rounded-md bg-muted/50 p-3 space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">版本标识</span>
                          <span className="font-mono">{selectedProductionVersion.commitHash}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">发布时间</span>
                          <span>{dayjs(selectedProductionVersion.deployedAt).format('YYYY-MM-DD HH:mm:ss')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">文件数量</span>
                          <span>{selectedProductionVersion.fileCount} 个</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">总大小</span>
                          <span>{selectedProductionVersion.totalSize}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">来源任务</span>
                          <span className="truncate ml-2">{selectedProductionVersion.sourceTaskName}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <Select value={versionTaskId} onValueChange={setVersionTaskId}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择历史版本" />
                    </SelectTrigger>
                    <SelectContent>
                      {stagingVersions.map((v: PublishTaskItem) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.taskName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              ) : (
                <div className="text-sm text-muted-foreground">请先选择恢复环境</div>
              )}
            </div>

            <div className="space-y-2">
              <Label>恢复原因 <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="请说明恢复原因..."
                value={reason}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitLoading}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={handleSubmit}
                disabled={!canSubmit || submitLoading}
              >
                <Undo2 className="size-4 mr-2" />
                确认恢复
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              确认恢复操作
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>恢复会覆盖当前{environment}内容，请确认已选择正确版本。</p>
                {selectedProductionVersion && (
                  <div className="rounded-md bg-muted/50 p-2.5 text-xs space-y-1">
                    <p>恢复版本：<span className="font-medium text-foreground">{selectedProductionVersion.sourceTaskName}</span></p>
                    <p>版本标识：<span className="font-mono">{selectedProductionVersion.commitHash}</span></p>
                    <p>发布时间：{dayjs(selectedProductionVersion.deployedAt).format('YYYY-MM-DD HH:mm:ss')}</p>
                    <p>文件数量：{selectedProductionVersion.fileCount} 个 / {selectedProductionVersion.totalSize}</p>
                  </div>
                )}
                {selectedStagingVersion && (
                  <p className="text-sm">
                    恢复版本：<span className="font-medium text-foreground">{selectedStagingVersion.taskName}</span>
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={submitLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {submitLoading && <Loader2 className="size-4 animate-spin mr-2" />}
              确认恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default RollbackDialog;
