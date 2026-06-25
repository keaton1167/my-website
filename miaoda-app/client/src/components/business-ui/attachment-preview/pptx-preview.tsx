import { useEffect, useRef, useState } from 'react';
import { Download, Presentation, ChevronDown, ChevronUp } from 'lucide-react';
import { useFileData } from './use-file-data';
import { Button } from '@client/src/components/ui/button';

export function PptxPreview({ url, fileName }: { url: string; fileName: string }) {
  const { data, loading, error } = useFileData(url);
  const [expanded, setExpanded] = useState(false);

  if (loading) return <PreviewSkeleton fileName={fileName} message="正在加载 PPT..." />;
  if (error) return <PreviewFallback fileName={fileName} url={url} error={error} />;

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50">
        <div className="flex items-center gap-2 min-w-0">
          <Presentation className="w-4 h-4 text-orange-500 shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
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
      {expanded && <PptxRenderer data={data!} />}
    </div>
  );
}

function PptxRenderer({ data }: { data: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    let previewer: { preview: (data: ArrayBuffer) => Promise<unknown>; destroy: () => void } | null = null;

    const render = async () => {
      try {
        const { init } = await import('pptx-preview');
        previewer = init(container, {
          width: container.offsetWidth || 800,
          height: Math.min(container.offsetWidth * 0.5625, 600) || 450,
          mode: 'list',
        });
        await previewer.preview(data);
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message || 'PPTX 渲染失败');
      }
    };

    render();
    return () => {
      if (previewer) previewer.destroy();
    };
  }, [data]);

  if (error) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <p>PPTX 预览失败: {error}</p>
        <p className="mt-1">请下载原文件查看</p>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full min-h-[300px] p-2 bg-white" />;
}

function PreviewSkeleton({ fileName, message }: { fileName: string; message: string }) {
  return (
    <div className="my-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Presentation className="w-4 h-4 text-orange-500" />
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
            <Presentation className="w-4 h-4 text-orange-500" />
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
