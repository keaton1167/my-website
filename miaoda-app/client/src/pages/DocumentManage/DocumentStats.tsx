import React from 'react';
import { FileText, FileX, Clock, Send, CheckCircle, AlertTriangle, FilePen, ImageOff } from 'lucide-react';
import type { DocStatistics } from '@shared/api.interface';

interface DocumentStatsProps {
  stats: DocStatistics;
}

const DOC_STATS_CONFIG: {
  key: keyof DocStatistics;
  label: string;
  icon: React.FC<{ className?: string }>;
  colorClass: string;
}[] = [
  { key: 'totalDocs', label: '全部内容', icon: FileText, colorClass: 'text-primary' },
  { key: 'draftCount', label: '草稿', icon: FilePen, colorClass: 'text-muted-foreground' },
  { key: 'noContentCount', label: '需补正文', icon: FileX, colorClass: 'text-muted-foreground' },
  { key: 'pendingReviewCount', label: '待审核', icon: Clock, colorClass: 'text-warning' },
  { key: 'pendingPublishCount', label: '待发布', icon: Send, colorClass: 'text-blue-500' },
  { key: 'publishedCount', label: '已发布', icon: CheckCircle, colorClass: 'text-success' },
  { key: 'failedImportCount', label: '需处理异常', icon: AlertTriangle, colorClass: 'text-destructive' },
  { key: 'resourceErrorCount', label: '资源异常', icon: ImageOff, colorClass: 'text-destructive' },
];

const DocumentStats: React.FC<DocumentStatsProps> = ({ stats }) => {
  return (
    <div data-ai-section-type="card-stat" className="grid grid-cols-4 md:grid-cols-7 gap-4">
      {DOC_STATS_CONFIG.map((config) => {
        const Icon = config.icon;
        return (
          <div
            key={config.key}
            className="rounded-md border bg-background p-4 flex items-center gap-3"
          >
            <Icon className={`size-5 shrink-0 ${config.colorClass}`} />
            <div>
              <div className="text-2xl font-semibold">{stats[config.key]}</div>
              <div className="text-xs text-muted-foreground">{config.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DocumentStats;
