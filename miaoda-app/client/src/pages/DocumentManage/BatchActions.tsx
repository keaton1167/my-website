import React, { useState, useEffect } from 'react';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import { Send, FolderInput, Trash2, FileDown, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
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
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import * as XLSX from 'xlsx';
import { documentsApi, categoriesApi } from '@client/src/api';
import type { DocItem, CategoryOption, BatchActionResponse } from '@shared/api.interface';

interface BatchActionsProps {
  selectedRowKeys: string[];
  docs: DocItem[];
  categoryOptions: CategoryOption[];
  onClearSelection: () => void;
  onActionComplete: () => void;
}

const BatchActions: React.FC<BatchActionsProps> = ({
  selectedRowKeys,
  docs,
  categoryOptions,
  onClearSelection,
  onActionComplete,
}) => {
  const [batchMoveOpen, setBatchMoveOpen] = useState<boolean>(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState<boolean>(false);
  const [moveFirstCategory, setMoveFirstCategory] = useState<string>('');
  const [moveSecondCategory, setMoveSecondCategory] = useState<string>('');
  const [moveCategoryOptions, setMoveCategoryOptions] = useState<CategoryOption[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const selectedDocs = docs.filter((d: DocItem) => selectedRowKeys.includes(d.id));
  const pendingCount = selectedDocs.filter((d: DocItem) => d.publishStatus === '待审核').length;
  const draftCount = selectedDocs.filter((d: DocItem) => d.publishStatus === '草稿').length;

  const showBatchResult = (res: BatchActionResponse, action: string): void => {
    const parts: string[] = [];
    if (res.successCount > 0) parts.push(`成功 ${res.successCount} 篇`);
    if (res.skippedCount > 0) parts.push(`跳过 ${res.skippedCount} 篇（非目标状态）`);
    if (res.failCount > 0) parts.push(`失败 ${res.failCount} 篇`);
    if (res.successCount > 0) {
      toast.success(`${action}完成：${parts.join('，')}`);
    } else {
      toast.warning(`${action}：${parts.join('，')}`);
    }
  };

  useEffect(() => {
    if (batchMoveOpen) {
      void categoriesApi.getCategoryOptions(true).then((res) => {
        setMoveCategoryOptions(res.items);
      });
    }
  }, [batchMoveOpen]);

  const level1Options = moveCategoryOptions.filter(
    (opt: CategoryOption) => opt.level === 1,
  );
  const level2Options = moveCategoryOptions.filter((opt: CategoryOption) => {
    if (!moveFirstCategory) return opt.level === 2;
    return opt.level === 2 && opt.parentId === moveFirstCategory;
  });

  const handleBatchSubmitReview = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const res = await documentsApi.batchSubmitReview({ ids: selectedRowKeys });
      showBatchResult(res, '批量提交审核');
      onClearSelection();
      onActionComplete();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '批量提交审核失败';
      toast.error(msg);
      logger.error(`Batch submit review error: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchApprove = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const res = await documentsApi.batchApprove({ ids: selectedRowKeys });
      showBatchResult(res, '批量审核通过');
      onClearSelection();
      onActionComplete();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '批量审核通过失败';
      toast.error(msg);
      logger.error(`Batch approve error: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchReject = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const res = await documentsApi.batchReject({ ids: selectedRowKeys });
      showBatchResult(res, '批量驳回');
      onClearSelection();
      onActionComplete();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '批量驳回失败';
      toast.error(msg);
      logger.error(`Batch reject error: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchMove = async (): Promise<void> => {
    if (!moveFirstCategory) {
      toast.error('请选择目标一级目录');
      return;
    }
    setSubmitting(true);
    try {
      const res = await documentsApi.batchMove({
        ids: selectedRowKeys,
        firstCategory: moveFirstCategory,
        secondCategory: moveSecondCategory || undefined,
      });
      toast.success(`批量移动完成，成功 ${res.successCount} 篇`);
      setBatchMoveOpen(false);
      setMoveFirstCategory('');
      setMoveSecondCategory('');
      onClearSelection();
      onActionComplete();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '批量移动失败';
      toast.error(msg);
      logger.error(`Batch move error: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchDelete = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const res = await documentsApi.batchDelete({ ids: selectedRowKeys });
      toast.success(`批量删除完成，成功 ${res.successCount} 篇`);
      setBatchDeleteOpen(false);
      onClearSelection();
      onActionComplete();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '批量删除失败';
      toast.error(msg);
      logger.error(`Batch delete error: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = (): void => {
    const nameMap = new Map<string, string>();
    categoryOptions.forEach((opt: CategoryOption) => {
      nameMap.set(opt.id, opt.nameCn);
    });

    const selectedDocs = docs.filter((d: DocItem) => selectedRowKeys.includes(d.id));
    const rows = selectedDocs.map((doc: DocItem) => ({
      标题: doc.title,
      摘要: doc.summary,
      一级目录: nameMap.get(doc.firstCategory) ?? doc.firstCategory,
      二级目录: doc.secondCategory ? (nameMap.get(doc.secondCategory) ?? doc.secondCategory) : '',
      路径标识: doc.slug,
      文件路径: doc.filePath,
      正文状态: doc.contentStatus,
      发布状态: doc.publishStatus,
      负责人: doc.owner,
      更新时间: doc.updatedAt,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '文档清单');
    XLSX.writeFile(wb, `文档清单_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`已导出 ${rows.length} 篇文档`);
  };

  if (selectedRowKeys.length === 0) return null;

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background p-2">
        <span className="text-sm text-muted-foreground">
          已选择 {selectedRowKeys.length} 篇文档
        </span>
        <CanRole roles={['super_admin', 'publish_admin', 'content_editor']} fallback={null}>
        {draftCount > 0 && (
          <Button size="sm" onClick={handleBatchSubmitReview} disabled={submitting}>
            <Send className="mr-1 size-3.5" />
            批量提交审核{draftCount < selectedRowKeys.length ? `(${draftCount})` : ''}
          </Button>
        )}
        </CanRole>
        <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        {pendingCount > 0 && (
          <>
            <Button size="sm" onClick={handleBatchApprove} disabled={submitting}>
              <CheckCircle className="mr-1 size-3.5" />
              批量审核通过{pendingCount < selectedRowKeys.length ? `(${pendingCount})` : ''}
            </Button>
            <Button variant="outline" size="sm" onClick={handleBatchReject} disabled={submitting}>
              <XCircle className="mr-1 size-3.5" />
              批量驳回{pendingCount < selectedRowKeys.length ? `(${pendingCount})` : ''}
            </Button>
          </>
        )}
        </CanRole>
        <CanRole roles={['super_admin', 'publish_admin', 'content_editor']} fallback={null}>
        <Button variant="outline" size="sm" onClick={() => setBatchMoveOpen(true)} disabled={submitting}>
          <FolderInput className="mr-1 size-3.5" />
          批量移动目录
        </Button>
        </CanRole>
        <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setBatchDeleteOpen(true)}
          disabled={submitting}
        >
          <Trash2 className="mr-1 size-3.5" />
          批量删除
        </Button>
        </CanRole>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <FileDown className="mr-1 size-3.5" />
          批量导出文档清单
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearSelection} className="ml-auto">
          取消选择
        </Button>
      </div>

      <Dialog open={batchMoveOpen} onOpenChange={setBatchMoveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>批量移动目录</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">目标一级目录 *</label>
              <Select
                value={moveFirstCategory}
                onValueChange={(v: string) => {
                  setMoveFirstCategory(v);
                  setMoveSecondCategory('');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  {level1Options.map((opt: CategoryOption) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.nameCn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">目标二级目录</label>
              <Select
                value={moveSecondCategory}
                onValueChange={setMoveSecondCategory}
              >
                <SelectTrigger>
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  {level2Options.map((opt: CategoryOption) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.nameCn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchMoveOpen(false)}>取消</Button>
            <Button onClick={handleBatchMove} disabled={submitting || !moveFirstCategory}>
              {submitting ? '移动中...' : '确认移动'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除选中的 {selectedRowKeys.length} 篇文档？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBatchDelete}
              disabled={submitting}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default BatchActions;
