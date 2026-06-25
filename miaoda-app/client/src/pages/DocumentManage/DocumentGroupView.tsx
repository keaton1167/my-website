import React from 'react';
import { Card, CardContent } from '@client/src/components/ui/card';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { UserDisplay } from '@client/src/components/business-ui/user-display';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import { MoreHorizontal, Send, FolderInput, Trash2, Languages, CheckCircle, XCircle, Archive } from 'lucide-react';
import type { DocItem, CategoryOption, TranslationStatus } from '@shared/api.interface';

interface DocumentGroupViewProps {
  docs: DocItem[];
  categoryOptions: CategoryOption[];
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

function renderTranslationBadge(status: TranslationStatus | undefined): React.ReactNode {
  if (!status) return null;
  if (status === '中英文完整') {
    return <Badge variant="outline" className="bg-success/10 text-success border-success/20">{status}</Badge>;
  }
  if (status === '英文待更新') {
    return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">{status}</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

const DocumentGroupView: React.FC<DocumentGroupViewProps> = ({
  docs,
  categoryOptions,
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
  const level1Options = categoryOptions.filter(
    (opt: CategoryOption) => opt.level === 1,
  );

  const nameMap = new Map<string, string>();
  categoryOptions.forEach((opt: CategoryOption) => {
    nameMap.set(opt.id, opt.nameCn);
  });

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const grouped = level1Options.map((cat: CategoryOption) => ({
    categoryId: cat.id,
    categoryName: cat.nameCn,
    docs: docs.filter((doc: DocItem) =>
      doc.firstCategory === cat.id || doc.firstCategory === cat.nameCn,
    ),
  }));

  const knownCategoryIds = new Set(level1Options.map((c: CategoryOption) => c.id));
  const knownCategoryNames = new Set(level1Options.map((c: CategoryOption) => c.nameCn));
  const uncategorized = docs.filter(
    (doc: DocItem) => !doc.firstCategory,
  );

  const orphaned = docs.filter(
    (doc: DocItem) =>
      doc.firstCategory &&
      !knownCategoryIds.has(doc.firstCategory) &&
      !knownCategoryNames.has(doc.firstCategory),
  );

  const orphanGroups = new Map<string, DocItem[]>();
  orphaned.forEach((doc: DocItem) => {
    const catId: string = doc.firstCategory;
    if (!orphanGroups.has(catId)) orphanGroups.set(catId, []);
    orphanGroups.get(catId)!.push(doc);
  });

  return (
    <div className="flex flex-col">
      {grouped
        .filter((g) => g.docs.length > 0)
        .map((group, idx) => (
          <div key={group.categoryId} className={idx > 0 ? 'mt-4' : ''}>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              {group.categoryName}（{group.docs.length}）
            </h3>
            <div data-ai-section-type="card-list" className="grid grid-cols-3 gap-4">
              {group.docs.map((doc: DocItem) => (
                <DocCard
                  key={doc.id}
                  doc={doc}
                  nameMap={nameMap}
                  formatDate={formatDate}
                  onEdit={onEdit}
                  onViewDetail={onViewDetail}
                  onSubmitReview={onSubmitReview}
                  onApprove={onApprove}
                  onReject={onReject}
                  onArchive={onArchive}
                  onMove={onMove}
                  onDelete={onDelete}
                  onCreateEnglishVersion={onCreateEnglishVersion}
                />
              ))}
            </div>
          </div>
        ))}
      {uncategorized.length > 0 && (
        <div className={grouped.some((g) => g.docs.length > 0) ? 'mt-4' : ''}>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">
            未分类（{uncategorized.length}）
          </h3>
          <div data-ai-section-type="card-list" className="grid grid-cols-3 gap-4">
            {uncategorized.map((doc: DocItem) => (
              <DocCard
                key={doc.id}
                doc={doc}
                nameMap={nameMap}
                formatDate={formatDate}
                onEdit={onEdit}
                onViewDetail={onViewDetail}
                onSubmitReview={onSubmitReview}
                  onApprove={onApprove}
                  onReject={onReject}
                  onArchive={onArchive}
                  onMove={onMove}
                  onDelete={onDelete}
                  onCreateEnglishVersion={onCreateEnglishVersion}
                />
              ))}
            </div>
          </div>
        )}
      {orphanGroups.size > 0 &&
        Array.from(orphanGroups.entries()).map(([catId, catDocs]) => (
          <>
            <div key={catId} className="mt-4">
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              {nameMap.get(catId) ?? catId}（{catDocs.length}）
            </h3>
              <div data-ai-section-type="card-list" className="grid grid-cols-3 gap-4">
                {catDocs.map((doc: DocItem) => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    nameMap={nameMap}
                    formatDate={formatDate}
                    onEdit={onEdit}
                    onViewDetail={onViewDetail}
                    onSubmitReview={onSubmitReview}
                    onApprove={onApprove}
                    onReject={onReject}
                    onArchive={onArchive}
                    onMove={onMove}
                    onDelete={onDelete}
                    onCreateEnglishVersion={onCreateEnglishVersion}
                  />
                ))}
              </div>
            </div>
          </>
        ))}
    </div>
  );
};

interface DocCardProps {
  doc: DocItem;
  nameMap: Map<string, string>;
  formatDate: (dateStr: string) => string;
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

const DocCard: React.FC<DocCardProps> = ({
  doc,
  nameMap,
  formatDate,
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
  const isDraft = doc.publishStatus === '草稿';
  const isPending = doc.publishStatus === '待审核';
  const isPendingPublish = doc.publishStatus === '待发布';
  const isPublished = doc.publishStatus === '已发布';

  return (
    <Card className="rounded-md">
      <CardContent className="p-4 flex flex-col gap-2">
        <span className="font-medium truncate">{doc.title}</span>
        <span className="text-xs text-muted-foreground">
          {doc.firstCategory ? (nameMap.get(doc.firstCategory) ?? doc.firstCategory) : '-'}
        </span>
        {doc.secondCategory && (
          <span className="text-xs text-muted-foreground">
            {nameMap.get(doc.secondCategory) ?? doc.secondCategory}
          </span>
        )}
        {doc.summary && (
          <p className="text-sm text-muted-foreground line-clamp-1">{doc.summary}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {renderContentBadge(doc.contentStatus)}
          {renderPublishBadge(doc.publishStatus)}
          {renderTranslationBadge(doc.translationStatus)}
        </div>
        {doc.owner && (
          <div className="flex items-center gap-1">
            <UserDisplay value={[doc.owner]} size="small" />
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {formatDate(doc.updatedAt)}
        </span>
        <div className="flex items-center gap-1 border-t pt-2 mt-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onEdit(doc)}>
            编辑
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onViewDetail(doc)}>
            查看详情
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                更多
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {doc.language === 'zh-CN' && doc.translationStatus === '仅中文' && onCreateEnglishVersion && (
                <DropdownMenuItem onClick={() => onCreateEnglishVersion(doc)}>
                  <Languages className="mr-2 size-3.5" />
                  创建英文版本
                </DropdownMenuItem>
              )}
              {isDraft && (
                <DropdownMenuItem onClick={() => onSubmitReview(doc)}>
                  <Send className="mr-2 size-3.5" />
                  提交审核
                </DropdownMenuItem>
              )}
              {isPending && (
                <>
                  <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                    <DropdownMenuItem onClick={() => onApprove(doc)}>
                      <CheckCircle className="mr-2 size-3.5" />
                      审核通过
                    </DropdownMenuItem>
                  </CanRole>
                  <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                    <DropdownMenuItem onClick={() => onReject(doc)}>
                      <XCircle className="mr-2 size-3.5" />
                      驳回修改
                    </DropdownMenuItem>
                  </CanRole>
                </>
              )}
              {(isPendingPublish || isPublished) && (
                <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                  <DropdownMenuItem onClick={() => onArchive(doc)}>
                    <Archive className="mr-2 size-3.5" />
                    归档
                  </DropdownMenuItem>
                </CanRole>
              )}
              <DropdownMenuItem onClick={() => onMove(doc)}>
                <FolderInput className="mr-2 size-3.5" />
                移动
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(doc)}
              >
                <Trash2 className="mr-2 size-3.5" />
                删除
              </DropdownMenuItem>
              </CanRole>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
};

export default DocumentGroupView;
