import React, { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Loader2, AlertTriangle, ShieldCheck, Download, RefreshCw, Info } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { feishuMappingsApi } from '@client/src/api';
import type { DrivePermissionCheckResponse, DrivePermissionCheckItem, DrivePermissionDebugInfo, FeishuDocMapping } from '@shared/api.interface';

interface DrivePermissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapping: FeishuDocMapping | null;
  onRetryComplete: () => void;
}

const CHECK_ITEMS: { key: keyof DrivePermissionCheckResponse; label: string; icon: React.ElementType }[] = [
  { key: 'credential', label: '飞书应用凭证', icon: ShieldCheck },
  { key: 'docRead', label: '文档读取权限', icon: ShieldCheck },
  { key: 'resourceDownload', label: '资源下载权限 (drive:drive:readonly)', icon: Download },
];

function CheckItemRow({ item, label, icon: Icon }: { item: DrivePermissionCheckItem; label: string; icon: React.ElementType }) {
  return (
    <div className="flex items-start gap-3 rounded-md border px-3 py-2.5">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${item.ok ? 'text-success' : 'text-destructive'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {item.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-destructive" />
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground break-words">{item.message}</p>
        {!item.ok && item.suggestion && (
          <div className="mt-1.5 rounded bg-warning/10 px-2 py-1 text-xs text-warning break-words whitespace-pre-wrap">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            {item.suggestion}
          </div>
        )}
        {item.apiCode !== undefined && (
          <p className="mt-1 text-xs text-muted-foreground">API 错误码: {item.apiCode}</p>
        )}
      </div>
    </div>
  );
}

function SubResultRow({ label, item }: { label: string; item: DrivePermissionCheckItem }) {
  return (
    <div className="ml-7 flex items-start gap-2 rounded border border-dashed px-2.5 py-2">
      {item.ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium">{label}</span>
        <p className="mt-0.5 text-xs text-muted-foreground break-words">{item.message}</p>
        {!item.ok && item.suggestion && (
          <div className="mt-1 rounded bg-warning/10 px-2 py-1 text-xs text-warning break-words whitespace-pre-wrap">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            {item.suggestion}
          </div>
        )}
      </div>
    </div>
  );
}

function DebugInfoPanel({ info }: { info: DrivePermissionDebugInfo }) {
  return (
    <div className="ml-7 mt-1.5 rounded border bg-muted/30 px-2.5 py-2 space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Info className="h-3 w-3" />
        诊断详情
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">API:</span>
        <span className="font-mono break-all">{info.endpoint}</span>
        <span className="text-muted-foreground">Token:</span>
        <span className="font-mono">{info.tokenType}</span>
        {info.httpStatus !== undefined && (
          <>
            <span className="text-muted-foreground">HTTP:</span>
            <span className={`font-mono ${info.httpStatus >= 400 ? 'text-destructive' : 'text-success'}`}>{info.httpStatus}</span>
          </>
        )}
        {info.diagnosis && (
          <>
            <span className="text-muted-foreground">结论:</span>
            <span className="font-medium">{info.diagnosis}</span>
          </>
        )}
        {info.responseHeaders && Object.keys(info.responseHeaders).length > 0 && (
          <>
            <span className="text-muted-foreground">Trace:</span>
            <span className="font-mono break-all text-muted-foreground">
              {info.responseHeaders['x-tt-logid'] || info.responseHeaders['x-request-id'] || '-'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

const DrivePermissionDialog: React.FC<DrivePermissionDialogProps> = ({
  open,
  onOpenChange,
  mapping,
  onRetryComplete,
}) => {
  const [checkResult, setCheckResult] = useState<DrivePermissionCheckResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const handleCheck = async () => {
    if (!mapping) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await feishuMappingsApi.checkDrivePermission(mapping.id);
      setCheckResult(result);
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error(`权限诊断失败: ${e.message ?? '未知错误'}`);
    } finally {
      setChecking(false);
    }
  };

  const handleRetry = async () => {
    if (!mapping) return;
    setRetrying(true);
    try {
      const result = await feishuMappingsApi.retryResources(mapping.id);
      if (result.success) {
        toast.success(`资源重试完成: 图片 ${result.imagesSuccess}/${result.imagesRetried}, 附件 ${result.attachmentsSuccess}/${result.attachmentsRetried}`);
        onRetryComplete();
        onOpenChange(false);
      } else {
        toast.error(`资源重试失败: ${result.errorMessage ?? '未知错误'}`);
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error(`资源重试失败: ${e.message ?? '未知错误'}`);
    } finally {
      setRetrying(false);
    }
  };

  const allPassed = checkResult
    ? checkResult.credential.ok && checkResult.docRead.ok && checkResult.resourceDownload.ok
    : false;

  const rd = checkResult?.resourceDownload;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>权限诊断与资源重试 - {mapping?.helpCenterTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>飞书文档:</span>
            <span className="font-medium text-foreground truncate">{mapping?.feishuDocTitle || mapping?.helpCenterTitle || '-'}</span>
          </div>

          {!checkResult && !checking && (
            <div className="flex flex-col items-center py-8 text-muted-foreground">
              <ShieldCheck className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-sm mb-4">点击「开始诊断」检查飞书应用的下载权限状态</p>
              <Button onClick={handleCheck}>
                <ShieldCheck className="mr-1.5 h-4 w-4" />
                开始诊断
              </Button>
            </div>
          )}

          {checking && (
            <div className="flex flex-col items-center py-8 text-muted-foreground">
              <Loader2 className="mb-3 h-10 w-10 animate-spin opacity-40" />
              <p className="text-sm">正在检查权限状态...</p>
            </div>
          )}

          {checkResult && !checking && (
            <div className="space-y-3">
              <CheckItemRow
                item={checkResult.credential}
                label="飞书应用凭证"
                icon={ShieldCheck}
              />
              <CheckItemRow
                item={checkResult.docRead}
                label="文档读取权限"
                icon={ShieldCheck}
              />
              <CheckItemRow
                item={checkResult.resourceDownload}
                label="资源下载权限 (drive:drive:readonly)"
                icon={Download}
              />

              {rd?.imageResult && (
                <SubResultRow label="图片下载" item={rd.imageResult} />
              )}
              {rd?.attachmentResult && (
                <SubResultRow label="附件下载" item={rd.attachmentResult} />
              )}
              {rd?.debugInfo && (
                <DebugInfoPanel info={rd.debugInfo} />
              )}

              {allPassed && (
                <div className="rounded-md border border-success/20 bg-success/5 px-3 py-2 text-sm text-success">
                  <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
                  所有权限检测通过，可以尝试重新下载资源
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <div>
            {checkResult && (
              <Button variant="outline" size="sm" onClick={handleCheck} disabled={checking}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                重新诊断
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
            <Button
              onClick={handleRetry}
              disabled={retrying || (checkResult !== null && !allPassed)}
            >
              {retrying ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" />
              )}
              重试资源下载
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DrivePermissionDialog;
