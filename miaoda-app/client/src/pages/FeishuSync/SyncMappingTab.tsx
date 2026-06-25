import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Link2,
  CheckCircle2,
  XCircle,
  PauseCircle,
  RefreshCw,
  ExternalLink,
  RotateCcw,
  MoreHorizontal,
  FileText,
  PlayCircle,
  Pause,
  Trash2,
  Pencil,
  ShieldCheck,
  Download,
} from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Card, CardContent } from '@client/src/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';
import { UserDisplay } from '@client/src/components/business-ui/user-display';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import { feishuMappingsApi, categoriesApi } from '@client/src/api';
import type {
  FeishuDocMapping,
  FeishuMappingStatistics,
  FeishuMappingListParams,
  SyncMode,
  SyncStatus,
  CategoryOption,
  Language,
} from '@shared/api.interface';
import {
  CreateMappingDialog,
  EditMappingDialog,
  PreviewMarkdownDialog,
  DeleteMappingDialog,
} from './MappingDialogs';
import SyncLogDialog from './SyncLogDialog';
import BatchCreateMappingDialog from './BatchCreateMappingDialog';
import ImportTemplateDialog from './ImportTemplateDialog';
import DrivePermissionDialog from './DrivePermissionDialog';
import SyncDialogs from './SyncDialogs';
import { WikiImportDialog } from './WikiImportDialog';
import { SyncFilterBar, BatchOpsBar } from './SyncSubComponents';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import {
  LanguageBadge,
  SyncStatusBadge,
  TranslationStatusBadge,
  SyncModeBadge,
  formatDate,
} from './SyncHelpers';

