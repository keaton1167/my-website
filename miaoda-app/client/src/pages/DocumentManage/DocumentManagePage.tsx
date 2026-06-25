import React, { useState, useEffect, useCallback } from 'react';
import { Plus, ExternalLink, RefreshCw, Loader2, Archive, Package, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@client/src/components/ui/empty';
import { Textarea } from '@client/src/components/ui/textarea';
import { FileText } from 'lucide-react';
import { UserDisplay } from '@client/src/components/business-ui/user-display';
import { documentsApi, categoriesApi, publishApi } from '@client/src/api';
import { Badge } from '@client/src/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import type {
  DocItem,
  DocDetailResponse,
  DocStatistics,
  DocListResponse,
  CategoryOption,
  PublishStatus,
  ContentStatus,
  Language,
  TranslationStatus,
} from '@shared/api.interface';
import DocumentStats from './DocumentStats';
import DocumentFilters from './DocumentFilters';
import DocumentGroupView from './DocumentGroupView';
import DocumentTable from './DocumentTable';
import DocumentFormDialog from './DocumentFormDialog';
import MoveDocDialog from './MoveDocDialog';
import BatchActions from './BatchActions';
import CreateEnglishVersionDialog from './CreateEnglishVersionDialog';
import DocumentDetailDialog from './DocumentDetailDialog';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import { openPreviewInNewWindow } from './preview-url';

const EMPTY_STATS: DocStatistics = {
  totalDocs: 0,
  draftCount: 0,
  noContentCount: 0,
  pendingReviewCount: 0,
  pendingPublishCount: 0,
  publishedCount: 0,
  failedImportCount: 0,
  resourceErrorCount: 0,
};

