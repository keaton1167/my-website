import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Download, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { useFileData } from './use-file-data';
import { Button } from '@client/src/components/ui/button';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url,
).toString();

const MAX_PREVIEW_PAGES = 5;

export function PdfPreview({ url, fileName }: { url: string; fileName: string }) {
  const { data, loading, error } = useFileData(url);

  if (loading) return <PreviewSkeleton fileName={fileName} message="正在加载 PDF..." />;
  if (error) return <PreviewFallback fileName={fileName} url={url} error={error} />;
  return <PdfRenderer data={data!} url={url} fileName={fileName} />;
}

function PdfRenderer({ data, url, fileName }: { data: ArrayBuffer; url: string; fileName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    let pdfDoc: PDFDocumentProxy | null = null;

    const render = async () => {
      try {
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) { pdfDoc.destroy(); return; }
        setTotalPages(pdfDoc.numPages);

        const container = containerRef.current;
        if (!container) { pdfDoc.destroy(); return; }
        container.innerHTML = '';

        const containerWidth = container.clientWidth;
        const pagesToRender = Math.min(pdfDoc.numPages, MAX_PREVIEW_PAGES);

        for (let i = 1; i <= pagesToRender; i++) {
          if (cancelled) break;
          const page = await pdfDoc.getPage(i);
          const defaultViewport = page.getViewport({ scale: 1 });
          const scale = containerWidth / defaultViewport.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          container.appendChild(canvas);
          await page.render({
            canvasContext: canvas.getContext('2d')!,
            viewport,
          }).promise;
        }
      } catch {
        if (!cancelled) setRenderError(true);
      }
    };

    render();
    return () => {
      cancelled = true;
      if (pdfDoc) pdfDoc.destroy();
    };
  }, [data, expanded]);

  if (renderError) return <PreviewFallback fileName={fileName} url={url} error="PDF 渲染失败" />;

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
          {totalPages > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              {totalPages} 页{totalPages > MAX_PREVIEW_PAGES ? ` (显示前 ${MAX_PREVIEW_PAGES} 页)` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            <span className="ml-1">{expanded ? '收起' : '预览'}</span>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={url} download={fileName}>
              <Download className="w-4 h-4" />
            </a>
          </Button>
        </div>
      </div>
      {expanded && (
        <div ref={containerRef} className="flex flex-col items-center gap-2 p-4 bg-white" />
      )}
    </div>
  );
}

function PreviewSkeleton({ fileName, message }: { fileName: string; message: string }) {
  return (
    <div className="my-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-red-500" />
        <span className="text-sm font-medium">{fileName}</span>
        <span className="text-xs text-muted-foreground ml-2">{message}</span>
      </div>
    </div>
  );
}

function PreviewFallback({ fileName, url, error }: { fileName: string; url: string; error: string }) {
  return (
    <div className="my-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-red-500" />
            <span className="text-sm font-medium">{fileName}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            预览生成失败，请下载原文件查看
          </p>
          <p className="text-xs text-destructive mt-0.5">{error}</p>
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
