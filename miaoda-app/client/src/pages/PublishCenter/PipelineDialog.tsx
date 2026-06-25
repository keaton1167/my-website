import React from 'react';
import {
  CheckCircle,
  Circle,
  XCircle,
  Loader2,
  ExternalLink,
  GitBranch,
  Shield,
  GitMerge,
  Globe,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import type { PublishPipelineDetail } from '@shared/api.interface';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

interface PipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: PublishPipelineDetail | null;
  loading: boolean;
}

const STEP_CONFIG = [
  { key: 'build', label: '文档同步与构建', icon: Loader2 },
  { key: 'gitPush', label: 'Git 提交推送', icon: GitBranch },
  { key: 'prCreate', label: '创建 Pull Request', icon: GitBranch },
  { key: 'securityCheck', label: '安全校验', icon: Shield },
  { key: 'merge', label: '自动合并 PR', icon: GitMerge },
  { key: 'deploy', label: 'GitHub Pages 部署', icon: Globe },
] as const;

function StepIcon({ status }: { status: string }) {
  if (status === 'success' || status === 'no_changes') {
    return <CheckCircle className="size-4 text-green-600" />;
  }
  if (status === 'running' || status === 'pending') {
    return <Loader2 className="size-4 text-primary animate-spin" />;
  }
  if (status === 'failed' || status === 'timeout') {
    return <XCircle className="size-4 text-destructive" />;
  }
  return <Circle className="size-4 text-muted-foreground" />;
}

function stepLabel(status: string): string {
  const map: Record<string, string> = {
    none: '待执行',
    pending: '执行中',
    running: '执行中',
    success: '成功',
    no_changes: '无变更',
    failed: '失败',
    timeout: '超时',
    passed: '通过',
    merged: '已合并',
  };
  return map[status] ?? status;
}

const PipelineDialog: React.FC<PipelineDialogProps> = ({
  open,
  onOpenChange,
  data,
  loading,
}) => {
  if (!data) return null;

  const pipeline = data.pipeline;
  const errors = pipeline.securityCheck?.errors;
  const prUrl = pipeline.prCreate?.prUrl;
  const deployUrl = pipeline.deploy?.deployUrl;
  const actionsUrl = pipeline.deploy?.actionsUrl;
  const mergeCommit = pipeline.merge?.mergeCommitSha;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>发布管道详情</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">加载中...</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">任务状态：</span>
              <Badge variant={data.status === '成功' ? 'outline' : data.status === '失败' ? 'destructive' : 'default'}>
                {data.status}
              </Badge>
            </div>

            <div className="space-y-2">
              {STEP_CONFIG.map((step) => {
                const stepData = pipeline[step.key as keyof typeof pipeline];
                const status = stepData?.status ?? 'none';
                return (
                  <div
                    key={step.key}
                    className="flex items-center gap-3 rounded-md border px-3 py-2"
                  >
                    <StepIcon status={status} />
                    <span className="text-sm font-medium flex-1">{step.label}</span>
                    <Badge variant="outline" className="text-xs">
                      {stepLabel(status)}
                    </Badge>
                    {step.key === 'prCreate' && prUrl && (
                      <UniversalLink
                        to={prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="size-3" />
                        PR #{pipeline.prCreate?.prNumber}
                      </UniversalLink>
                    )}
                    {step.key === 'deploy' && actionsUrl && (
                      <UniversalLink
                        to={actionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="size-3" />
                        Actions
                      </UniversalLink>
                    )}
                  </div>
                );
              })}
            </div>

            {mergeCommit && (
              <div className="text-xs text-muted-foreground">
                Merge Commit: <code className="font-mono">{mergeCommit.slice(0, 12)}</code>
              </div>
            )}

            {deployUrl && data.status === '成功' && (
              <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3">
                <Globe className="size-4 text-green-600" />
                <span className="text-sm font-medium">公开访问地址：</span>
                <UniversalLink
                  to={deployUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  {deployUrl}
                </UniversalLink>
              </div>
            )}

            {errors && errors.length > 0 && (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                <div className="text-sm font-medium text-destructive mb-1">安全校验失败项：</div>
                <ul className="text-xs text-destructive/80 list-disc pl-4 space-y-1">
                  {errors.map((e: string, i: number) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.errorMessage && (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                <div className="text-sm font-medium text-destructive">错误信息：</div>
                <p className="text-xs text-destructive/80 mt-1">{data.errorMessage}</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PipelineDialog;