const SyncMappingTab: React.FC = () => {
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [statistics, setStatistics] = useState<FeishuMappingStatistics | null>(null);
  const [mappings, setMappings] = useState<FeishuDocMapping[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const [filterFirstCategory, setFilterFirstCategory] = useState('');
  const [filterSecondCategory, setFilterSecondCategory] = useState('');
  const [filterSyncMode, setFilterSyncMode] = useState('');
  const [filterSyncStatus, setFilterSyncStatus] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');

  const [appliedFirstCategory, setAppliedFirstCategory] = useState('');
  const [appliedSecondCategory, setAppliedSecondCategory] = useState('');
  const [appliedSyncMode, setAppliedSyncMode] = useState('');
  const [appliedSyncStatus, setAppliedSyncStatus] = useState('');
  const [appliedOwner, setAppliedOwner] = useState('');
  const [appliedLanguage, setAppliedLanguage] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  const [resetKey, setResetKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchCreateOpen, setBatchCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [wikiImportOpen, setWikiImportOpen] = useState(false);
  const [editMapping, setEditMapping] = useState<FeishuDocMapping | null>(null);
  const [previewData, setPreviewData] = useState<{ title: string; markdown: string; errorMessage?: string; errorCategory?: import('@shared/api.interface').FeishuErrorCategory } | null>(null);
  const [logData, setLogData] = useState<FeishuDocMapping | null>(null);
  const [permissionCheckMapping, setPermissionCheckMapping] = useState<FeishuDocMapping | null>(null);
  const [deleteMapping, setDeleteMapping] = useState<FeishuDocMapping | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [syncingIds, setSyncingIds] = useState<string[]>([]);
  const [batchSyncConfirmOpen, setBatchSyncConfirmOpen] = useState(false);
  const [pauseToggleData, setPauseToggleData] = useState<{ record: FeishuDocMapping; action: 'pause' | 'resume' } | null>(null);
  const [batchPausedCount, setBatchPausedCount] = useState(0);
  const [batchPauseConfirmOpen, setBatchPauseConfirmOpen] = useState(false);

  const firstCategoryOptions = categoryOptions.filter((o: CategoryOption) => o.level === 1);
  const secondCategoryOptions = categoryOptions.filter(
    (o: CategoryOption) => o.level === 2 && o.parentId === filterFirstCategory,
  );

  const loadCategories = useCallback(async () => {
    try {
      const result = await categoriesApi.getCategoryOptions(true);
      setCategoryOptions(result.items);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '加载目录失败');
    }
  }, []);

  const loadStatistics = useCallback(async () => {
    try {
      const result = await feishuMappingsApi.getMappingStatistics();
      setStatistics(result);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '加载统计失败');
    }
  }, []);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    try {
      const params: FeishuMappingListParams = { page, pageSize };
      if (appliedFirstCategory) params.targetFirstCategory = appliedFirstCategory;
      if (appliedSecondCategory) params.targetSecondCategory = appliedSecondCategory;
      if (appliedSyncMode) params.syncMode = appliedSyncMode as SyncMode;
      if (appliedSyncStatus) params.syncStatus = appliedSyncStatus as SyncStatus;
      if (appliedOwner) params.owner = appliedOwner;
      if (appliedLanguage) params.language = appliedLanguage as Language;
      if (appliedKeyword) params.keyword = appliedKeyword;
      const result = await feishuMappingsApi.getMappingList(params);
      setMappings(result.items);
      setTotal(result.total);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '加载映射列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, appliedFirstCategory, appliedSecondCategory, appliedSyncMode, appliedSyncStatus, appliedOwner, appliedLanguage, appliedKeyword]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadStatistics(); }, [loadStatistics]);
  useEffect(() => { loadMappings(); }, [loadMappings]);
  useEffect(() => { setFilterSecondCategory(''); }, [filterFirstCategory]);

  const handleRefresh = () => { loadMappings(); loadStatistics(); };

  const handleSearch = () => {
    setAppliedFirstCategory(filterFirstCategory);
    setAppliedSecondCategory(filterSecondCategory);
    setAppliedSyncMode(filterSyncMode);
    setAppliedSyncStatus(filterSyncStatus);
    setAppliedOwner(filterOwner);
    setAppliedLanguage(filterLanguage);
    setAppliedKeyword(filterKeyword);
    setPage(1);
  };

  const handleReset = () => {
    setFilterFirstCategory(''); setFilterSecondCategory(''); setFilterSyncMode('');
    setFilterSyncStatus(''); setFilterOwner(''); setFilterLanguage(''); setFilterKeyword('');
    setAppliedFirstCategory(''); setAppliedSecondCategory(''); setAppliedSyncMode('');
    setAppliedSyncStatus(''); setAppliedOwner(''); setAppliedLanguage(''); setAppliedKeyword('');
    setResetKey(prev => prev + 1);
    setPage(1);
  };

  const handleSyncOne = async (id: string) => {
    setSyncingIds((prev: string[]) => [...prev, id]);
    setMappings((prev: FeishuDocMapping[]) =>
      prev.map((m: FeishuDocMapping) =>
        m.id === id ? { ...m, syncStatus: '同步中' as SyncStatus } : m,
      ),
    );
    try {
      await feishuMappingsApi.syncOne(id);
      toast.success('同步完成');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncingIds((prev: string[]) => prev.filter((i: string) => i !== id));
      loadMappings();
      loadStatistics();
    }
  };

  const handleResyncOne = async (id: string) => {
    setLogData(null);
    await handleSyncOne(id);
  };

  const handleEditMappingSave = async (id: string, updates: Partial<FeishuDocMapping>) => {
    setMappings((prev: FeishuDocMapping[]) =>
      prev.map((m: FeishuDocMapping) => (m.id === id ? { ...m, ...updates } : m)),
    );
    try {
      await feishuMappingsApi.updateMapping({ id, ...updates });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
    loadMappings();
    loadStatistics();
  };

  const handleToggleSyncConfirm = async () => {
    if (!pauseToggleData) return;
    const { record, action } = pauseToggleData;
    const newStatus: SyncStatus = action === 'pause' ? '已暂停' : '未同步';
    setMappings((prev: FeishuDocMapping[]) =>
      prev.map((m: FeishuDocMapping) => m.id === record.id ? { ...m, syncStatus: newStatus } : m),
    );
    toast.success(action === 'pause' ? '已暂停同步' : '已恢复同步');
    setPauseToggleData(null);
    try {
      await feishuMappingsApi.updateMapping({ id: record.id, syncStatus: newStatus });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
    loadMappings();
    loadStatistics();
  };

  const handleBatchSync = () => {
    if (selectedKeys.length === 0) { toast.warning('请先选择需要同步的映射记录'); return; }
    const pausedCount = mappings.filter((m: FeishuDocMapping) => selectedKeys.includes(m.id) && m.syncStatus === '已暂停').length;
    setBatchPausedCount(pausedCount);
    setBatchSyncConfirmOpen(true);
  };

  const handleBatchSyncConfirm = async () => {
    setBatchSyncConfirmOpen(false);
    const ids = selectedKeys.filter((id: string) => {
      const m = mappings.find((r: FeishuDocMapping) => r.id === id);
      return m && m.syncStatus !== '已暂停';
    });
    if (ids.length === 0) { toast.warning('选中的记录均已暂停，无需同步'); return; }
    setSyncingIds(ids);
    setMappings((prev: FeishuDocMapping[]) =>
      prev.map((m: FeishuDocMapping) => ids.includes(m.id) ? { ...m, syncStatus: '同步中' as SyncStatus } : m),
    );
    try {
      const result = await feishuMappingsApi.syncBatch({ ids });
      if (result.failCount === 0) {
        toast.success(`批量同步完成：${result.successCount} 篇文档全部同步成功，已进入草稿状态`);
      } else if (result.successCount === 0) {
        toast.error(`批量同步失败：${result.failCount} 篇文档全部失败`);
      } else {
        toast.warning(`批量同步完成：成功 ${result.successCount} 篇，失败 ${result.failCount} 篇`);
      }
      if (result.errorMessages.length > 0) {
        const errMsg = result.errorMessages.slice(0, 5).join('\n');
        toast.error(`失败详情：\n${errMsg}`, { duration: 8000 });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '批量同步失败');
    } finally {
      setSyncingIds([]); setSelectedKeys([]); loadMappings(); loadStatistics();
    }
  };

  const handleBatchDelete = () => {
    if (selectedKeys.length === 0) { toast.warning('请先选择需要删除的映射记录'); return; }
    setBatchDeleteOpen(true);
  };

  const handleBatchDeleteConfirm = async () => {
    const deleteIds = [...selectedKeys];
    try {
      await Promise.all(deleteIds.map((id: string) => feishuMappingsApi.deleteMapping(id)));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '部分记录删除失败');
    }
    setSelectedKeys([]); setBatchDeleteOpen(false);
    toast.warning(`批量删除完成：已删除 ${deleteIds.length} 条映射`);
    loadMappings(); loadStatistics();
  };

  const handleBatchPause = () => {
    if (selectedKeys.length === 0) { toast.warning('请先选择需要暂停的映射记录'); return; }
    setBatchPauseConfirmOpen(true);
  };

  const handleBatchPauseConfirm = async () => {
    setBatchPauseConfirmOpen(false);
    const selectedMappings = mappings.filter((m: FeishuDocMapping) => selectedKeys.includes(m.id));
    let successCount = 0;
    let skipCount = 0;
    const pauseIds: string[] = [];
    selectedMappings.forEach((m: FeishuDocMapping) => {
      if (m.syncStatus === '已暂停' || m.syncStatus === '同步中') { skipCount++; }
      else { successCount++; pauseIds.push(m.id); }
    });
    if (pauseIds.length > 0) {
      await Promise.all(pauseIds.map((id: string) =>
        feishuMappingsApi.updateMapping({ id, syncStatus: '已暂停' as SyncStatus }).catch(() => {}),
      ));
    }
    setMappings((prev: FeishuDocMapping[]) =>
      prev.map((m: FeishuDocMapping) => pauseIds.includes(m.id) ? { ...m, syncStatus: '已暂停' as SyncStatus } : m),
    );
    setSelectedKeys([]); loadMappings(); loadStatistics();
    toast.warning(`批量暂停完成：成功 ${successCount} 条，跳过 ${skipCount} 条`);
  };

  const handlePreviewMarkdown = async (record: FeishuDocMapping) => {
    try {
      const result = await feishuMappingsApi.previewMarkdown(record.id);
      if (result.success) {
        setPreviewData({ title: result.title, markdown: result.markdown });
      } else {
        toast.error('预览失败，请查看详情');
        setPreviewData({
          title: record.helpCenterTitle,
          markdown: '',
          errorMessage: result.errorMessage || '无法获取预览内容',
          errorCategory: result.errorCategory,
        });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '预览请求失败');
    }
  };

  const nameMap = new Map<string, string>();
  categoryOptions.forEach((opt: CategoryOption) => { nameMap.set(opt.id, opt.nameCn); });

  const columns = [
    { title: '飞书文档标题', dataIndex: 'feishuDocTitle', key: 'feishuDocTitle', width: 180, fixed: 'left' as const, ellipsis: true,
      render: (text: string) => <span className="font-medium" title={text}>{text || '-'}</span> },
    { title: '飞书文档链接', dataIndex: 'feishuDocUrl', key: 'feishuDocUrl', width: 100,
      render: (url: string) => url ? (
        <UniversalLink to={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          <ExternalLink className="h-3.5 w-3.5 shrink-0" /><span>查看</span>
        </UniversalLink>
      ) : '-' },
    { title: '一级目录', dataIndex: 'targetFirstCategory', key: 'targetFirstCategory', width: 120,
      render: (id: string) => nameMap.get(id) ?? id ?? '-' },
    { title: '二级目录', dataIndex: 'targetSecondCategory', key: 'targetSecondCategory', width: 120,
      render: (id: string) => id ? (nameMap.get(id) ?? id) : '-' },
    { title: '帮助中心文档标题', dataIndex: 'helpCenterTitle', key: 'helpCenterTitle', width: 180, ellipsis: true },
    { title: '帮助中心路径标识', dataIndex: 'helpCenterSlug', key: 'helpCenterSlug', width: 140,
      render: (slug: string) => slug ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{slug}</code> : '-' },
    { title: '语言版本', dataIndex: 'language', key: 'language', width: 90,
      render: (lang: string) => <LanguageBadge language={lang || 'zh-CN'} /> },
    { title: '翻译组状态', dataIndex: 'translationStatus', key: 'translationStatus', width: 110,
      render: (status: string) => <TranslationStatusBadge status={status} /> },
    { title: '帮助中心文件路径', dataIndex: 'helpCenterFilePath', key: 'helpCenterFilePath', width: 200, ellipsis: true,
      render: (v: string) => v ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{v}</code> : '-' },
    { title: '同步方式', dataIndex: 'syncMode', key: 'syncMode', width: 120,
      render: (mode: SyncMode) => <SyncModeBadge mode={mode} /> },
    { title: '同步状态', dataIndex: 'syncStatus', key: 'syncStatus', width: 110,
      render: (status: SyncStatus, record: FeishuDocMapping) => {
        if (status === '同步失败') {
          return (
            <span title="同步失败，请查看同步日志了解详情">
              <SyncStatusBadge status={status} />
            </span>
          );
        }
        return <SyncStatusBadge status={status} />;
      } },
    { title: '上次同步时间', dataIndex: 'lastSyncAt', key: 'lastSyncAt', width: 150,
      render: (v: string) => formatDate(v) },
    { title: '负责人', dataIndex: 'owner', key: 'owner', width: 120,
      render: (v: string) => v ? <UserDisplay value={[v]} size="small" /> : '-' },
    { title: '操作', key: 'actions', width: 200, fixed: 'right' as const,
      render: (_: unknown, record: FeishuDocMapping) => (
        <div className="flex items-center gap-1">
          {record.syncStatus === '同步中' || syncingIds.includes(record.id) ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled>
              <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />同步中
            </Button>
          ) : record.syncStatus === '同步成功' ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleSyncOne(record.id)}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />重新同步
            </Button>
          ) : record.syncStatus === '同步失败' ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleSyncOne(record.id)}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />重试同步
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={record.syncStatus === '已暂停'} onClick={() => handleSyncOne(record.id)}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />手动同步
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLogData(record)}>
            <FileText className="mr-1 h-3.5 w-3.5" />日志
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-1.5"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handlePreviewMarkdown(record)}>
                <FileText className="mr-2 h-4 w-4" />预览 Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditMapping(record)} disabled={syncingIds.includes(record.id)}>
                <Pencil className="mr-2 h-4 w-4" />编辑映射
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {record.syncStatus === '已暂停' ? (
                <DropdownMenuItem onClick={() => setPauseToggleData({ record, action: 'resume' })} disabled={syncingIds.includes(record.id)}>
                  <PlayCircle className="mr-2 h-4 w-4" />恢复同步
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setPauseToggleData({ record, action: 'pause' })} disabled={syncingIds.includes(record.id)}>
                  <Pause className="mr-2 h-4 w-4" />暂停同步
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPermissionCheckMapping(record)}>
                <ShieldCheck className="mr-2 h-4 w-4" />诊断权限
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteMapping(record)} disabled={syncingIds.includes(record.id)}>
                <Trash2 className="mr-2 h-4 w-4" />删除映射
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) },
  ];

  const statCards = [
    { label: '映射总数', value: statistics?.totalCount ?? 0, icon: Link2, color: 'text-primary' },
    { label: '同步成功', value: statistics?.syncSuccessCount ?? 0, icon: CheckCircle2, color: 'text-success' },
    { label: '同步失败', value: statistics?.syncFailedCount ?? 0, icon: XCircle, color: 'text-destructive' },
    { label: '已暂停', value: statistics?.pausedCount ?? 0, icon: PauseCircle, color: 'text-warning' },
    { label: '今日同步', value: statistics?.todaySyncCount ?? 0, icon: RefreshCw, color: 'text-muted-foreground' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-4" data-ai-section-type="card-stat">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <card.icon className={`h-8 w-8 ${card.color}`} />
              <div>
                <div className="text-2xl font-semibold">{card.value}</div>
                <div className="text-sm text-muted-foreground">{card.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <SyncFilterBar
        resetKey={resetKey}
        filterFirstCategory={filterFirstCategory} setFilterFirstCategory={setFilterFirstCategory}
        filterSecondCategory={filterSecondCategory} setFilterSecondCategory={setFilterSecondCategory}
        filterSyncMode={filterSyncMode} setFilterSyncMode={setFilterSyncMode}
        filterSyncStatus={filterSyncStatus} setFilterSyncStatus={setFilterSyncStatus}
        filterLanguage={filterLanguage} setFilterLanguage={setFilterLanguage}
        filterOwner={filterOwner} setFilterOwner={setFilterOwner}
        filterKeyword={filterKeyword} setFilterKeyword={setFilterKeyword}
        firstCategoryOptions={firstCategoryOptions} secondCategoryOptions={secondCategoryOptions}
        onSearch={handleSearch} onReset={handleReset} onRefresh={handleRefresh}
        onCreate={() => setCreateOpen(true)}
        onWikiImport={() => setWikiImportOpen(true)}
      />

      <BatchOpsBar
        selectedCount={selectedKeys.length}
        onBatchCreate={() => setBatchCreateOpen(true)}
        onImport={() => setImportOpen(true)}
        onBatchSync={handleBatchSync}
        onBatchPause={handleBatchPause}
        onBatchDelete={handleBatchDelete}
      />

      <div className="rounded-md border bg-background">
        <Table<FeishuDocMapping>
          rowKey="id"
          columns={columns}
          dataSource={mappings}
          loading={loading}
          scroll={{ x: 1910, y: 500 }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys: React.Key[]) => setSelectedKeys(keys as string[]),
          }}
          pagination={{
            current: page, pageSize, total, showSizeChanger: true,
            onChange: (p: number, ps: number) => { setPage(p); setPageSize(ps); },
          }}
        />
      </div>

      <CreateMappingDialog open={createOpen} onOpenChange={setCreateOpen} categoryOptions={categoryOptions} onSuccess={handleRefresh} />
      <EditMappingDialog
        open={!!editMapping} onOpenChange={(v: boolean) => { if (!v) setEditMapping(null); }}
        mapping={editMapping} categoryOptions={categoryOptions} onSuccess={handleRefresh}
        onSave={handleEditMappingSave} currentSyncStatus={editMapping?.syncStatus ?? '未同步'}
      />
      <PreviewMarkdownDialog
        open={!!previewData} onOpenChange={(v: boolean) => { if (!v) setPreviewData(null); }}
        title={previewData?.title ?? ''} markdown={previewData?.markdown ?? ''}
        errorMessage={previewData?.errorMessage} errorCategory={previewData?.errorCategory}
      />
      <SyncLogDialog open={!!logData} onOpenChange={(v: boolean) => { if (!v) setLogData(null); }} mapping={logData} onResync={handleResyncOne} />
      <DrivePermissionDialog open={!!permissionCheckMapping} onOpenChange={(v: boolean) => { if (!v) setPermissionCheckMapping(null); }} mapping={permissionCheckMapping} onRetryComplete={handleRefresh} />
      <DeleteMappingDialog
        open={!!deleteMapping} onOpenChange={(v: boolean) => { if (!v) setDeleteMapping(null); }}
        mapping={deleteMapping} onSuccess={handleRefresh}
      />
      <BatchCreateMappingDialog open={batchCreateOpen} onOpenChange={setBatchCreateOpen} categoryOptions={categoryOptions} onSuccess={handleRefresh} />
      <ImportTemplateDialog open={importOpen} onOpenChange={setImportOpen} categoryOptions={categoryOptions} onSuccess={handleRefresh} />
      <WikiImportDialog open={wikiImportOpen} onOpenChange={setWikiImportOpen} categoryOptions={categoryOptions} onSuccess={handleRefresh} />
      <SyncDialogs
        batchDeleteOpen={batchDeleteOpen} setBatchDeleteOpen={setBatchDeleteOpen}
        batchDeleteCount={selectedKeys.length}
        batchDeleteHasSuccess={mappings.some((m: FeishuDocMapping) => selectedKeys.includes(m.id) && m.syncStatus === '同步成功')}
        onBatchDeleteConfirm={handleBatchDeleteConfirm}
        batchSyncOpen={batchSyncConfirmOpen} setBatchSyncOpen={setBatchSyncConfirmOpen}
        batchSyncCount={selectedKeys.length} batchSyncPausedCount={batchPausedCount}
        onBatchSyncConfirm={handleBatchSyncConfirm}
        batchPauseOpen={batchPauseConfirmOpen} setBatchPauseOpen={setBatchPauseConfirmOpen}
        batchPauseCount={selectedKeys.length} onBatchPauseConfirm={handleBatchPauseConfirm}
        pauseToggleOpen={!!pauseToggleData} setPauseToggleOpen={(v: boolean) => { if (!v) setPauseToggleData(null); }}
        pauseToggleAction={pauseToggleData?.action ?? null} onPauseToggleConfirm={handleToggleSyncConfirm}
      />
    </div>
  );
};

export default SyncMappingTab;
