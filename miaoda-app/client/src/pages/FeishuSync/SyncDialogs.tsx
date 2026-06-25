import React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@client/src/components/ui/alert-dialog';
import { Button } from '@client/src/components/ui/button';

interface SyncDialogsProps {
  batchDeleteOpen: boolean;
  setBatchDeleteOpen: (v: boolean) => void;
  batchDeleteCount: number;
  batchDeleteHasSuccess: boolean;
  onBatchDeleteConfirm: () => void;

  batchSyncOpen: boolean;
  setBatchSyncOpen: (v: boolean) => void;
  batchSyncCount: number;
  batchSyncPausedCount: number;
  onBatchSyncConfirm: () => void;

  batchPauseOpen: boolean;
  setBatchPauseOpen: (v: boolean) => void;
  batchPauseCount: number;
  onBatchPauseConfirm: () => void;

  pauseToggleOpen: boolean;
  setPauseToggleOpen: (v: boolean) => void;
  pauseToggleAction: 'pause' | 'resume' | null;
  onPauseToggleConfirm: () => void;
}

const SyncDialogs: React.FC<SyncDialogsProps> = ({
  batchDeleteOpen, setBatchDeleteOpen, batchDeleteCount, batchDeleteHasSuccess, onBatchDeleteConfirm,
  batchSyncOpen, setBatchSyncOpen, batchSyncCount, batchSyncPausedCount, onBatchSyncConfirm,
  batchPauseOpen, setBatchPauseOpen, batchPauseCount, onBatchPauseConfirm,
  pauseToggleOpen, setPauseToggleOpen, pauseToggleAction, onPauseToggleConfirm,
}) => (
  <>
    <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认批量删除</AlertDialogTitle>
          <AlertDialogDescription>
            <span>本次将删除选中的 {batchDeleteCount} 条映射关系。删除后，飞书文档与帮助中心文档的同步关系将被移除，但不会删除飞书云文档。</span>
            {batchDeleteHasSuccess && (
              <span className="mt-2 block text-warning">
                选中的记录中包含已同步成功的映射，删除后将无法继续通过该映射同步帮助中心文档。
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => setTimeout(onBatchDeleteConfirm, 0)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={batchSyncOpen} onOpenChange={setBatchSyncOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认批量同步</AlertDialogTitle>
          <AlertDialogDescription>
            {batchSyncPausedCount > 0
              ? `已选择 ${batchSyncCount} 条映射，其中 ${batchSyncPausedCount} 条已暂停，将自动跳过，实际同步 ${batchSyncCount - batchSyncPausedCount} 条。`
              : `本次将同步选中的 ${batchSyncCount} 条映射。系统将拉取飞书文档内容，转换为 Markdown，并写入帮助中心文档。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => setTimeout(onBatchSyncConfirm, 0)}>
            开始同步
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={batchPauseOpen} onOpenChange={setBatchPauseOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认批量暂停</AlertDialogTitle>
          <AlertDialogDescription>
            本次将暂停选中的 {batchPauseCount} 条映射。暂停后，这些映射将不会参与自动同步和批量同步，但映射关系会保留。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => setTimeout(onBatchPauseConfirm, 0)}>
            确认暂停
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={pauseToggleOpen} onOpenChange={(v: boolean) => { if (!v) setPauseToggleOpen(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pauseToggleAction === 'pause' ? '确认暂停同步' : '确认恢复同步'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pauseToggleAction === 'pause'
              ? '暂停后，该映射将不会参与自动同步和批量同步，但仍可保留映射关系。'
              : '恢复后，该映射可以重新参与手动同步、批量同步和自动同步。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onPauseToggleConfirm}>
            {pauseToggleAction === 'pause' ? '确认暂停' : '确认恢复'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
);

export default SyncDialogs;
