import React from 'react';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { UserDisplay } from '@client/src/components/business-ui/user-display';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@client/src/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';
import { MoreHorizontal, Send, FolderInput, Trash2, Languages, CheckCircle, XCircle, Archive } from 'lucide-react';
import type { DocItem, CategoryOption, TranslationStatus } from '@shared/api.interface';

interface DocumentTableProps {
  docs: DocItem[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  categoryOptions: CategoryOption[];
  selectedRowKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  onPageChange: (page: number, pageSize: number) => void;
  onEdit: (doc: DocItem) => void;
  onViewDetail: (doc: DocItem) => void;
  onSubmitReview: (doc: DocItem) => void;
  onApprove: (doc: DocItem) => void;
  onReject: (doc: DocItem) => void;
  onArchive: (doc: DocItem) => void;
  onMove: (doc: DocItem) => void;
  onDelete: (doc: DocItem) => void;
  onCreateEnglishVersion?: (doc: DocItem) => void;
}

const CONTENT_BADGE_MAP: Record<string, string> = {
  '有正文': 'bg-success/10 text-success border-success/20',
  '无正文': 'secondary',
  '待补充': 'bg-warning/10 text-warning border-warning/20',
  '转换失败': 'destructive',
};

const PUBLISH_BADGE_MAP: Record<string, string> = {
  '草稿': 'secondary',
  '待审核': 'bg-warning/10 text-warning border-warning/20',
  '待发布': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  '已发布': 'bg-success/10 text-success border-success/20',
  '已归档': 'secondary',
};

function renderContentBadge(status: string): React.ReactNode {
  const cls = CONTENT_BADGE_MAP[status];
  if (cls === 'secondary') return <Badge variant="secondary">{status}</Badge>;
  if (cls === 'destructive') return <Badge variant="destructive">{status}</Badge>;
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}

function renderPublishBadge(status: string): React.ReactNode {
  const cls = PUBLISH_BADGE_MAP[status];
  if (cls === 'secondary') return <Badge variant="secondary">{status}</Badge>;
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}

function EllipsisCell({ text }: { text: string }) {
  if (!text) return <span className="text-muted-foreground">-</span>;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default block truncate max-w-full">{text}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs break-all">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const DocumentTable: React.FC<DocumentTableProps> = ({
  docs,
  total,
  page,
  pageSize,
  loading,
  categoryOptions,
  selectedRowKeys,
  onSelectionChange,
  onPageChange,
  onEdit,
  onViewDetail,
  onSubmitReview,
  onApprove,
  onReject,
  onArchive,
  onMove,
  onDelete,
  onCreateEnglishVersion,
}) => {
  const nameMap = new Map<string, string>();
  categoryOptions.forEach((opt: CategoryOption) => {
    nameMap.set(opt.id, opt.nameCn);
  });

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const columns = [
    {
      title: '文档标题',
      dataIndex: 'title',
      key: 'title',
      width: 200,
      fixed: 'left' as const,
      ellipsis: true,
    },
    {
      title: '一级目录',
      dataIndex: 'firstCategory',
      key: 'firstCategory',
      width: 120,
      render: (catId: string) => nameMap.get(catId) ?? (catId || '-'),
    },
    {
      title: '二级目录',
      dataIndex: 'secondCategory',
      key: 'secondCategory',
      width: 120,
      render: (catId: string) => (catId ? nameMap.get(catId) ?? catId : '-'),
    },
    {
      title: '正文状态',
      dataIndex: 'contentStatus',
      key: 'contentStatus',
      width: 90,
      render: (status: string) => renderContentBadge(status),
    },
    {
      title: '发布状态',
      dataIndex: 'publishStatus',
      key: 'publishStatus',
      width: 90,
      render: (status: string) => renderPublishBadge(status),
    },
    {
      title: '负责人',
      dataIndex: 'owner',
      key: 'owner',
      width: 130,
      render: (ownerVal: string) =>
        ownerVal ? <UserDisplay value={[ownerVal]} size="small" /> : '-',
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 110,
      render: (dateStr: string) => formatDate(dateStr),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right' as const,
      render: (_: unknown, record: DocItem) => {
        const isDraft = record.publishStatus === '草稿';
        const isPending = record.publishStatus === '待审核';
        const isPendingPublish = record.publishStatus === '待发布';
        const isPublished = record.publishStatus === '已发布';

        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onEdit(record)}
            >
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onViewDetail(record)}
            >
              查看详情
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                {record.language === 'zh-CN' && record.translationStatus === '仅中文' && onCreateEnglishVersion && (
                  <DropdownMenuItem onClick={() => onCreateEnglishVersion(record)}>
                    <Languages className="mr-2 size-3.5" />
                    创建英文版本
                  </DropdownMenuItem>
                )}
                </CanRole>
                {isDraft && (
                  <DropdownMenuItem onClick={() => onSubmitReview(record)}>
                    <Send className="mr-2 size-3.5" />
                    提交审核
                  </DropdownMenuItem>
                )}
                {isPending && (
                  <>
                    <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                      <DropdownMenuItem onClick={() => onApprove(record)}>
                        <CheckCircle className="mr-2 size-3.5" />
                        审核通过
                      </DropdownMenuItem>
                    </CanRole>
                    <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                      <DropdownMenuItem onClick={() => onReject(record)}>
                        <XCircle className="mr-2 size-3.5" />
                        驳回修改
                      </DropdownMenuItem>
                    </CanRole>
                  </>
                )}
                {(isPendingPublish || isPublished) && (
                  <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                    <DropdownMenuItem onClick={() => onArchive(record)}>
                      <Archive className="mr-2 size-3.5" />
                      归档
                    </DropdownMenuItem>
                  </CanRole>
                )}
                <DropdownMenuItem onClick={() => onMove(record)}>
                  <FolderInput className="mr-2 size-3.5" />
                  移动
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(record)}
                >
                  <Trash2 className="mr-2 size-3.5" />
                  删除
                </DropdownMenuItem>
                </CanRole>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => onSelectionChange(keys as string[]),
  };

  return (
    <div className="rounded-md border bg-background">
      <style jsx>{`
        td.ant-table-cell-fix-left,
        td.ant-table-cell-fix-right {
          box-shadow: none !important;
          background-color: hsl(var(--background)) !important;
        }
        th.ant-table-cell-fix-left,
        th.ant-table-cell-fix-right {
          box-shadow: none !important;
          background-color: hsl(var(--background)) !important;
        }
      `}</style>
      <Table<DocItem>
        rowKey="id"
        columns={columns}
        dataSource={docs}
        loading={loading}
        rowSelection={rowSelection}
        scroll={{ x: 1440, y: 500 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p: number, ps: number) => onPageChange(p, ps),
        }}
      />
    </div>
  );
};

export default DocumentTable;
