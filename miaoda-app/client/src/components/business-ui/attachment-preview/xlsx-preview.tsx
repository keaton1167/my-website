import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Download, Table2, ChevronDown, ChevronUp } from 'lucide-react';
import { useFileData } from './use-file-data';
import { Button } from '@client/src/components/ui/button';

const MAX_PREVIEW_ROWS = 10;

export function XlsxPreview({ url, fileName }: { url: string; fileName: string }) {
  const { data, loading, error } = useFileData(url);
  const [expanded, setExpanded] = useState(false);

  if (loading) return <PreviewSkeleton fileName={fileName} message="正在加载 Excel..." />;
  if (error) return <PreviewFallback fileName={fileName} url={url} error={error} />;

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50">
        <div className="flex items-center gap-2 min-w-0">
          <Table2 className="w-4 h-4 text-green-600 shrink-0" />
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
      {expanded && <XlsxRenderer data={data!} />}
    </div>
  );
}

function XlsxRenderer({ data }: { data: ArrayBuffer }) {
  const [activeSheet, setActiveSheet] = useState(0);

  const wb = useMemo(() => {
    try {
      return XLSX.read(data, { type: 'array' });
    } catch {
      return null;
    }
  }, [data]);

  if (!wb) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Excel 文件解析失败，请下载原文件查看
      </div>
    );
  }

  const sheetName = wb.SheetNames[activeSheet];
  const sheet = wb.Sheets[sheetName];
  const fullRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const totalRows = fullRange.e.r - fullRange.s.r + 1;
  const isTruncated = totalRows > MAX_PREVIEW_ROWS;
  const originalRef = sheet['!ref'];
  if (isTruncated && originalRef) {
    const limitedEnd = `${XLSX.utils.encode_col(fullRange.e.c)}${fullRange.s.r + 1 + MAX_PREVIEW_ROWS}`;
    sheet['!ref'] = `${XLSX.utils.encode_col(fullRange.s.c)}${fullRange.s.r + 1}:${limitedEnd}`;
  }
  const html = XLSX.utils.sheet_to_html(sheet);
  if (originalRef) sheet['!ref'] = originalRef;

  return (
    <div className="flex flex-col w-full">
      {wb.SheetNames.length > 1 && (
        <div className="flex gap-1 border-b px-2 shrink-0">
          {wb.SheetNames.map((name: string, i: number) => (
            <button
              key={name}
              onClick={() => setActiveSheet(i)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                i === activeSheet
                  ? 'border-b-2 border-primary font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div
        className="overflow-auto max-h-[400px] [&_table]:min-w-full [&_table]:w-max [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:text-sm [&_td]:whitespace-nowrap [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-sm [&_th]:bg-muted [&_th]:font-medium [&_th]:whitespace-nowrap"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {isTruncated && (
        <div className="text-xs text-muted-foreground text-center py-2 border-t bg-muted/30">
          仅显示前 {MAX_PREVIEW_ROWS} 行，共 {totalRows} 行。下载原文件查看完整内容
        </div>
      )}
    </div>
  );
}

function PreviewSkeleton({ fileName, message }: { fileName: string; message: string }) {
  return (
    <div className="my-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Table2 className="w-4 h-4 text-green-600" />
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
            <Table2 className="w-4 h-4 text-green-600" />
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
