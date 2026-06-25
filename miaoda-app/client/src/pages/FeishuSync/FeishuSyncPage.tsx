import React from 'react';
import SyncMappingTab from './SyncMappingTab';

const FeishuSyncPage: React.FC = () => {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">飞书文档同步</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          用于维护飞书云文档与帮助中心文档的一一映射关系，支持后续手动同步、批量同步和自动同步。
        </p>
      </div>
      <SyncMappingTab />
    </div>
  );
};

export default FeishuSyncPage;