const DocumentManagePage: React.FC = () => {
  const [stats, setStats] = useState<DocStatistics>(EMPTY_STATS);
  const [listData, setListData] = useState<DocListResponse>({
    items: [],
    total: 0,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);

  const [firstCategory, setFirstCategory] = useState<string>('');
  const [secondCategory, setSecondCategory] = useState<string>('');
  const [publishStatus, setPublishStatus] = useState<string>('');
  const [contentStatus, setContentStatus] = useState<string>('');
  const [language, setLanguage] = useState<string>('');
  const [owner, setOwner] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');
  const [previewDeployed, setPreviewDeployed] = useState<boolean>(false);
  const [draftPreviewGenerating, setDraftPreviewGenerating] = useState<boolean>(false);
  const [otherTaskRunning, setOtherTaskRunning] = useState<boolean>(false);
  const [draftTaskRunning, setDraftTaskRunning] = useState<boolean>(false);
  const [buildArtifactLoading, setBuildArtifactLoading] = useState<boolean>(false);
  const [buildArtifactTaskId, setBuildArtifactTaskId] = useState<string | null>(null);
  const [translationStatus, setTranslationStatus] = useState<string>('');
  const [viewMode, setViewMode] = useState<'group' | 'table'>('table');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [filterResetKey, setFilterResetKey] = useState<number>(0);

  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [viewDetailDoc, setViewDetailDoc] = useState<DocItem | null>(null);
  const [detailData, setDetailData] = useState<DocDetailResponse | null>(null);

  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<DocItem | null>(null);
  const [moveDoc, setMoveDocItem] = useState<DocItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocItem | null>(null);
  const [createEnDoc, setCreateEnDoc] = useState<DocItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DocItem | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [archiveTarget, setArchiveTarget] = useState<DocItem | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data: DocStatistics = await documentsApi.getStatistics();
      setStats(data);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '加载统计失败';
      toast.error(errorMsg);
    }
  }, []);

  const doFetch = useCallback(async (params: {
    firstCategory: string;
    secondCategory: string;
    publishStatus: string;
    contentStatus: string;
    language: string;
    owner: string;
    keyword: string;
    translationStatus: string;
    page: number;
    pageSize: number;
  }) => {
    setLoading(true);
    try {
      const data: DocListResponse = await documentsApi.getDocList({
        firstCategory: params.firstCategory || undefined,
        secondCategory: params.secondCategory || undefined,
        publishStatus: (params.publishStatus || undefined) as PublishStatus | undefined,
        contentStatus: (params.contentStatus || undefined) as ContentStatus | undefined,
        language: (params.language || undefined) as Language | undefined,
        owner: params.owner || undefined,
        keyword: params.keyword || undefined,
        translationStatus: (params.translationStatus || undefined) as TranslationStatus | undefined,
        page: params.page,
        pageSize: params.pageSize,
      });
      setListData(data);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '加载列表失败';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCurrentList = () => doFetch({
    firstCategory, secondCategory, publishStatus, contentStatus, language, owner, keyword, translationStatus, page, pageSize,
  });

  const fetchCategoryOptions = useCallback(async () => {
    try {
      const res = await categoriesApi.getCategoryOptions(true);
      setCategoryOptions(res.items);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '加载目录选项失败';
      toast.error(errorMsg);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
    void fetchCategoryOptions();
  }, [fetchStats, fetchCategoryOptions]);

  useEffect(() => {
    void fetchCurrentList();
  }, []);

  const handleOpenCreate = (): void => {
    setEditingItem(null);
    setFormOpen(true);
  };

  const handleEdit = (doc: DocItem): void => {
    setEditingItem(doc);
    setFormOpen(true);
  };

  const handleViewDetail = async (doc: DocItem): Promise<void> => {
    setViewDetailDoc(doc);
    try {
      const data = await documentsApi.getDocumentDetail(doc.id);
      setDetailData(data);
    } catch {
      setDetailData(null);
    }
  };

  const handleSubmitReview = async (doc: DocItem): Promise<void> => {
    if (doc.contentStatus === '无正文') {
      toast.error('请先补充正文后再提交审核');
      return;
    }
    try {
      await documentsApi.submitReview(doc.id);
      toast.success('已提交审核');
      void fetchCurrentList();
      void fetchStats();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '提交审核失败';
      toast.error(errorMsg);
    }
  };

  const handleApprove = async (doc: DocItem): Promise<void> => {
    try {
      await documentsApi.approveDoc(doc.id);
      toast.success(`审核通过，文档「${doc.title}」已进入待发布状态`);
      void fetchCurrentList();
      void fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '审核通过失败';
      toast.error(msg);
    }
  };

  const handleReject = (doc: DocItem): void => {
    setRejectTarget(doc);
    setRejectReason('');
  };

  const confirmReject = async (): Promise<void> => {
    if (!rejectTarget) return;
    try {
      await documentsApi.rejectDoc(rejectTarget.id);
      toast.success(`「${rejectTarget.title}」已驳回，文档已回退到草稿`);
      setRejectTarget(null);
      setRejectReason('');
      void fetchCurrentList();
      void fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '驳回失败';
      toast.error(msg);
    }
  };

  const handleArchive = (doc: DocItem): void => {
    setArchiveTarget(doc);
  };

  const confirmArchive = async (): Promise<void> => {
    if (!archiveTarget) return;
    try {
      await documentsApi.archiveDoc(archiveTarget.id);
      toast.success(`「${archiveTarget.title}」已归档`);
      setArchiveTarget(null);
      void fetchCurrentList();
      void fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '归档失败';
      toast.error(msg);
    }
  };

  const handleMove = (doc: DocItem): void => {
    setMoveDocItem(doc);
  };

  const handleDelete = (doc: DocItem): void => {
    setDeleteTarget(doc);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await documentsApi.deleteDoc(deleteTarget.id);
      toast.success('删除成功');
      setDeleteTarget(null);
      void fetchCurrentList();
      void fetchStats();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '删除失败';
      toast.error(errorMsg);
    }
  };

  const handleCreateEnglishVersion = (doc: DocItem): void => {
    setCreateEnDoc(doc);
  };

  const handleCreateEnSuccess = (): void => {
    setCreateEnDoc(null);
    void fetchCurrentList();
    void fetchStats();
  };

  const handleFormSuccess = (): void => {
    setFormOpen(false);
    setEditingItem(null);
    void fetchCurrentList();
    void fetchStats();
  };

  const handleMoveSuccess = (): void => {
    setMoveDocItem(null);
    void fetchCurrentList();
  };

  const handleSearch = (): void => {
    setPage(1);
    void doFetch({ firstCategory, secondCategory, publishStatus, contentStatus, language, owner, keyword, translationStatus, page: 1, pageSize });
  };

  const handleReset = (): void => {
    setFirstCategory('');
    setSecondCategory('');
    setPublishStatus('');
    setContentStatus('');
    setLanguage('');
    setOwner('');
    setKeyword('');
    setTranslationStatus('');
    setPage(1);
    setSelectedRowKeys([]);
    setFilterResetKey(prev => prev + 1);
    void doFetch({ firstCategory: '', secondCategory: '', publishStatus: '', contentStatus: '', language: '', owner: '', keyword: '', translationStatus: '', page: 1, pageSize });
  };

  const handleRefresh = (): void => {
    void fetchCurrentList();
    void fetchStats();
  };

  const nameMap = new Map<string, string>();
  categoryOptions.forEach((opt: CategoryOption) => {
    nameMap.set(opt.id, opt.nameCn);
  });

  useEffect(() => {
    publishApi.getPreviewStatus()
      .then((data: { deployed: boolean }) => setPreviewDeployed(data.deployed))
      .catch(() => setPreviewDeployed(false));
  }, []);

  const refreshPreviewState = useCallback(() => {
    publishApi.getPreviewStatus()
      .then((data: { deployed: boolean }) => setPreviewDeployed(data.deployed))
      .catch(() => setPreviewDeployed(false));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      publishApi.getRunningTasks()
        .then((running: string[]) => {
          const othersRunning = running.some((t: string) => t !== '草稿预览' && t !== '构建产物包');
          setOtherTaskRunning(othersRunning);
          setDraftTaskRunning(running.includes('草稿预览'));
          if (running.includes('构建产物包')) setBuildArtifactLoading(true);
        })
        .catch(() => { /* ignore */ });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleGenerateDraftPreview = useCallback(async () => {
    try {
      const running = await publishApi.getRunningTasks();
      if (running.length > 0) {
        toast.error(`当前有任务正在执行: ${running.join(', ')}，请等待完成后再试`);
        return;
      }
    } catch {
      /* pre-check failed, proceed anyway */
    }
    setDraftPreviewGenerating(true);
    try {
      await publishApi.deployDraftPreview();
      const pollInterval = setInterval(async () => {
        try {
          const running = await publishApi.getRunningTasks();
          if (!running.includes('草稿预览')) {
            clearInterval(pollInterval);
            setDraftPreviewGenerating(false);
            const status = await publishApi.getPreviewStatus();
            if (status.deployed) {
              setPreviewDeployed(true);
              toast.success('草稿预览已生成');
            } else {
              toast.error('草稿预览生成失败，请查看任务日志');
            }
          }
        } catch {
          clearInterval(pollInterval);
          setDraftPreviewGenerating(false);
        }
      }, 3000);
    } catch (err: unknown) {
      setDraftPreviewGenerating(false);
      const msg = err instanceof Error ? err.message : '生成草稿预览失败';
      toast.error(msg);
    }
  }, []);

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">内容管理</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={draftPreviewGenerating || otherTaskRunning || draftTaskRunning}
            onClick={handleGenerateDraftPreview}
            title={draftTaskRunning ? '草稿预览任务运行中，请等待完成' : otherTaskRunning ? '其他发布任务运行中，请等待完成' : '将重新生成所有有正文文档的草稿预览站点'}
          >
            {draftPreviewGenerating ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 size-4" />
            )}
            {draftPreviewGenerating ? '生成中...' : (previewDeployed ? '更新全部草稿预览' : '生成/更新全部草稿预览')}
          </Button>
          {previewDeployed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void openPreviewInNewWindow('/api/preview/help-center/'); }}
            >
              <ExternalLink className="mr-1 size-4" />
              打开草稿预览
            </Button>
          )}
          <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
          <Button
            variant="outline"
            size="sm"
            disabled={buildArtifactLoading || otherTaskRunning}
            onClick={async () => {
              setBuildArtifactLoading(true);
              try {
                const result = await publishApi.triggerBuildArtifact();
                setBuildArtifactTaskId(result.id);
                toast.success('构建产物包任务已创建，正在执行中（约 5-10 分钟）...');
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : '创建构建产物包任务失败';
                toast.error(msg);
              } finally {
                setBuildArtifactLoading(false);
              }
            }}
            title={otherTaskRunning ? '其他发布任务运行中，请等待完成' : '生成正式 build.zip 包含全部文档'}
            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            {buildArtifactLoading ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Package className="mr-1 size-4" />
            )}
            生成正式 build 包
          </Button>
          </CanRole>
          {buildArtifactTaskId && (
            <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await publishApi.downloadBuildArtifact(buildArtifactTaskId);
                  toast.success('下载成功');
                } catch (err) {
                  const message = err instanceof Error ? err.message : '下载失败';
                  toast.error(message);
                }
              }}
              className="border-blue-200 text-blue-700 hover:bg-blue-50"
            >
              <Download className="mr-1 size-4" />
              下载 build.zip
            </Button>
            </CanRole>
          )}
          <Button onClick={handleOpenCreate}>
            <Plus className="mr-1 size-4" />
            新建文档
          </Button>
        </div>
      </div>

      <DocumentStats stats={stats} />

      <DocumentFilters
        filterResetKey={filterResetKey}
        firstCategory={firstCategory}
        secondCategory={secondCategory}
        publishStatus={publishStatus}
        contentStatus={contentStatus}
        language={language}
        owner={owner}
        keyword={keyword}
        viewMode={viewMode}
        categoryOptions={categoryOptions}
        onFirstCategoryChange={(v: string) => { setFirstCategory(v); }}
        onSecondCategoryChange={(v: string) => { setSecondCategory(v); }}
        onPublishStatusChange={(v: string) => { setPublishStatus(v); }}
        onContentStatusChange={(v: string) => { setContentStatus(v); }}
        translationStatus={translationStatus}
        onLanguageChange={(v: string) => { setLanguage(v); }}
        onOwnerChange={(v: string) => { setOwner(v); }}
        onKeywordChange={(v: string) => { setKeyword(v); }}
        onTranslationStatusChange={(v: string) => { setTranslationStatus(v); }}
        onSearch={handleSearch}
        onReset={handleReset}
        onRefresh={handleRefresh}
        onViewModeChange={setViewMode}
      />

      <BatchActions
        selectedRowKeys={selectedRowKeys}
        docs={listData.items}
        categoryOptions={categoryOptions}
        onClearSelection={() => setSelectedRowKeys([])}
        onActionComplete={() => { void fetchCurrentList(); void fetchStats(); }}
      />

      {listData.items.length === 0 && !loading ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText className="size-6" />
            </EmptyMedia>
            <EmptyTitle>暂无文档</EmptyTitle>
            <EmptyDescription>点击右上角新建文档开始创建</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : viewMode === 'group' ? (
        <DocumentGroupView
          docs={listData.items}
          categoryOptions={categoryOptions}
          onEdit={handleEdit}
          onViewDetail={handleViewDetail}
          onSubmitReview={handleSubmitReview}
          onApprove={handleApprove}
          onReject={handleReject}
          onArchive={handleArchive}
          onMove={handleMove}
          onDelete={handleDelete}
          onCreateEnglishVersion={handleCreateEnglishVersion}
        />
      ) : (
        <DocumentTable
          docs={listData.items}
          total={listData.total}
          page={page}
          pageSize={pageSize}
          loading={loading}
          categoryOptions={categoryOptions}
          selectedRowKeys={selectedRowKeys}
          onSelectionChange={setSelectedRowKeys}
          onPageChange={(p: number, ps: number) => {
            setPage(p);
            setPageSize(ps);
            void doFetch({ firstCategory, secondCategory, publishStatus, contentStatus, language, owner, keyword, translationStatus, page: p, pageSize: ps });
          }}
          onEdit={handleEdit}
          onViewDetail={handleViewDetail}
          onSubmitReview={handleSubmitReview}
          onApprove={handleApprove}
          onReject={handleReject}
          onArchive={handleArchive}
          onMove={handleMove}
          onDelete={handleDelete}
          onCreateEnglishVersion={handleCreateEnglishVersion}
        />
      )}

      <DocumentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingItem={editingItem}
        onSuccess={handleFormSuccess}
      />

      <MoveDocDialog
        open={!!moveDoc}
        onOpenChange={(open: boolean) => {
          if (!open) setMoveDocItem(null);
        }}
        doc={moveDoc}
        onSuccess={handleMoveSuccess}
      />

      <CreateEnglishVersionDialog
        open={!!createEnDoc}
        onOpenChange={(open: boolean) => { if (!open) setCreateEnDoc(null); }}
        zhDoc={createEnDoc}
        onSuccess={handleCreateEnSuccess}
      />

      <DocumentDetailDialog
        doc={viewDetailDoc}
        detailData={detailData}
        onClose={() => { setViewDetailDoc(null); setDetailData(null); }}
        categoryNameMap={nameMap}
        previewDeployed={previewDeployed}
        onPreviewGenerated={refreshPreviewState}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open: boolean) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除文档「{deleteTarget?.title}」？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!rejectTarget} onOpenChange={(open: boolean) => { if (!open) { setRejectTarget(null); setRejectReason(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>驳回修改</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              确定驳回文档「{rejectTarget?.title}」？驳回后文档将回退到草稿状态。
            </p>
            <div>
              <label className="text-sm font-medium mb-1 block">驳回原因（选填）</label>
              <Textarea
                rows={3}
                placeholder="请输入驳回原因..."
                value={rejectReason}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(''); }}>取消</Button>
            <Button variant="destructive" onClick={confirmReject}>确认驳回</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(open: boolean) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认归档</AlertDialogTitle>
            <AlertDialogDescription>
              确定归档文档「{archiveTarget?.title}」？归档后文档将不再参与发布流程。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive}>
              确认归档
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DocumentManagePage;
