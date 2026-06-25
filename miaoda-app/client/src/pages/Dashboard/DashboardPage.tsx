import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import {
  FileText,
  FilePen,
  Clock,
  CheckCircle,
  FileX,
  AlertTriangle,
  Plus,
  ExternalLink,
  Rocket,
  RefreshCw,
  ArrowRight,
  Send,
} from 'lucide-react';
import { Card, CardContent } from '@client/src/components/ui/card';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { dashboardApi, systemConfigApi } from '@client/src/api';
import type {
  DashboardStatistics,
  RecentImportTask,
  RecentPublishTask,
  RecentUpdatedDoc,
} from '@shared/api.interface';
import { CanRole } from '@lark-apaas/client-toolkit/auth';

import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

// ========== Constants ==========

const STAT_CARDS = [
  { key: 'totalDocs' as const, label: '全部内容', icon: FileText, color: 'text-primary' },
  { key: 'draftCount' as const, label: '草稿', icon: FilePen, color: 'text-muted-foreground' },
  { key: 'pendingReviewCount' as const, label: '待审核', icon: Clock, color: 'text-orange-500' },
  { key: 'pendingPublishCount' as const, label: '待发布', icon: Send, color: 'text-blue-500' },
  { key: 'publishedCount' as const, label: '已发布', icon: CheckCircle, color: 'text-green-600' },
  { key: 'noContentCount' as const, label: '需补正文', icon: FileX, color: 'text-yellow-600' },
  { key: 'failedImportCount' as const, label: '需处理异常', icon: AlertTriangle, color: 'text-red-500' },
] as const;

const QUICK_ACTIONS = [
  { label: '新建文档', icon: Plus, path: '/documents' },
  { label: '进入内容管理', icon: FileText, path: '/documents' },
  { label: '查看发布状态', icon: Rocket, path: '/publish-center' },
] as const;

const LIST_DISPLAY_LIMIT = 5;

// ========== Badge Helpers ==========

const IMPORT_STATUS_STYLES: Record<string, string> = {
  '成功': 'bg-green-50 text-green-700 border-green-200',
  '失败': 'bg-red-50 text-red-700 border-red-200',
  '转换中': 'bg-blue-50 text-blue-700 border-blue-200',
  '待转换': 'bg-gray-50 text-gray-600 border-gray-200',
};

const PUBLISH_STATUS_STYLES: Record<string, string> = {
  '成功': 'bg-green-50 text-green-700 border-green-200',
  '失败': 'bg-red-50 text-red-700 border-red-200',
  '执行中': 'bg-blue-50 text-blue-700 border-blue-200',
  '待执行': 'bg-gray-50 text-gray-600 border-gray-200',
  '已取消': 'bg-gray-50 text-gray-600 border-gray-200',
};

const DOC_PUBLISH_STATUS_STYLES: Record<string, string> = {
  '草稿': 'bg-gray-50 text-gray-600 border-gray-200',
  '待审核': 'bg-orange-50 text-orange-700 border-orange-200',
  '待发布': 'bg-blue-50 text-blue-700 border-blue-200',
  '已发布': 'bg-green-50 text-green-700 border-green-200',
  '已归档': 'bg-gray-50 text-gray-600 border-gray-200',
};

function StatusBadge({ status, styleMap }: { status: string; styleMap: Record<string, string> }) {
  const cls: string = styleMap[status] ?? 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <Badge variant="outline" className={cls}>
      {status}
    </Badge>
  );
}

// ========== Stat Card Skeleton ==========

