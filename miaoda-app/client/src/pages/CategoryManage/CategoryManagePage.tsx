import React, { useState, useEffect, useCallback } from 'react';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import { categoriesApi } from '@client/src/api';
import type {
  CategoryItem,
  CategoryListResponse,
  CategoryDependenciesResponse,
} from '@shared/api.interface';

import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@client/src/components/ui/tooltip';
import { CategoryFormDialog } from './CategoryFormDialog';

const CategoryManagePage: React.FC = () => {
  const [listData, setListData] = useState<CategoryListResponse>({
    items: [],
    total: 0,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<CategoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryItem | null>(null);
  const [deleteDeps, setDeleteDeps] =
    useState<CategoryDependenciesResponse | null>(null);

  const handleDeleteClick = async (record: CategoryItem): Promise<void> => {
    setDeleteTarget(record);
    setDeleteDeps(null);
    try {
      const deps = await categoriesApi.checkCategoryDependencies(record.id);
      setDeleteDeps(deps);
    } catch (_err: unknown) {
      // silent fallback
    }
  };

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const data: CategoryListResponse = await categoriesApi.getCategoryList({
        page,
        pageSize,
      });
      setListData(data);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '加载目录列表失败';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const openCreateDialog = (): void => {
    setEditingItem(null);
    setDialogOpen(true);
  };

  const openEditDialog = (item: CategoryItem): void => {
    setEditingItem(item);
    setDialogOpen(true);
  };

  const handleDialogSuccess = (): void => {
    setDialogOpen(false);
    void fetchList();
  };

  const handleToggleStatus = async (item: CategoryItem): Promise<void> => {
    try {
      await categoriesApi.toggleCategoryStatus(item.id, {
        enabled: !item.enabled,
      });
      toast.success(item.enabled ? '已停用' : '已启用');
      void fetchList();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '操作失败';
      toast.error(errorMsg);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await categoriesApi.deleteCategory(deleteTarget.id);
      toast.success('删除成功');
      setDeleteTarget(null);
      setDeleteDeps(null);
      void fetchList();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '删除失败';
      toast.error(errorMsg);
    }
  };

  const columns = [
    { title: '中文名', dataIndex: 'nameCn', key: 'nameCn', width: 130 },
    { title: '英文名', dataIndex: 'nameEn', key: 'nameEn', width: 130, ellipsis: true },
    { title: '目录路径标识', dataIndex: 'slugEn', key: 'slugEn', width: 140 },
    { title: '父级目录', dataIndex: 'parentName', key: 'parentName', width: 120 },
    {
      title: '帮助中心路径',
      dataIndex: 'docusaurusPath',
      key: 'docusaurusPath',
      width: 220,
      ellipsis: true,
      render: (path: string) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block truncate max-w-[200px] cursor-default">
              {path}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{path}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 80,
      render: (level: number) => (
        <Badge variant={level === 1 ? 'default' : 'outline'}>
          {level === 1 ? '一级' : '二级'}
        </Badge>
      ),
    },
    { title: '排序', dataIndex: 'order', key: 'order', width: 70 },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      render: (enabled: boolean) => (
        <Badge variant={enabled ? 'default' : 'secondary'}>
          {enabled ? '已启用' : '已停用'}
        </Badge>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: CategoryItem) => (
        <div className="flex gap-1">
          <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
          <Button variant="ghost" size="sm" onClick={() => openEditDialog(record)}>
            编辑
          </Button>
          </CanRole>
          <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
          <Button variant="ghost" size="sm" onClick={() => handleToggleStatus(record)}>
            {record.enabled ? '停用' : '启用'}
          </Button>
          </CanRole>
          <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => handleDeleteClick(record)}
          >
            删除
          </Button>
          </CanRole>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">目录管理</h2>
        <CanRole roles={['super_admin', 'content_editor']} fallback={null}>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-1 size-4" />
          新增目录
        </Button>
        </CanRole>
      </div>

      <div className="rounded-md border bg-background">
        <Table<CategoryItem>
          rowKey="id"
          columns={columns}
          dataSource={listData.items}
          loading={loading}
          scroll={{ y: 500 }}
          pagination={{
            current: page,
            pageSize,
            total: listData.total,
            showSizeChanger: true,
            onChange: (p: number, ps: number) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </div>

      <CategoryFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingItem={editingItem}
        onSuccess={handleDialogSuccess}
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
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-1.5">
                <span>
                  确定要删除目录「{deleteTarget?.nameCn}」吗？
                </span>
                {deleteDeps &&
                  (deleteDeps.hasChildren || deleteDeps.hasDocs) && (
                    <span className="text-destructive font-medium">
                      该目录下存在子目录或文档，删除可能影响帮助中心结构，请确认是否继续。
                    </span>
                  )}
                <span>删除后不可恢复。</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteTarget(null);
                setDeleteDeps(null);
              }}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CategoryManagePage;
