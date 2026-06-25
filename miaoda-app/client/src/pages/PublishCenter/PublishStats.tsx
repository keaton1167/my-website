import React from 'react';
import {
  BarChart3,
  Hammer,
  Rocket,
  ShieldAlert,
  AlertTriangle,
  Globe,
} from 'lucide-react';
import type { PublishStatsResponse } from '@shared/api.interface';

interface PublishStatsProps {
  stats: PublishStatsResponse | null;
}

const PUBLISH_STATS_CONFIG: {
  key: keyof PublishStatsResponse;
  label: string;
  icon: React.FC<{ className?: string }>;
  colorClass: string;
}[] = [
  { key: 'total', label: '发布总数', icon: BarChart3, colorClass: 'text-primary' },
  { key: 'buildCheckCount', label: '内容检查', icon: Hammer, colorClass: 'text-primary' },
  { key: 'stagingDeployCount', label: '预览环境发布', icon: Rocket, colorClass: 'text-primary' },
  { key: 'productionDeployCount', label: '正式发布', icon: ShieldAlert, colorClass: 'text-destructive' },
  { key: 'websitePublishCount', label: '发布到网站', icon: Globe, colorClass: 'text-primary' },
  { key: 'failedCount', label: '失败任务', icon: AlertTriangle, colorClass: 'text-destructive' },
];

const PublishStats: React.FC<PublishStatsProps> = ({ stats }) => {
  return (
    <div data-ai-section-type="card-stat" className="grid grid-cols-6 gap-4">
      {PUBLISH_STATS_CONFIG.map((config) => {
        const Icon = config.icon;
        const value = stats ? stats[config.key] : 0;
        return (
          <div
            key={config.key}
            className="rounded-md border bg-background p-4 flex items-center gap-3"
          >
            <Icon className={`size-5 shrink-0 ${config.colorClass}`} />
            <div>
              <div className="text-2xl font-semibold">{value}</div>
              <div className="text-xs text-muted-foreground">{config.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PublishStats;