function StatCardSkeleton() {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-12" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ========== Stat Cards ==========

function StatCards({
  statistics,
  loading,
}: {
  statistics: DashboardStatistics | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div data-ai-section-type="card-stat" className="grid grid-cols-3 gap-4">
        {STAT_CARDS.map((_: typeof STAT_CARDS[number], i: number) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const stats: DashboardStatistics = statistics ?? {
    totalDocs: 0, draftCount: 0, pendingReviewCount: 0, pendingPublishCount: 0,
    publishedCount: 0, noContentCount: 0, failedImportCount: 0,
  };

  return (
    <div data-ai-section-type="card-stat" className="grid grid-cols-3 gap-4">
      {STAT_CARDS.map((card: typeof STAT_CARDS[number]) => {
        const Icon = card.icon;
        const value: number = stats[card.key];
        return (
          <Card key={card.key} className="border shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className={`rounded-md p-2 bg-accent ${card.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-bold">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ========== List Skeleton ==========

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }, (_: unknown, i: number) => (
        <div key={i} className="flex items-center justify-between py-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

// ========== Recent Imports List ==========

function RecentImportsList({
  items,
  loading,
}: {
  items: RecentImportTask[];
  loading: boolean;
}) {
  if (loading) return <ListSkeleton />;

  const displayItems: RecentImportTask[] = items.slice(0, LIST_DISPLAY_LIMIT);

  if (displayItems.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">暂无导入任务</p>;
  }

  return (
    <div className="space-y-2">
      {displayItems.map((item: RecentImportTask) => (
        <div key={item.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0">
          <div className="min-w-0 flex-1">
            <span className="truncate text-sm block font-medium" title={item.title}>{item.title}</span>
            <UniversalLink
              to={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary truncate block max-w-[200px]"
              title={item.sourceUrl}
            >
              {item.sourceUrl}
            </UniversalLink>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={item.status} styleMap={IMPORT_STATUS_STYLES} />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {dayjs(item.createdAt).fromNow()}
            </span>
            <Link to="/import/feishu" className="text-xs text-primary hover:underline">
              查看详情
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

// ========== Recent Publishes List ==========

function RecentPublishesList({
  items,
  loading,
}: {
  items: RecentPublishTask[];
  loading: boolean;
}) {
  if (loading) return <ListSkeleton />;

  const displayItems: RecentPublishTask[] = items.slice(0, LIST_DISPLAY_LIMIT);

  if (displayItems.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">暂无发布任务</p>;
  }

  return (
    <div className="space-y-2">
      {displayItems.map((item: RecentPublishTask) => (
        <div key={item.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0">
          <span className="truncate text-sm max-w-[120px]" title={item.taskName}>
            {item.taskName}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="bg-accent text-accent-foreground border-accent">
              {item.taskType}
            </Badge>
            <StatusBadge status={item.status} styleMap={PUBLISH_STATUS_STYLES} />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {dayjs(item.createdAt).fromNow()}
            </span>
            {item.status === '失败' && (
              <>
                <Link to="/publish-center" className="text-xs text-primary hover:underline">
                  查看日志
                </Link>
                <Link to="/publish-center" className="text-xs text-primary hover:underline">
                  重新执行
                </Link>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ========== Recent Updated Docs List ==========

function RecentUpdatedDocsList({
  items,
  loading,
}: {
  items: RecentUpdatedDoc[];
  loading: boolean;
}) {
  if (loading) return <ListSkeleton />;

  const displayItems: RecentUpdatedDoc[] = items.slice(0, LIST_DISPLAY_LIMIT);

  if (displayItems.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">暂无更新文档</p>;
  }

  return (
    <div className="space-y-2">
      {displayItems.map((item: RecentUpdatedDoc) => (
        <div key={item.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0">
          <div className="min-w-0 flex-1">
            <span className="truncate text-sm block" title={item.title}>{item.title}</span>
            <span className="text-xs text-muted-foreground">{item.firstCategory}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={item.publishStatus} styleMap={DOC_PUBLISH_STATUS_STYLES} />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {dayjs(item.updatedAt).fromNow()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ========== Section Card ==========

function SectionCard({
  title,
  linkTo,
  children,
}: {
  title: string;
  linkTo: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">{title}</h3>
          <Link
            to={linkTo}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            查看全部
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

// ========== Dashboard Page ==========

const DashboardPage: React.FC = () => {
  const [statistics, setStatistics] = useState<DashboardStatistics | null>(null);
  const [recentImports, setRecentImports] = useState<RecentImportTask[]>([]);
  const [recentPublishes, setRecentPublishes] = useState<RecentPublishTask[]>([]);
  const [recentUpdatedDocs, setRecentUpdatedDocs] = useState<RecentUpdatedDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [productionUrl, setProductionUrl] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [statsRes, importsRes, publishesRes, docsRes, configRes] = await Promise.all([
        dashboardApi.getStatistics(),
        dashboardApi.getRecentImports(10),
        dashboardApi.getRecentPublishes(10),
        dashboardApi.getRecentUpdatedDocs(10),
        systemConfigApi.getSystemConfig().catch(() => null),
      ]);
      setStatistics(statsRes);
      setRecentImports(importsRes.items);
      setRecentPublishes(publishesRes.items);
      setRecentUpdatedDocs(docsRes.items);
      if (configRes?.productionUrl) {
        setProductionUrl(configRes.productionUrl);
      }
    } catch (err: unknown) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted-foreground">数据加载失败，请重试</p>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="h-4 w-4" />
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Stat Cards */}
      <StatCards statistics={statistics} loading={loading} />

      {/* Quick Actions */}
      <div data-ai-section-type="card-menu" className="flex gap-3 flex-wrap">
        {QUICK_ACTIONS.map((action: typeof QUICK_ACTIONS[number]) => {
          const Icon = action.icon;
          return (
            <Link key={action.path} to={action.path}>
              <Button variant="default" className="gap-2">
                <Icon className="h-4 w-4" />
                {action.label}
                {action.path === '/publish-center' && (statistics?.pendingReviewCount ?? 0) > 0 && (
                  <Badge variant="outline" className="ml-1 bg-orange-50 text-orange-700 border-orange-200 text-xs px-1.5 py-0 h-5">
                    {statistics!.pendingReviewCount}
                  </Badge>
                )}
              </Button>
            </Link>
          );
        })}
        {productionUrl && (
          <Button
            variant="default"
            className="gap-2"
            onClick={() => window.open(productionUrl, '_blank')}
          >
            <ExternalLink className="h-4 w-4" />
            预览帮助中心
          </Button>
        )}
      </div>

      {/* Recent Activity */}
      <div data-ai-section-type="card-list" className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
      <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        <SectionCard title="最近导入" linkTo="/import/feishu">
          <RecentImportsList items={recentImports} loading={loading} />
        </SectionCard>
      </CanRole>
        <SectionCard title="最近发布" linkTo="/publish-center">
          <RecentPublishesList items={recentPublishes} loading={loading} />
        </SectionCard>
        <SectionCard title="最近更新文档" linkTo="/documents">
          <RecentUpdatedDocsList items={recentUpdatedDocs} loading={loading} />
        </SectionCard>
      </div>
    </div>
  );
};

export default DashboardPage;
