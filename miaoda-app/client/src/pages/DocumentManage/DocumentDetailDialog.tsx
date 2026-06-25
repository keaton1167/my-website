import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { UserDisplay } from '@client/src/components/business-ui/user-display';
import { Streamdown } from '@client/src/components/ui/streamdown';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import { ExternalLink, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';
import { publishApi } from '@client/src/api';
import { toast } from 'sonner';
import type { DocItem, DocDetailResponse } from '@shared/api.interface';
import { PREVIEW_BASE, buildDraftPreviewUrl, openPreviewInNewWindow } from './preview-url';

interface DocumentDetailDialogProps {
  doc: DocItem | null;
  detailData: DocDetailResponse | null;
  onClose: () => void;
  categoryNameMap: Map<string, string>;
  previewDeployed?: boolean;
  onPreviewGenerated?: () => void;
}

const PUBLISH_STATUS_STYLE: Record<string, string> = {
  '草稿': 'bg-muted text-muted-foreground border-muted',
  '待审核': 'bg-warning/10 text-warning border-warning/20',
  '待发布': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  '已发布': 'bg-success/10 text-success border-success/20',
  '已归档': 'bg-secondary text-secondary-foreground border-secondary',
};

const DocumentDetailDialog: React.FC<DocumentDetailDialogProps> = ({
  doc,
  detailData,
  onClose,
  categoryNameMap,
  previewDeployed = false,
  onPreviewGenerated,
}) => {
  const [previewGenerating, setPreviewGenerating] = useState<boolean>(false);

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const resolveCatName = (ref: string): string => {
    return categoryNameMap.get(ref) ?? ref;
  };

  if (!doc) return null;

  const rawMarkdown = detailData?.markdownContent ?? '';
  const stripFrontmatter = (md: string): string => {
    const match = md.match(/^---\n[\s\S]*?\n---\n?/);
    return match ? md.slice(match[0].length) : md;
  };
  let markdownContent = rawMarkdown ? stripFrontmatter(rawMarkdown) : '';
  if (previewDeployed && markdownContent) {
    const previewImageBase = resolveAppUrl(`${PREVIEW_BASE}/img/help-center/`);
    const previewFileBase = resolveAppUrl(`${PREVIEW_BASE}/files/help-center/`);
    markdownContent = markdownContent
      .replace(/\(\/img\/help-center\//g, `(${previewImageBase}`)
      .replace(/\(\/files\/help-center\//g, `(${previewFileBase}`);
  }
  const docPreviewUrl = buildDraftPreviewUrl(doc.filePath);

  const handleGeneratePreview = async () => {
    try {
      const running = await publishApi.getRunningTasks();
      if (running.length > 0) {
        toast.error(`当前有任务正在执行: ${running.join(', ')}，请等待完成后再试`);
        return;
      }
    } catch {
      /* pre-check failed, proceed anyway */
    }
    setPreviewGenerating(true);
    try {
      await publishApi.deployDraftPreview();
      const pollInterval = setInterval(async () => {
        try {
          const running = await publishApi.getRunningTasks();
          if (!running.includes('草稿预览')) {
            clearInterval(pollInterval);
            setPreviewGenerating(false);
            const status = await publishApi.getPreviewStatus();
            if (status.deployed) {
              toast.success('草稿预览已生成');
              onPreviewGenerated?.();
            } else {
              toast.error('草稿预览生成失败，请查看任务日志');
            }
          }
        } catch {
          clearInterval(pollInterval);
          setPreviewGenerating(false);
        }
      }, 3000);
    } catch (err: unknown) {
      setPreviewGenerating(false);
      const msg = err instanceof Error ? err.message : '生成预览失败';
      toast.error(msg);
    }
  };

  const publishStyle = PUBLISH_STATUS_STYLE[doc.publishStatus] ?? 'bg-secondary text-secondary-foreground border-secondary';

  return (
    <Dialog open={!!doc} onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>文档详情</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-muted-foreground">标题：</span>
              <span className="font-medium">{doc.title}</span>
            </div>
            <div>
              <span className="text-muted-foreground">语言版本：</span>
              <Badge variant="outline">{doc.language === 'en' ? '英文' : '中文'}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">一级目录：</span>
              <span>{resolveCatName(doc.firstCategory)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">二级目录：</span>
              <span>{doc.secondCategory ? resolveCatName(doc.secondCategory) : '-'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">正文状态：</span>
              <span>{doc.contentStatus}</span>
            </div>
            <div>
              <span className="text-muted-foreground">发布状态：</span>
              <Badge variant="outline" className={publishStyle}>{doc.publishStatus}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">负责人：</span>
              {doc.owner ? <UserDisplay value={[doc.owner]} size="small" /> : '-'}
            </div>
            <div>
              <span className="text-muted-foreground">更新时间：</span>
              <span>{formatDate(doc.updatedAt)}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">帮助中心链接：</span>
              {doc.helpCenterUrl ? (
                <UniversalLink to={doc.helpCenterUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  {doc.helpCenterUrl}
                </UniversalLink>
              ) : '-'}
            </div>
          </div>

          <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div>
                <span className="text-muted-foreground">路径标识：</span>
                <span className="font-mono">{doc.slug}</span>
              </div>
              <div>
                <span className="text-muted-foreground">翻译组 ID：</span>
                <span className="font-mono text-xs" title={detailData?.translationGroupId ?? doc.translationGroupId ?? ''}>
                  {(detailData?.translationGroupId ?? doc.translationGroupId)?.slice(0, 8) ?? '-'}...
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">文件路径：</span>
                <span className="font-mono text-xs">{doc.filePath || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">最后发布人：</span>
                {doc.lastPublisher ? <UserDisplay value={[doc.lastPublisher]} size="small" /> : '-'}
              </div>
              <div>
                <span className="text-muted-foreground">来源：</span>
                <span>{doc.sourceType}</span>
              </div>
            </div>
          </CanRole>

          <div className="border-t pt-3">
            <div className="mb-3">
              <span className="text-muted-foreground">翻译状态：</span>
              {detailData?.translationStatus === '中英文完整' ? (
                <Badge variant="outline" className="bg-success/10 text-success border-success/20">{detailData.translationStatus}</Badge>
              ) : detailData?.translationStatus === '英文待更新' ? (
                <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">{detailData.translationStatus}</Badge>
              ) : (
                <Badge variant="secondary">{detailData?.translationStatus ?? '-'}</Badge>
              )}
            </div>
            {detailData?.translationStatus === '英文待更新' && (
              <div className="mb-3 flex items-start gap-2 rounded border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                <span>中文版本已更新，请检查英文版本是否需要同步更新。</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-muted-foreground">关联中文文档：</span>
                {doc.language === 'zh-CN' ? (
                  <div className="text-xs">
                    <span>当前文档</span>
                    <span className="ml-2 text-muted-foreground">更新于 {formatDate(doc.updatedAt)}</span>
                  </div>
                ) : detailData?.relatedZhDoc ? (
                  <div className="text-xs">
                    <span>{detailData.relatedZhDoc.title}</span>
                    <span className="ml-2 text-muted-foreground">更新于 {formatDate(detailData.relatedZhDoc.updatedAt)}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">暂无中文版本</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">关联英文文档：</span>
                {doc.language === 'en' ? (
                  <div className="text-xs">
                    <span>当前文档</span>
                    <span className="ml-2 text-muted-foreground">更新于 {formatDate(doc.updatedAt)}</span>
                  </div>
                ) : detailData?.relatedEnDoc ? (
                  <div className="text-xs">
                    <span>{detailData.relatedEnDoc.title}</span>
                    <span className="ml-2 text-muted-foreground">更新于 {formatDate(detailData.relatedEnDoc.updatedAt)}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">暂无英文版本</span>
                )}
              </div>
            </div>
          </div>

          {doc.summary && (
            <div className="border-t pt-3">
              <span className="text-muted-foreground">摘要：</span>
              <p className="mt-1 text-muted-foreground">{doc.summary}</p>
            </div>
          )}

          <div className="border-t pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">正文预览</span>
              <div className="flex items-center gap-2">
                {doc.wordCount > 0 && (
                  <span className="text-xs text-muted-foreground">{doc.wordCount} 字</span>
                )}
                {previewDeployed && docPreviewUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => { void openPreviewInNewWindow(docPreviewUrl); }}
                  >
                    <ExternalLink className="mr-1 size-3" />
                    预览当前文档
                  </Button>
                )}
              </div>
            </div>
            {!previewDeployed && rawMarkdown && (
              <div className="mb-2 flex items-center justify-between rounded border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-3 shrink-0" />
                  <span>预览产物未生成，图片等资源无法加载</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={previewGenerating}
                  onClick={handleGeneratePreview}
                >
                  {previewGenerating ? (
                    <Loader2 className="mr-1 size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 size-3" />
                  )}
                  {previewGenerating ? '生成中...' : '生成/更新全部草稿预览'}
                </Button>
              </div>
            )}
            {markdownContent ? (
              <div className="max-h-[50vh] overflow-y-auto rounded border p-4">
                <Streamdown mode="static">{markdownContent}</Streamdown>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center rounded border bg-muted/30 text-sm text-muted-foreground">
                该文档暂无正文内容
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          {previewDeployed && docPreviewUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void openPreviewInNewWindow(docPreviewUrl); }}
            >
              <ExternalLink className="mr-1 size-3" />
              预览当前文档
            </Button>
          )}
          <Button onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DocumentDetailDialog;
