import { lazy, Suspense } from 'react';
import { FileDown, Download } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import type { AttachmentPreviewType } from '@shared/api.interface';

const PdfPreview = lazy(() =>
  import('./pdf-preview').then((m) => ({ default: m.PdfPreview })),
);
const PptxPreview = lazy(() =>
  import('./pptx-preview').then((m) => ({ default: m.PptxPreview })),
);
const XlsxPreview = lazy(() =>
  import('./xlsx-preview').then((m) => ({ default: m.XlsxPreview })),
);

interface AttachmentPreviewProps {
  type: AttachmentPreviewType;
  url: string;
  fileName: string;
}

export function AttachmentPreview({ type, url, fileName }: AttachmentPreviewProps) {
  return (
    <Suspense fallback={<AttachmentLoading fileName={fileName} />}>
      <AttachmentPreviewInner type={type} url={url} fileName={fileName} />
    </Suspense>
  );
}

function AttachmentPreviewInner({ type, url, fileName }: AttachmentPreviewProps) {
  switch (type) {
    case 'pdf':
      return <PdfPreview url={url} fileName={fileName} />;
    case 'pptx':
      return <PptxPreview url={url} fileName={fileName} />;
    case 'xlsx':
      return <XlsxPreview url={url} fileName={fileName} />;
    default:
      return <AttachmentDownloadCard url={url} fileName={fileName} />;
  }
}

function AttachmentLoading({ fileName }: { fileName: string }) {
  return (
    <div className="my-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-medium">{fileName}</span>
        <span className="text-xs text-muted-foreground ml-2">加载中...</span>
      </div>
    </div>
  );
}

function AttachmentDownloadCard({ url, fileName }: { url: string; fileName: string }) {
  return (
    <div className="my-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FileDown className="w-5 h-5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={url} download={fileName}>
            <Download className="w-4 h-4 mr-1" />
            下载
          </a>
        </Button>
      </div>
    </div>
  );
}
