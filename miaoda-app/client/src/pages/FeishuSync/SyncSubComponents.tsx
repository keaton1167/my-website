import React from 'react';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import {
  RefreshCw,
  Search,
  RotateCcw,
  Plus,
  Pause,
  Trash2,
  Upload,
  BookOpen,
} from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { UserSelect } from '@client/src/components/business-ui/user-select';
import type {
  SyncMode,
  SyncStatus,
  CategoryOption,
} from '@shared/api.interface';
import { SYNC_MODE_OPTIONS, SYNC_STATUS_OPTIONS } from './SyncHelpers';

interface SyncFilterBarProps {
  resetKey: number;
  filterFirstCategory: string;
  setFilterFirstCategory: (v: string) => void;
  filterSecondCategory: string;
  setFilterSecondCategory: (v: string) => void;
  filterSyncMode: string;
  setFilterSyncMode: (v: string) => void;
  filterSyncStatus: string;
  setFilterSyncStatus: (v: string) => void;
  filterLanguage: string;
  setFilterLanguage: (v: string) => void;
  filterOwner: string;
  setFilterOwner: (v: string) => void;
  filterKeyword: string;
  setFilterKeyword: (v: string) => void;
  firstCategoryOptions: CategoryOption[];
  secondCategoryOptions: CategoryOption[];
  onSearch: () => void;
  onReset: () => void;
  onRefresh: () => void;
  onCreate: () => void;
  onWikiImport: () => void;
}

const SyncFilterBar: React.FC<SyncFilterBarProps> = ({
  resetKey, filterFirstCategory, setFilterFirstCategory,
  filterSecondCategory, setFilterSecondCategory,
  filterSyncMode, setFilterSyncMode, filterSyncStatus, setFilterSyncStatus,
  filterLanguage, setFilterLanguage, filterOwner, setFilterOwner,
  filterKeyword, setFilterKeyword,
  firstCategoryOptions, secondCategoryOptions,
  onSearch, onReset, onRefresh, onCreate, onWikiImport,
}) => (
  <div className="rounded-md border bg-background p-4 flex flex-col gap-3">
    <div className="flex items-center gap-3 flex-wrap">
      <Select key={`fc-${resetKey}`} value={filterFirstCategory || undefined} onValueChange={setFilterFirstCategory}>
        <SelectTrigger className="w-[200px]"><SelectValue placeholder="请选择一级目录" /></SelectTrigger>
        <SelectContent>
          {firstCategoryOptions.map((o: CategoryOption) => <SelectItem key={o.id} value={o.id}>{o.nameCn}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select key={`sc-${resetKey}`} value={filterSecondCategory || undefined} onValueChange={setFilterSecondCategory} disabled={!filterFirstCategory}>
        <SelectTrigger className="w-[200px]"><SelectValue placeholder={filterFirstCategory ? '请选择二级目录' : '请先选择一级目录'} /></SelectTrigger>
        <SelectContent>
          {secondCategoryOptions.map((o: CategoryOption) => <SelectItem key={o.id} value={o.id}>{o.nameCn}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select key={`sm-${resetKey}`} value={filterSyncMode || undefined} onValueChange={setFilterSyncMode}>
        <SelectTrigger className="w-[200px]"><SelectValue placeholder="请选择同步方式" /></SelectTrigger>
        <SelectContent>
          {SYNC_MODE_OPTIONS.map((m: SyncMode) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select key={`ss-${resetKey}`} value={filterSyncStatus || undefined} onValueChange={setFilterSyncStatus}>
        <SelectTrigger className="w-[200px]"><SelectValue placeholder="请选择同步状态" /></SelectTrigger>
        <SelectContent>
          {SYNC_STATUS_OPTIONS.map((s: SyncStatus) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select key={`lang-${resetKey}`} value={filterLanguage || undefined} onValueChange={setFilterLanguage}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="语言版本" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="zh-CN">中文</SelectItem>
          <SelectItem value="en">英文</SelectItem>
        </SelectContent>
      </Select>
      <div className="w-[200px]">
        <UserSelect key={`ow-${resetKey}`} value={filterOwner || null} onChange={(v: string | null) => setFilterOwner(v ?? '')} triggerType="search" placeholder="请选择负责人" />
      </div>
    </div>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="relative w-48">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="搜索飞书文档标题或帮助中心标题" value={filterKeyword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterKeyword(e.target.value)} className="pl-8" onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onSearch(); }} />
        </div>
        <Button size="sm" onClick={onSearch}><Search className="mr-1 size-3.5" />查询</Button>
        <Button variant="outline" size="sm" onClick={onReset}><RotateCcw className="mr-1 size-3.5" />重置</Button>
        <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="mr-1 size-3.5" />刷新</Button>
      </div>
      <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
        <Button variant="outline" size="sm" onClick={onWikiImport}><BookOpen className="mr-1 size-3.5" />知识库导入</Button>
      </CanRole>
      <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
        <Button size="sm" onClick={onCreate}><Plus className="mr-1 size-3.5" />新增映射</Button>
      </CanRole>
    </div>
  </div>
);

interface BatchOpsBarProps {
  selectedCount: number;
  onBatchCreate: () => void;
  onImport: () => void;
  onBatchSync: () => void;
  onBatchPause: () => void;
  onBatchDelete: () => void;
}

const BatchOpsBar: React.FC<BatchOpsBarProps> = ({ selectedCount, onBatchCreate, onImport, onBatchSync, onBatchPause, onBatchDelete }) => (
  <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
    <span className="text-sm text-muted-foreground mr-1">批量操作：</span>
    {selectedCount > 0 && <span className="text-sm text-primary font-medium mr-2">已选 {selectedCount} 条</span>}
    <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
      <Button size="sm" variant="outline" onClick={onBatchCreate}><Plus className="mr-1 size-3.5" />批量新增</Button>
    </CanRole>
    <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
      <Button size="sm" variant="outline" onClick={onImport}><Upload className="mr-1 size-3.5" />导入模板</Button>
    </CanRole>
    <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
      <Button size="sm" variant="outline" onClick={onBatchSync}><RefreshCw className="mr-1 size-3.5" />批量同步</Button>
    </CanRole>
    <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
      <Button size="sm" variant="outline" onClick={onBatchPause}><Pause className="mr-1 size-3.5" />批量暂停</Button>
    </CanRole>
    <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
      <Button size="sm" variant="outline" onClick={onBatchDelete} className="text-destructive hover:text-destructive"><Trash2 className="mr-1 size-3.5" />批量删除</Button>
    </CanRole>
  </div>
);

export { SyncFilterBar, BatchOpsBar };
export type { SyncFilterBarProps, BatchOpsBarProps };
