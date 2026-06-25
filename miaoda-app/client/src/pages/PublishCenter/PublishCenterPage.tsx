import React, { useState, useCallback, useEffect, useRef } from 'react';
import { CanRole, useAuth, ROLE_SUBJECT } from '@lark-apaas/client-toolkit/auth';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import {
  Hammer,
  Rocket,
  ShieldAlert,
  FileText,
  RotateCcw,
  Loader2,
  Search,
  RefreshCw,
  Undo2,
  GitBranch,
  ExternalLink,
  Globe,
  Package,
  Download,
  Eye,
  AlertTriangle,
} from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
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
import { UserDisplay } from '@client/src/components/business-ui/user-display';
import { UserSelect } from '@client/src/components/business-ui/user-select';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import { publishApi, systemConfigApi, dashboardApi } from '@client/src/api';
import PublishStats from './PublishStats';
import RollbackDialog from './RollbackDialog';
import PipelineDialog from './PipelineDialog';
import type {
  PublishTaskItem,
  PublishStatsResponse,
  TaskType,
  DeployEnvironment,
  TaskStatus,
  TaskLogsResponse,
  PublishScope,
  BuildCheckLogResponse,
  PublishPipelineDetail,
  DocumentBuildInfo,
  BuildArtifactResult,
} from '@shared/api.interface';

// ========== Badge 映射 ==========

const STATUS_BADGE_MAP: Record<TaskStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  '待执行': { variant: 'secondary' },
  '执行中': { variant: 'default' },
  '成功': { variant: 'outline', className: 'bg-success/10 text-success border-success/20' },
  '失败': { variant: 'destructive' },
  '已取消': { variant: 'secondary' },
};

const TASK_TYPE_BADGE_MAP: Record<TaskType, { variant: 'outline' | 'destructive'; className?: string; label: string }> = {
  '构建检查': { variant: 'outline', label: '内容检查' },
  '测试环境发布': { variant: 'outline', label: '预览环境发布' },
  '正式环境发布': { variant: 'destructive', label: '正式发布' },
  '回滚申请': { variant: 'outline', className: 'bg-warning/10 text-warning border-warning/20', label: '恢复历史版本' },
  'Git提交': { variant: 'outline', className: 'bg-accent/10 text-accent border-accent/20', label: '保存到帮助中心' },
  '发布到网站': { variant: 'outline', className: 'bg-blue-50 text-blue-700 border-blue-200', label: '发布到网站' },
  '草稿预览': { variant: 'outline', className: 'bg-gray-50 text-gray-600 border-gray-200', label: '草稿预览' },
  '构建产物包': { variant: 'outline', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: '构建产物包' },
};

const StatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => {
  const config = STATUS_BADGE_MAP[status] ?? { variant: 'secondary' as const };
  return (
    <Badge variant={config.variant} className={config.className}>
      {status}
    </Badge>
  );
};

const TaskTypeBadge: React.FC<{ taskType: TaskType }> = ({ taskType }) => {
  const config = TASK_TYPE_BADGE_MAP[taskType] ?? { variant: 'outline' as const, label: taskType };
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
};

const EnvironmentBadge: React.FC<{ environment?: DeployEnvironment }> = ({ environment }) => {
  if (!environment) return <span className="text-muted-foreground">-</span>;
  const isProd = environment === '正式环境';
  const label = isProd ? '正式发布' : '预览环境';
  return (
    <Badge variant={isProd ? 'destructive' : 'outline'}>
      {label}
    </Badge>
  );
};

const SCOPE_LABELS: Record<string, string> = { all: '全部语言', 'zh-CN': '中文', en: '英文' };
const SCOPE_STYLE: Record<string, string> = {
  all: 'bg-muted text-muted-foreground border-border',
  'zh-CN': 'bg-primary/10 text-primary border-primary/20',
  en: 'bg-success/10 text-success border-success/20',
};

const PublishScopeBadge: React.FC<{ scope?: PublishScope }> = ({ scope }) => {
  const s = scope ?? 'all';
  return (
    <Badge variant="outline" className={SCOPE_STYLE[s] ?? SCOPE_STYLE.all}>
      {SCOPE_LABELS[s] ?? '全部语言'}
    </Badge>
  );
};

// ========== 日志弹窗 ==========

const LogDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: TaskLogsResponse | null;
  loading: boolean;
  taskType?: string;
  downloadUrl?: string;
  onDownload?: () => void;
}> = ({ open, onOpenChange, logs, loading, taskType, downloadUrl, onDownload }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl max-h-[80vh]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileText className="size-4" />
          处理日志
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 overflow-y-auto max-h-[60vh]">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {logs?.errorMessage && (
              <div>
                <h4 className="text-sm font-medium mb-2">错误详情</h4>
                <pre className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto text-destructive">
                  {logs.errorMessage}
                </pre>
              </div>
            )}
            <div>
              <h4 className="text-sm font-medium mb-2">检查日志</h4>
              <pre className="bg-muted/50 rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[250px] overflow-y-auto border">
                {logs?.buildLog || '暂无检查日志'}
              </pre>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">发布日志</h4>
              <pre className="bg-muted/50 rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[250px] overflow-y-auto border">
                {logs?.deployLog || '暂无发布日志'}
              </pre>
            </div>
            {taskType === '构建产物包' && (
              <div className="flex items-center gap-3">
                {downloadUrl ? (
                  <Button size="sm" variant="outline" onClick={onDownload}>
                    <Download className="size-3.5 mr-1" />
                    下载 build.zip
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled title="构建成功，但未生成下载地址，请联系管理员">
                    <Download className="size-3.5 mr-1" />
                    下载 build.zip
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </DialogContent>
  </Dialog>
);

// ========== 构建检查日志弹窗 ==========

const BuildCheckLogDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BuildCheckLogResponse | null;
  loading: boolean;
}> = ({ open, onOpenChange, data, loading }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl max-h-[80vh]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Hammer className="size-4" />
          内容检查日志
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 overflow-y-auto max-h-[60vh]">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {data && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">检查结果：</span>
                <Badge
                  variant={data.success ? 'outline' : 'destructive'}
                  className={data.success ? 'bg-success/10 text-success border-success/20' : undefined}
                >
                  {data.success ? '通过' : '失败'}
                </Badge>
              </div>
            )}
            {data?.errorMessage && (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                {data.errorMessage}
              </div>
            )}
            <div>
              <h4 className="text-sm font-medium mb-2">检查日志</h4>
              <pre className="bg-muted/50 rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto border">
                {data?.buildLog || '暂无检查日志'}
              </pre>
            </div>
          </>
        )}
      </div>
    </DialogContent>
  </Dialog>
);

// ========== 正式发布确认弹窗 ==========

const ProductionConfirmDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
  publishScope?: PublishScope;
}> = ({ open, onOpenChange, onConfirm, loading, publishScope }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="size-5" />
          正式发布确认
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-3">
            <p>
              发布更新将同步到帮助中心，请确认以下事项：
            </p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-success mt-0.5">✓</span>
                <span>已完成内容检查并通过</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-success mt-0.5">✓</span>
                <span>已完成预览环境发布并验收通过</span>
              </li>
            </ul>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">发布范围：</span>
              <Badge variant="outline" className={SCOPE_STYLE[publishScope ?? 'all'] ?? SCOPE_STYLE.all}>
                {SCOPE_LABELS[publishScope ?? 'all'] ?? '全部语言'}
              </Badge>
            </div>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={loading}>取消</AlertDialogCancel>
        <AlertDialogAction
          onClick={onConfirm}
          disabled={loading}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          确认正式发布
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

// ========== 主页面 ==========

const PublishCenterPage: React.FC = () => {
  const { ability } = useAuth();
  const isAdmin = ability.can('super_admin', ROLE_SUBJECT) || ability.can('publish_admin', ROLE_SUBJECT);

  const [taskList, setTaskList] = useState<PublishTaskItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(false);

  const [filterTaskType, setFilterTaskType] = useState<string>('');
  const [filterEnvironment, setFilterEnvironment] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterOperator, setFilterOperator] = useState<string>('');
  const [filterPublishScope, setFilterPublishScope] = useState<string>('');

  const [appliedTaskType, setAppliedTaskType] = useState<string>('');
  const [appliedEnvironment, setAppliedEnvironment] = useState<string>('');
  const [appliedStatus, setAppliedStatus] = useState<string>('');
  const [appliedOperator, setAppliedOperator] = useState<string>('');
  const [appliedPublishScope, setAppliedPublishScope] = useState<string>('');

  const [operationScope, setOperationScope] = useState<PublishScope>('all');

  // 操作状态
  const [buildLoading, setBuildLoading] = useState<boolean>(false);
  const [stagingLoading, setStagingLoading] = useState<boolean>(false);
  const [productionLoading, setProductionLoading] = useState<boolean>(false);
  const [gitLoading, setGitLoading] = useState<boolean>(false);
  const [websitePublishLoading, setWebsitePublishLoading] = useState<boolean>(false);
  const [githubPagesPreviewLoading, setGithubPagesPreviewLoading] = useState<boolean>(false);
  const [githubPagesPreviewDialogOpen, setGithubPagesPreviewDialogOpen] = useState<boolean>(false);
  const [retryLoadingMap, setRetryLoadingMap] = useState<Record<string, boolean>>({});
  const [draftPreviewRunning, setDraftPreviewRunning] = useState<boolean>(false);
  const [buildArtifactRunning, setBuildArtifactRunning] = useState<boolean>(false);
  const [buildArtifactLoading, setBuildArtifactLoading] = useState<boolean>(false);
  const [buildArtifactTaskId, setBuildArtifactTaskId] = useState<string | null>(null);
  const [buildArtifactSuccess, setBuildArtifactSuccess] = useState<boolean>(false);
  const [docListDialogOpen, setDocListDialogOpen] = useState<boolean>(false);
  const [docListData, setDocListData] = useState<DocumentBuildInfo[]>([]);

  // 弹窗状态
  const [logDialogOpen, setLogDialogOpen] = useState<boolean>(false);
  const [logData, setLogData] = useState<TaskLogsResponse | null>(null);
  const [logLoading, setLogLoading] = useState<boolean>(false);
  const [logTaskType, setLogTaskType] = useState<string>('');
  const [productionDialogOpen, setProductionDialogOpen] = useState<boolean>(false);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState<boolean>(false);
  const [buildCheckLogDialogOpen, setBuildCheckLogDialogOpen] = useState<boolean>(false);
  const [buildCheckLogData, setBuildCheckLogData] = useState<BuildCheckLogResponse | null>(null);
  const [buildCheckLogLoading, setBuildCheckLogLoading] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState<boolean>(false);
  const [pipelineData, setPipelineData] = useState<PublishPipelineDetail | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState<boolean>(false);

  // 统计
  const [stats, setStats] = useState<PublishStatsResponse | null>(null);

  const [productionUrl, setProductionUrl] = useState<string>('');

  useEffect(() => {
    const checkRunning = () => {
      publishApi.getRunningTasks()
        .then((running: string[]) => {
          setDraftPreviewRunning(running.includes('草稿预览'));
          setBuildArtifactRunning(running.includes('构建产物包'));
        })
        .catch(() => { /* ignore */ });
    };
    checkRunning();
    const interval = setInterval(checkRunning, 3000);
    return () => clearInterval(interval);
  }, []);

  // 轮询状态
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void systemConfigApi.getSystemConfig().then((config) => {
      if (config?.productionUrl) setProductionUrl(config.productionUrl);
    }).catch(() => {});
    dashboardApi.getStatistics().then((res) => {
      setPendingCount(res.pendingReviewCount);
    }).catch(() => {});
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const result = await publishApi.getPublishStats();
      setStats(result);
    } catch {
      // silent
    }
  }, []);

  const fetchTaskList = useCallback(async (p: number, ps: number) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page: p, pageSize: ps };
      if (appliedTaskType) params.taskType = appliedTaskType;
      if (appliedEnvironment) params.environment = appliedEnvironment;
      if (appliedStatus) params.status = appliedStatus;
      if (appliedOperator) params.operator = appliedOperator;
      if (appliedPublishScope) params.publishScope = appliedPublishScope;
      const result = await publishApi.getPublishTaskList(params as any);
      setTaskList(result.items);
      setTotal(result.total);
    } catch (err: unknown) {
      toast.error('获取任务列表失败');
    } finally {
      setLoading(false);
    }
  }, [appliedTaskType, appliedEnvironment, appliedStatus, appliedOperator, appliedPublishScope]);

  useEffect(() => {
    fetchTaskList(page, pageSize);
    fetchStats();
  }, [page, pageSize, fetchTaskList, fetchStats]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const result = await publishApi.getPublishTaskList({
          status: '执行中',
          page: 1,
          pageSize: 1,
        } as any);
        if (result.total === 0) {
          stopPolling();
        }
        fetchTaskList(page, pageSize);
        fetchStats();
      } catch {
        stopPolling();
      }
    }, 5000);
  }, [stopPolling, fetchTaskList, fetchStats, page, pageSize]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    if (!buildArtifactTaskId) return;
    const task = taskList.find((t: PublishTaskItem) => t.id === buildArtifactTaskId);
    if (task?.status === '成功') {
      setBuildArtifactSuccess(true);
      toast.success('构建产物包已生成，可下载 build.zip');
    } else if (task?.status === '失败') {
      toast.error('构建产物包生成失败，请查看日志');
    }
  }, [taskList, buildArtifactTaskId]);

  const handleFilterSearch = () => {
    setAppliedTaskType(filterTaskType);
    setAppliedEnvironment(filterEnvironment);
    setAppliedStatus(filterStatus);
    setAppliedOperator(filterOperator);
    setAppliedPublishScope(filterPublishScope);
    setPage(1);
  };

  const handleFilterReset = () => {
    setFilterTaskType('');
    setFilterEnvironment('');
    setFilterStatus('');
    setFilterOperator('');
    setFilterPublishScope('');
    setAppliedTaskType('');
    setAppliedEnvironment('');
    setAppliedStatus('');
    setAppliedOperator('');
    setAppliedPublishScope('');
    setPage(1);
  };

  const handleFilterRefresh = () => {
    fetchTaskList(page, pageSize);
    fetchStats();
  };

  const handleBuildArtifact = async () => {
    setBuildArtifactLoading(true);
    try {
      const result = await publishApi.triggerBuildArtifact();
      setBuildArtifactTaskId(result.id);
      setBuildArtifactSuccess(false);
      toast.success('构建产物包任务已创建，正在执行中（约 5-10 分钟）...');
      fetchTaskList(page, pageSize);
      startPolling();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建构建产物包任务失败';
      toast.error(msg);
    } finally {
      setBuildArtifactLoading(false);
    }
  };

  const handleDownloadBuildArtifact = async (taskId?: string) => {
    try {
      await publishApi.downloadBuildArtifact(taskId);
      toast.success('下载成功');
    } catch (err) {
      const message = err instanceof Error ? err.message : '下载失败';
      toast.error(message);
    }
  };

  const handleViewDocList = async (taskId: string) => {
    try {
      const logs = await publishApi.getTaskLogs(taskId);
      if (logs?.deployLog) {
        const result = JSON.parse(logs.deployLog) as BuildArtifactResult;
        setDocListData(result.docList || []);
        setDocListDialogOpen(true);
      } else {
        toast.error('构建结果中无文档清单数据');
      }
    } catch {
      toast.error('获取文档清单失败');
    }
  };

  // 构建检查
  const handleBuild = async () => {
    setBuildLoading(true);
    try {
      await publishApi.triggerBuildCheck(operationScope);
      toast.success('内容检查任务已创建，正在执行中...');
      fetchTaskList(page, pageSize);
      fetchStats();
      startPolling();
    } catch (err: unknown) {
      toast.error('创建构建任务失败');
    } finally {
      setBuildLoading(false);
    }
  };

  const handleWebsitePublish = async () => {
    setWebsitePublishLoading(true);
    try {
      const result = await publishApi.triggerWebsitePublish(operationScope);
      if (!result.success) {
        toast.error(result.message ?? '发布失败');
        return;
      }
      toast.success('发布任务已创建，系统将自动完成 PR 创建、合并和部署...');
      fetchTaskList(page, pageSize);
      fetchStats();
      startPolling();
    } catch (err: unknown) {
      toast.error('创建发布任务失败');
    } finally {
      setWebsitePublishLoading(false);
    }
  };

  const handleGithubPagesPreview = async () => {
    setGithubPagesPreviewDialogOpen(false);
    setGithubPagesPreviewLoading(true);
    try {
      const result = await publishApi.triggerWebsitePublish(undefined, {
        previewOnly: true,
        buildScope: 'releaseCandidate',
        forceConfig: { url: 'https://keaton1167.github.io', baseUrl: '/my-website/' },
      });
      if (!result.success) {
        toast.error(result.message ?? '预览发布失败');
        return;
      }
      toast.success('GitHub Pages 预览发布任务已创建，系统将自动完成构建、PR 和部署...');
      fetchTaskList(page, pageSize);
      fetchStats();
      startPolling();
    } catch (err: unknown) {
      toast.error('创建预览发布任务失败');
    } finally {
      setGithubPagesPreviewLoading(false);
    }
  };

  const handleViewPipeline = async (taskId: string) => {
    setPipelineDialogOpen(true);
    setPipelineLoading(true);
    setPipelineData(null);
    try {
      const result = await publishApi.getPublishPipeline(taskId);
      setPipelineData(result);
    } catch {
      toast.error('获取发布管道详情失败');
    } finally {
      setPipelineLoading(false);
    }
  };

  // Git 提交
  const handleGitCommit = async () => {
    setGitLoading(true);
    try {
      const result = await publishApi.triggerGitCommit(operationScope);
      if (!result.success) {
        toast.error(result.message ?? '保存失败');
        return;
      }
      toast.success('保存任务已创建，正在执行中...');
      fetchTaskList(page, pageSize);
      fetchStats();
      startPolling();
    } catch (err: unknown) {
      toast.error('创建保存任务失败');
    } finally {
      setGitLoading(false);
    }
  };

  // 发布到测试环境
  const handleDeployStaging = async () => {
    setStagingLoading(true);
    try {
      const precheck = await publishApi.precheckStaging();
      if (!precheck.ok) {
        const errMsg = precheck.errors.join('\n');
        toast.error('预览环境发布前置校验失败', { description: errMsg, duration: 8000 });
        return;
      }
      await publishApi.deployStaging(operationScope);
      toast.success('预览环境发布任务已创建，正在执行构建和部署...');
      fetchTaskList(page, pageSize);
      fetchStats();
      startPolling();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建预览环境发布任务失败';
      toast.error(msg);
    } finally {
      setStagingLoading(false);
    }
  };

  const handleProductionClick = async () => {
    setProductionLoading(true);
    try {
      const precheck = await publishApi.precheckProduction();
      if (!precheck.ok) {
        const errMsg = precheck.errors.join('\n');
        toast.error('当前尚不满足发布条件', { description: errMsg, duration: 10000 });
      } else {
        setProductionDialogOpen(true);
      }
    } catch {
      toast.error('正式发布前置校验请求失败，请重试');
    } finally {
      setProductionLoading(false);
    }
  };

  // 发布到正式环境
  const handleDeployProduction = async () => {
    setProductionLoading(true);
    try {
      await publishApi.deployProduction(operationScope);
      toast.success('发布任务已创建，可在下方列表查看进度');
      fetchTaskList(page, pageSize);
      fetchStats();
      startPolling();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建正式发布任务失败';
      toast.error(msg);
    } finally {
      setProductionLoading(false);
      setProductionDialogOpen(false);
    }
  };

  // 查看日志
  const handleViewLogs = async (taskId: string, taskType?: string) => {
    setLogDialogOpen(true);
    setLogLoading(true);
    setLogData(null);
    setLogTaskType(taskType || '');
    try {
      const result = await publishApi.getTaskLogs(taskId);
      setLogData(result);
    } catch (err: unknown) {
      toast.error('获取日志失败');
    } finally {
      setLogLoading(false);
    }
  };

  // 查看构建检查日志
  const handleViewBuildCheckLogs = async (taskId: string) => {
    setBuildCheckLogDialogOpen(true);
    setBuildCheckLogLoading(true);
    setBuildCheckLogData(null);
    try {
      const result = await publishApi.getBuildCheckLogs(taskId);
      setBuildCheckLogData(result);
    } catch (err: unknown) {
      toast.error('获取内容检查日志失败');
    } finally {
      setBuildCheckLogLoading(false);
    }
  };

  // 查看 Git 提交日志
  const handleViewGitLogs = async (taskId: string) => {
    setBuildCheckLogDialogOpen(true);
    setBuildCheckLogLoading(true);
    setBuildCheckLogData(null);
    try {
      const result = await publishApi.getGitCommitLogs(taskId);
      setBuildCheckLogData(result);
    } catch (err: unknown) {
      toast.error('获取保存日志失败');
    } finally {
      setBuildCheckLogLoading(false);
    }
  };

  // 重试任务
  const handleRetry = async (taskId: string) => {
    setRetryLoadingMap((prev: Record<string, boolean>) => ({ ...prev, [taskId]: true }));
    try {
      await publishApi.retryTask(taskId);
      toast.success('任务已重新执行');
      fetchTaskList(page, pageSize);
      fetchStats();
    } catch (err: unknown) {
      toast.error('重试任务失败');
    } finally {
      setRetryLoadingMap((prev: Record<string, boolean>) => ({ ...prev, [taskId]: false }));
    }
  };

  // 表格列定义
  const baseColumns = [
    {
      title: '任务名称',
      dataIndex: 'taskName',
      key: 'taskName',
      width: 200,
      ellipsis: true,
    },
  ];

  const adminOnlyColumns = [
    {
      title: '类型',
      dataIndex: 'taskType',
      key: 'taskType',
      width: 140,
      render: (val: TaskType) => <TaskTypeBadge taskType={val} />,
    },
    {
      title: '环境',
      dataIndex: 'environment',
      key: 'environment',
      width: 120,
      render: (val: DeployEnvironment) => <EnvironmentBadge environment={val} />,
    },
    {
      title: '发布范围',
      dataIndex: 'publishScope',
      key: 'publishScope',
      width: 110,
      render: (val: PublishScope) => <PublishScopeBadge scope={val} />,
    },
  ];

  const sharedColumns = [
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (val: TaskStatus, record: PublishTaskItem) => {
        let anomalyCount = 0;
        if (record.taskType === '构建产物包' && record.status === '成功' && record.deployLog) {
          try {
            const parsed = JSON.parse(record.deployLog) as BuildArtifactResult;
            anomalyCount = parsed.resourceAnomalyCount || 0;
          } catch { /* ignore */ }
        }
        return (
          <div className="flex items-center gap-1.5">
            <StatusBadge status={val} />
            {anomalyCount > 0 && (
              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-xs px-1.5 py-0">
                <AlertTriangle className="size-3 mr-0.5" />
                资源异常({anomalyCount})
              </Badge>
            )}
          </div>
        );
      },
    },
  ];

  const adminMoreColumns = [
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      width: 150,
      render: (val: string) => <UserDisplay userId={val} size="small" />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (val: string) => val ? dayjs(val).format('YYYY-MM-DD HH:mm') : '-',
    },
  ];

  const finishedAtColumn = {
    title: '完成时间',
    dataIndex: 'finishedAt',
    key: 'finishedAt',
    width: 170,
    render: (val: string) => val ? dayjs(val).format('YYYY-MM-DD HH:mm') : '-',
  };

  const columns = isAdmin
    ? [...baseColumns, ...adminOnlyColumns, ...sharedColumns, ...adminMoreColumns, finishedAtColumn, {
      title: '操作',
      key: 'actions',
      width: 260,
      fixed: 'right' as const,
      render: (_: unknown, record: PublishTaskItem) => (
        <div className="flex items-center gap-2">
          {record.taskType === '测试环境发布' && record.status === '成功' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const stagingUrl = 'http://localhost:3333/my-website/';
                if (stagingUrl && !stagingUrl.includes('example.com')) {
                  window.open(stagingUrl, '_blank');
                } else {
                  toast.info('产物已部署到目录，但暂未提供可访问预览环境 URL');
                }
              }}
            >
              <ExternalLink className="size-3.5 mr-1" />
              访问预览环境
            </Button>
          )}
          {(record.taskType === '正式环境发布' || record.taskType === '回滚申请') && record.status === '成功' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const productionUrl = 'http://localhost:8888/my-website/';
                if (productionUrl && !productionUrl.includes('example.com')) {
                  window.open(productionUrl, '_blank');
                } else {
                  toast.info('产物已部署到目录，但暂未配置正式发布 URL');
                }
              }}
            >
              <ExternalLink className="size-3.5 mr-1" />
              访问正式发布
            </Button>
          )}
          {record.taskType === '构建检查' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleViewBuildCheckLogs(record.id)}
            >
              <FileText className="size-3.5 mr-1" />
              查看日志
            </Button>
          ) : record.taskType === 'Git提交' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleViewGitLogs(record.id)}
            >
              <FileText className="size-3.5 mr-1" />
              查看日志
            </Button>
          ) : record.taskType === '发布到网站' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleViewPipeline(record.id)}
            >
              <Globe className="size-3.5 mr-1" />
              查看管道
            </Button>
          ) : record.taskType === '构建产物包' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleViewLogs(record.id, record.taskType)}
            >
              <FileText className="size-3.5 mr-1" />
              查看日志
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleViewLogs(record.id)}
            >
              <FileText className="size-3.5 mr-1" />
              日志
            </Button>
          )}
          {record.taskType === '构建产物包' && record.status === '成功' && (
            <>
              {record.downloadUrl ? (
                <Button variant="ghost" size="sm" onClick={() => handleDownloadBuildArtifact(record.id)}>
                  <Download className="size-3.5 mr-1" />
                  下载 build.zip
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled title="构建成功，但未生成下载地址，请联系管理员">
                  <Download className="size-3.5 mr-1" />
                  下载 build.zip
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleViewDocList(record.id)}
              >
                <FileText className="size-3.5 mr-1" />
                文档清单
              </Button>
            </>
          )}
          {record.taskType === '发布到网站' && record.prUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(record.prUrl, '_blank')}
            >
              <ExternalLink className="size-3.5 mr-1" />
              PR
            </Button>
          )}
          {record.taskType === '发布到网站' && record.deployUrl && record.status === '成功' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(record.deployUrl, '_blank')}
            >
              <ExternalLink className="size-3.5 mr-1" />
              访问网站
            </Button>
          )}
          {record.status === '失败' && (
            <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRetry(record.id)}
              disabled={retryLoadingMap[record.id]}
            >
              {retryLoadingMap[record.id] ? (
                <Loader2 className="size-3.5 mr-1 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5 mr-1" />
              )}
              重新执行
            </Button>
            </CanRole>
          )}
        </div>
      ),
    },
  ]
    : [...baseColumns, ...sharedColumns, finishedAtColumn, {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      width: 130,
      render: (val: string) => val ? <UserDisplay userId={val} size="small" /> : '-',
    }];

  return (
    <div className="space-y-4">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-semibold">发布中心</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看帮助中心发布状态和结果。
        </p>
      </div>

      {/* 统计卡片 */}
      {isAdmin && <PublishStats stats={stats} />}

      {/* 筛选区 */}
      {isAdmin && <div className="space-y-2 rounded-md border bg-card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={filterTaskType || undefined} onValueChange={setFilterTaskType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="请选择任务类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="构建检查">内容检查</SelectItem>
              <SelectItem value="测试环境发布">预览环境发布</SelectItem>
              <SelectItem value="正式环境发布">正式发布</SelectItem>
              <SelectItem value="发布到网站">发布到网站</SelectItem>
              <SelectItem value="回滚申请">恢复历史版本</SelectItem>
              <SelectItem value="Git提交">保存到帮助中心</SelectItem>
              <SelectItem value="草稿预览">草稿预览</SelectItem>
              <SelectItem value="构建产物包">构建产物包</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterEnvironment || undefined} onValueChange={setFilterEnvironment}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="请选择发布环境" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="测试环境">预览环境</SelectItem>
              <SelectItem value="正式环境">正式发布</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus || undefined} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="请选择任务状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="待执行">待执行</SelectItem>
              <SelectItem value="执行中">执行中</SelectItem>
              <SelectItem value="成功">成功</SelectItem>
              <SelectItem value="失败">失败</SelectItem>
              <SelectItem value="已取消">已取消</SelectItem>
            </SelectContent>
          </Select>
          <UserSelect
            value={filterOperator || null}
            valueType="string"
            placeholder="请选择操作人"
            triggerType="search"
            onChange={(val: string | null) => setFilterOperator(val ?? '')}
            className="w-48"
          />
          <Select value={filterPublishScope || undefined} onValueChange={setFilterPublishScope}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="发布范围" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部语言</SelectItem>
              <SelectItem value="zh-CN">中文</SelectItem>
              <SelectItem value="en">英文</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleFilterSearch}>
            <Search className="size-3.5 mr-1" />
            查询
          </Button>
          <Button variant="outline" size="sm" onClick={handleFilterReset}>
            <RotateCcw className="size-3.5 mr-1" />
            重置
          </Button>
          <Button variant="outline" size="sm" onClick={handleFilterRefresh}>
            <RefreshCw className="size-3.5 mr-1" />
            刷新
          </Button>
        </div>
      </div>}

      {/* 操作栏 */}
      {isAdmin ? (
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">发布操作</h3>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm text-muted-foreground">发布范围：</span>
          <Select value={operationScope} onValueChange={(v: string) => setOperationScope(v as PublishScope)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部语言</SelectItem>
              <SelectItem value="zh-CN">中文</SelectItem>
              <SelectItem value="en">英文</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
        <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        <Button
          variant="outline"
          onClick={handleBuild}
          disabled={buildLoading || draftPreviewRunning}
          title={draftPreviewRunning ? '草稿预览任务运行中，请等待完成' : undefined}
        >
          {buildLoading ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Hammer className="size-4 mr-2" />
          )}
          内容检查
        </Button>
        </CanRole>
        <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        <Button
          variant="outline"
          onClick={handleGitCommit}
          disabled={gitLoading || draftPreviewRunning}
          title={draftPreviewRunning ? '草稿预览任务运行中，请等待完成' : undefined}
        >
          {gitLoading ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <GitBranch className="size-4 mr-2" />
          )}
          保存到帮助中心
        </Button>
        </CanRole>
        <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        <Button
          variant="default"
          onClick={handleWebsitePublish}
          disabled={websitePublishLoading || draftPreviewRunning}
          title={draftPreviewRunning ? '草稿预览任务运行中，请等待完成' : undefined}
        >
          {websitePublishLoading ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Globe className="size-4 mr-2" />
          )}
          发布到网站
        </Button>
        </CanRole>
        <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        <Button
          variant="outline"
          onClick={() => setGithubPagesPreviewDialogOpen(true)}
          disabled={githubPagesPreviewLoading || draftPreviewRunning}
          title={draftPreviewRunning ? '草稿预览任务运行中，请等待完成' : undefined}
        >
          {githubPagesPreviewLoading ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Eye className="size-4 mr-2" />
          )}
          GitHub Pages 预览
        </Button>
        </CanRole>
        <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        <Button
          variant="outline"
          onClick={handleDeployStaging}
          disabled={stagingLoading || draftPreviewRunning}
          title={draftPreviewRunning ? '草稿预览任务运行中，请等待完成' : undefined}
        >
          {stagingLoading ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Rocket className="size-4 mr-2" />
          )}
          发布到预览环境
        </Button>
        </CanRole>
        <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        <Button
          variant="destructive"
          onClick={handleProductionClick}
          disabled={productionLoading || draftPreviewRunning}
          title={draftPreviewRunning ? '草稿预览任务运行中，请等待完成' : undefined}
        >
          {productionLoading ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <ShieldAlert className="size-4 mr-2" />
          )}
          正式发布
        </Button>
        </CanRole>
        <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        <Button
          variant="outline"
          onClick={() => setRollbackDialogOpen(true)}
          disabled={draftPreviewRunning}
          title={draftPreviewRunning ? '草稿预览任务运行中，请等待完成' : undefined}
        >
          <Undo2 className="size-4 mr-2" />
          恢复历史版本
        </Button>
        </CanRole>
        </div>
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border">
          <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
          <Button
            variant="outline"
            onClick={handleBuildArtifact}
            disabled={buildArtifactLoading || buildArtifactRunning || draftPreviewRunning}
            title={draftPreviewRunning ? '草稿预览任务运行中，请等待完成' : buildArtifactRunning ? '构建产物包任务运行中' : undefined}
            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            {buildArtifactLoading || buildArtifactRunning ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Package className="size-4 mr-2" />
            )}
            生成正式 build 包
          </Button>
          </CanRole>
          {buildArtifactSuccess && buildArtifactTaskId && (
            <>
            <Button
              variant="outline"
              onClick={() => handleDownloadBuildArtifact(buildArtifactTaskId)}
              className="border-blue-200 text-blue-700 hover:bg-blue-50"
            >
              <Download className="size-4 mr-2" />
              下载 build.zip
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleViewDocList(buildArtifactTaskId)}
            >
              <Eye className="size-4 mr-1" />
              查看文档清单
            </Button>
            </>
          )}
        </div>
      </div>
      ) : (
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">发布操作</h3>
          {pendingCount > 0 && (
            <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
              {pendingCount} 条待处理内容
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3">管理员完成内容检查和发布后，可在下方查看进度</p>
        <div className="flex items-center gap-3">
          {productionUrl && (
            <Button
              variant="outline"
              onClick={() => window.open(productionUrl, '_blank')}
            >
              <ExternalLink className="size-4 mr-2" />
              预览帮助中心
            </Button>
          )}
          <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
          <Button
            variant="destructive"
            onClick={handleProductionClick}
            disabled={productionLoading}
          >
            {productionLoading ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <ShieldAlert className="size-4 mr-2" />
            )}
            发布更新
          </Button>
          </CanRole>
        </div>
      </div>
      )}

      {/* 任务列表 */}
      <div className="rounded-md border bg-card">
        <Table
          dataSource={taskList}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ y: 500 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t: number) => `共 ${t} 条`,
            onChange: (p: number, ps: number) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </div>

      {/* 日志弹窗 */}
      <LogDialog
        open={logDialogOpen}
        onOpenChange={setLogDialogOpen}
        logs={logData}
        loading={logLoading}
        taskType={logTaskType}
        downloadUrl={logTaskType === '构建产物包' && logData?.deployLog
          ? (() => { try { return (JSON.parse(logData.deployLog) as { downloadUrl?: string }).downloadUrl; } catch { return undefined; } })()
          : undefined}
        onDownload={() => handleDownloadBuildArtifact(logTaskType === '构建产物包' && logData?.deployLog
          ? (() => { try { return (JSON.parse(logData.deployLog) as { taskId?: string }).taskId; } catch { return undefined; } })()
          : undefined)}
      />

      {/* 构建检查日志弹窗 */}
      <BuildCheckLogDialog
        open={buildCheckLogDialogOpen}
        onOpenChange={setBuildCheckLogDialogOpen}
        data={buildCheckLogData}
        loading={buildCheckLogLoading}
      />

      {/* 正式发布确认弹窗 */}
      <ProductionConfirmDialog
        open={productionDialogOpen}
        onOpenChange={setProductionDialogOpen}
        onConfirm={handleDeployProduction}
        loading={productionLoading}
        publishScope={operationScope}
      />

      {/* 回滚申请弹窗 */}
      <RollbackDialog
        open={rollbackDialogOpen}
        onOpenChange={setRollbackDialogOpen}
        publishScope={operationScope}
        onSuccess={() => {
          fetchTaskList(page, pageSize);
          fetchStats();
        }}
      />

      {/* GitHub Pages 预览发布确认弹窗 */}
      <AlertDialog open={githubPagesPreviewDialogOpen} onOpenChange={setGithubPagesPreviewDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>GitHub Pages 预览发布</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>将帮助中心发布到 GitHub Pages 预览环境，用于查看效果。</p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>目标地址：https://keaton1167.github.io/my-website/</li>
                  <li>内容范围：已发布 + 待发布文档</li>
                  <li>不部署公司服务器，不改变文档发布状态</li>
                </ul>
                <p className="text-muted-foreground">确认后将自动执行构建、PR 创建、安全校验、合并和 GitHub Pages 部署。</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleGithubPagesPreview}>确认发布</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 发布管道详情弹窗 */}
      <PipelineDialog
        open={pipelineDialogOpen}
        onOpenChange={setPipelineDialogOpen}
        data={pipelineData}
        loading={pipelineLoading}
      />

      {/* 文档清单弹窗 */}
      <Dialog open={docListDialogOpen} onOpenChange={setDocListDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="size-4" />
              构建文档清单（{docListData.length} 篇）
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium">标题</th>
                  <th className="text-left p-2 font-medium w-16">语言</th>
                  <th className="text-left p-2 font-medium">一级目录</th>
                  <th className="text-left p-2 font-medium">二级目录</th>
                  <th className="text-right p-2 font-medium w-16">图片</th>
                  <th className="text-right p-2 font-medium w-16">外链</th>
                  <th className="text-right p-2 font-medium w-16">附件</th>
                  <th className="text-center p-2 font-medium w-20">资源状态</th>
                </tr>
              </thead>
              <tbody>
                {docListData.map((doc: DocumentBuildInfo, idx: number) => (
                  <tr key={idx} className="border-b hover:bg-muted/30">
                    <td className="p-2 truncate max-w-[200px]" title={doc.title}>{doc.title}</td>
                    <td className="p-2">{doc.language}</td>
                    <td className="p-2 truncate max-w-[120px]" title={doc.firstCategory}>{doc.firstCategory}</td>
                    <td className="p-2 truncate max-w-[120px]" title={doc.secondCategory}>{doc.secondCategory}</td>
                    <td className="p-2 text-right">{doc.imageCount}</td>
                    <td className="p-2 text-right">{doc.externalLinkCount}</td>
                    <td className="p-2 text-right">{doc.attachmentCount}</td>
                    <td className="p-2 text-center">
                      {doc.hasResourceError ? (
                        <Badge
                          variant="destructive"
                          className="text-xs cursor-help"
                          title={[
                            ...(doc.missingImages?.map((p: string) => `缺失图片: ${p}`) || []),
                            ...(doc.zeroByteAttachments?.map((p: string) => `0字节附件: ${p}`) || []),
                          ].join('\n')}
                        >
                          异常
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/20">正常</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PublishCenterPage;
