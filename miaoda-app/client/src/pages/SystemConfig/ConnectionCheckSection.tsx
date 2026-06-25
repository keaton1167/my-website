import React, { useState, useCallback } from 'react';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import dayjs from 'dayjs';
import { Loader2, RefreshCw, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import { toast } from 'sonner';
import { checkConnection } from '@client/src/api/system-config';
import type { ConnectionStatus, ConnectionType } from '@shared/api.interface';

const CONNECTION_ITEMS: {
  key: ConnectionType;
  label: string;
  statusField: string;
  checkedAtField: string;
}[] = [
  { key: 'git', label: 'Git 仓库连接状态', statusField: 'gitConnectionStatus', checkedAtField: 'gitLastCheckedAt' },
  { key: 'backendApi', label: '后端 API 连接状态', statusField: 'backendApiConnectionStatus', checkedAtField: 'backendApiLastCheckedAt' },
  { key: 'staging', label: '测试环境访问状态', statusField: 'stagingConnectionStatus', checkedAtField: 'stagingLastCheckedAt' },
  { key: 'production', label: '正式环境访问状态', statusField: 'productionConnectionStatus', checkedAtField: 'productionLastCheckedAt' },
  { key: 'server', label: '公司服务器连接状态', statusField: 'serverConnectionStatus', checkedAtField: 'serverLastCheckedAt' },
];

const STATUS_CONFIG: Record<ConnectionStatus, { color: string; icon: React.ElementType }> = {
  '未检测': { color: 'bg-gray-50 text-gray-600 border-gray-200', icon: MinusCircle },
  '正常': { color: 'bg-green-50 text-green-700 border-green-200', icon: CheckCircle2 },
  '异常': { color: 'bg-red-50 text-red-700 border-red-200', icon: XCircle },
};

interface ConnectionCheckSectionProps {
  config: Record<string, unknown>;
  onUpdateConfig: (updates: Record<string, unknown>) => void;
}

const ConnectionCheckSection: React.FC<ConnectionCheckSectionProps> = ({ config, onUpdateConfig }) => {
  const [checkingItems, setCheckingItems] = useState<Record<string, boolean>>({});

  const handleCheck = useCallback(async (item: typeof CONNECTION_ITEMS[number]) => {
    setCheckingItems((prev) => ({ ...prev, [item.key]: true }));
    try {
      const result = await checkConnection({ type: item.key });
      onUpdateConfig({
        [item.statusField]: result.status,
        [item.checkedAtField]: result.lastCheckedAt,
      });
      if (result.status === '正常') {
        toast.success(`${item.label}检测通过`);
      } else {
        toast.error(`${item.label}检测失败：${result.message ?? '未知错误'}`);
      }
    } catch {
      toast.error(`${item.label}检测失败`);
    } finally {
      setCheckingItems((prev) => ({ ...prev, [item.key]: false }));
    }
  }, [onUpdateConfig]);

  return (
    <Card className="border shadow-none">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">连接状态</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {CONNECTION_ITEMS.map((item) => {
            const status = (config[item.statusField] as ConnectionStatus) ?? '未检测';
            const checkedAt = config[item.checkedAtField] as string | undefined;
            const isChecking = checkingItems[item.key] ?? false;
            const statusConfig = STATUS_CONFIG[status];
            const StatusIcon = statusConfig.icon;

            return (
              <div
                key={item.key}
                className="flex items-center justify-between py-3 border-b last:border-b-0"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-sm font-medium shrink-0">{item.label}</span>
                  <Badge variant="outline" className={statusConfig.color}>
                    <StatusIcon className="h-3 w-3 mr-1" />
                    {status}
                  </Badge>
                  {checkedAt && (
                    <span className="text-xs text-muted-foreground truncate">
                      最近检测：{dayjs(checkedAt).format('YYYY-MM-DD HH:mm:ss')}
                    </span>
                  )}
                </div>
                <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isChecking}
                  onClick={() => handleCheck(item)}
                  className="shrink-0 ml-3"
                >
                  {isChecking ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  检测
                </Button>
                </CanRole>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default ConnectionCheckSection;
