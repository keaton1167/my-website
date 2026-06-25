import React, { useState, useRef } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  FileSpreadsheet,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { feishuMappingsApi, documentsApi } from '@client/src/api';
import type {
  CreateFeishuMappingRequest,
  CreateDocRequest,
  SyncMode,
  CategoryOption,
  Language,
} from '@shared/api.interface';

const TEMPLATE_HEADERS = [
  '飞书文档链接',
  '飞书文档标题',
  '一级目录',
  '二级目录',
  '帮助中心文档标题',
  '帮助中心路径标识',
  '语言版本',
  '同步方式',
  '负责人',
  '是否启用',
  '保存后立即同步',
];

const SAMPLE_ROW = [
  'https://xxx.feishu.cn/docx/xxxxx',
  '示例飞书文档',
  '快速入门',
  '安装指南',
  '快速入门指南',
  'getting-started',
  '中文',
  '手动同步',
  '张三',
  '是',
  '否',
];

const VALID_LANGUAGES: string[] = ['中文', '英文'];
const VALID_SYNC_MODES: string[] = ['手动同步', '定时同步', '事件触发同步'];
const SLUG_REGEX = /^[a-z0-9-]+$/;

interface ImportRow {
  id: string;
  feishuDocUrl: string;
  feishuDocTitle: string;
  firstCategoryName: string;
  secondCategoryName: string;
  helpCenterTitle: string;
  helpCenterSlug: string;
  language: string;
  syncMode: string;
  ownerName: string;
  enabled: string;
  syncAfterSave: string;
  status?: 'pass' | 'fail';
  errors?: string[];
}

interface ImportTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryOptions: CategoryOption[];
  onSuccess: () => void;
}

function genRowId(): string {
  return `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseBoolValue(v: string): boolean {
  const t = v.trim().toLowerCase();
  return t === '是' || t === '开' || t === 'true' || t === 'yes' || t === '1';
}

function resolveCategoryId(
  name: string,
  level: number,
  parentId: string,
  options: CategoryOption[],
): string {
  const match = options.find(
    (o: CategoryOption) =>
      o.nameCn === name.trim() &&
      o.level === level &&
      (level === 1 || o.parentId === parentId),
  );
  return match?.id ?? '';
}

const ImportTemplateDialog: React.FC<ImportTemplateDialogProps> = ({
  open,
  onOpenChange,
  categoryOptions,
  onSuccess,
}) => {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [validated, setValidated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const passCount = rows.filter((r: ImportRow) => r.status === 'pass').length;
  const failCount = rows.filter((r: ImportRow) => r.status === 'fail').length;

  const resetState = () => {
    setRows([]);
    setValidated(false);
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = (v: boolean) => {
    if (!v && !submitting) resetState();
    onOpenChange(v);
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, SAMPLE_ROW]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '映射模板');
    XLSX.writeFile(wb, '飞书映射导入模板.xlsx');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'csv') {
      toast.error('仅支持 .xlsx 和 .csv 文件');
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonRows: string[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          defval: '',
        });

        if (jsonRows.length < 2) {
          toast.error('文件中没有数据行');
          return;
        }

        const parsed: ImportRow[] = jsonRows
          .slice(1)
          .filter((cells: string[]) =>
            cells.some((c: string) => String(c).trim() !== ''),
          )
          .map((cells: string[]) => ({
            id: genRowId(),
            feishuDocUrl: String(cells[0] ?? '').trim(),
            feishuDocTitle: String(cells[1] ?? '').trim(),
            firstCategoryName: String(cells[2] ?? '').trim(),
            secondCategoryName: String(cells[3] ?? '').trim(),
            helpCenterTitle: String(cells[4] ?? '').trim(),
            helpCenterSlug: String(cells[5] ?? '').trim(),
            language: String(cells[6] ?? '中文').trim(),
            syncMode: String(cells[7] ?? '').trim(),
            ownerName: String(cells[8] ?? '').trim(),
            enabled: String(cells[9] ?? '是').trim(),
            syncAfterSave: String(cells[10] ?? '否').trim(),
          }));

        setRows(parsed);
        setValidated(false);
        toast.success(`已解析 ${parsed.length} 行数据`);
      } catch {
        toast.error('文件解析失败，请检查文件格式');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleValidate = () => {
    if (rows.length === 0) {
      toast.warning('请先上传文件');
      return;
    }

    const pathSet = new Set<string>();
    const updated = rows.map((row: ImportRow, idx: number): ImportRow => {
      const rowErrors: string[] = [];
      const rowNum = idx + 1;

      if (!row.feishuDocUrl) rowErrors.push(`第${rowNum}行：缺少飞书文档链接`);
      if (!row.feishuDocTitle) rowErrors.push(`第${rowNum}行：缺少飞书文档标题`);
      if (!row.firstCategoryName) rowErrors.push(`第${rowNum}行：缺少一级目录`);
      if (!row.secondCategoryName) rowErrors.push(`第${rowNum}行：缺少二级目录`);
      if (!row.helpCenterTitle) rowErrors.push(`第${rowNum}行：缺少帮助中心文档标题`);
      if (!row.helpCenterSlug) {
        rowErrors.push(`第${rowNum}行：缺少帮助中心路径标识`);
      } else if (!SLUG_REGEX.test(row.helpCenterSlug)) {
        rowErrors.push(`第${rowNum}行：帮助中心路径标识格式错误`);
      }
      if (!row.language) {
        rowErrors.push(`第${rowNum}行：缺少语言版本`);
      } else if (!VALID_LANGUAGES.includes(row.language)) {
        rowErrors.push(`第${rowNum}行：语言版本不合法，应为：${VALID_LANGUAGES.join('/')}`);
      }
      if (!row.syncMode) {
        rowErrors.push(`第${rowNum}行：缺少同步方式`);
      } else if (!VALID_SYNC_MODES.includes(row.syncMode)) {
        rowErrors.push(`第${rowNum}行：同步方式不合法，应为：${VALID_SYNC_MODES.join('/')}`);
      }
      if (!row.ownerName) rowErrors.push(`第${rowNum}行：缺少负责人`);

      if (row.firstCategoryName) {
        const firstId = resolveCategoryId(row.firstCategoryName, 1, '', categoryOptions);
        if (!firstId) {
          rowErrors.push(`第${rowNum}行：一级目录"${row.firstCategoryName}"不存在`);
        } else if (row.secondCategoryName) {
          const secondId = resolveCategoryId(row.secondCategoryName, 2, firstId, categoryOptions);
          if (!secondId) {
            rowErrors.push(`第${rowNum}行：二级目录"${row.secondCategoryName}"不属于所选一级目录`);
          }
        }
      }

      if (row.firstCategoryName && row.secondCategoryName && row.helpCenterSlug) {
        const firstSlug = categoryOptions.find(
          (o: CategoryOption) => o.nameCn === row.firstCategoryName.trim() && o.level === 1,
        )?.slugEn ?? '';
        const firstId = categoryOptions.find(
          (o: CategoryOption) => o.nameCn === row.firstCategoryName.trim() && o.level === 1,
        )?.id ?? '';
        const secondSlug = categoryOptions.find(
          (o: CategoryOption) =>
            o.nameCn === row.secondCategoryName.trim() &&
            o.level === 2 &&
            o.parentId === firstId,
        )?.slugEn ?? '';
        if (firstSlug && secondSlug) {
          const langCode = row.language === '英文' ? 'en' : 'zh-CN';
          const pathKey = `${langCode}:${firstSlug}/${secondSlug}/${row.helpCenterSlug}`;
          if (pathSet.has(pathKey)) {
            rowErrors.push(`第${rowNum}行：帮助中心文件路径重复`);
          }
          pathSet.add(pathKey);
        }
      }

      return {
        ...row,
        status: rowErrors.length > 0 ? 'fail' : 'pass',
        errors: rowErrors,
      };
    });

    setRows(updated);
    setValidated(true);

    const newPass = updated.filter((r: ImportRow) => r.status === 'pass').length;
    const newFail = updated.filter((r: ImportRow) => r.status === 'fail').length;
    if (newFail === 0) {
      toast.success(`校验通过，共 ${newPass} 条有效数据`);
    } else {
      toast.warning(`校验完成：${newPass} 条通过，${newFail} 条失败`);
    }
  };

  const handleConfirmImport = async () => {
    const passRows = rows.filter((r: ImportRow) => r.status === 'pass');
    if (passRows.length === 0) {
      toast.warning('没有通过校验的数据可导入');
      return;
    }

    setSubmitting(true);
    try {
      const items: CreateFeishuMappingRequest[] = passRows.map(
        (row: ImportRow): CreateFeishuMappingRequest => {
          const firstId = resolveCategoryId(row.firstCategoryName, 1, '', categoryOptions);
          const secondId = resolveCategoryId(row.secondCategoryName, 2, firstId, categoryOptions);
          return {
            feishuDocUrl: row.feishuDocUrl,
            feishuDocTitle: row.feishuDocTitle,
            targetFirstCategory: firstId,
            targetSecondCategory: secondId,
            helpCenterTitle: row.helpCenterTitle,
            helpCenterSlug: row.helpCenterSlug,
            owner: row.ownerName,
            syncMode: row.syncMode as SyncMode,
            enabled: parseBoolValue(row.enabled),
            syncAfterSave: parseBoolValue(row.syncAfterSave),
            language: (row.language === '英文' ? 'en' : 'zh-CN') as Language,
          };
        },
      );

      const result = await feishuMappingsApi.batchCreateMapping({ items });

      const docPromises: Promise<unknown>[] = passRows.map(
        (row: ImportRow): Promise<unknown> => {
          const firstId = resolveCategoryId(row.firstCategoryName, 1, '', categoryOptions);
          const secondId = resolveCategoryId(row.secondCategoryName, 2, firstId, categoryOptions);
          const docReq: CreateDocRequest = {
            title: row.helpCenterTitle,
            firstCategory: firstId,
            secondCategory: secondId,
            slug: row.helpCenterSlug,
            owner: row.ownerName,
            sourceType: '飞书同步',
            sourceUrl: row.feishuDocUrl,
            language: (row.language === '英文' ? 'en' : 'zh-CN') as Language,
          };
          return documentsApi.createDoc(docReq);
        },
      );
      await Promise.all(docPromises);

      toast.success(`成功导入 ${result.total} 条映射，失败 ${failCount} 条`);
      onSuccess();
      handleClose(false);

      const syncIds: string[] = [];
      result.ids.forEach((id: string, idx: number) => {
        if (parseBoolValue(passRows[idx]?.syncAfterSave ?? '')) syncIds.push(id);
      });
      if (syncIds.length > 0) {
        setTimeout(() => {
          Promise.all(
            syncIds.map((id: string) =>
              feishuMappingsApi.updateMapping({ id, syncStatus: '同步成功' }),
            ),
          )
            .then(() => onSuccess())
            .catch(() => {});
        }, 1500);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[85vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>导入映射模板</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="text-sm text-muted-foreground">
            请按照模板填写飞书文档与帮助中心文档的映射关系，上传后系统会校验目录、路径标识和必填字段。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={handleDownloadTemplate}>
            <Download className="mr-1.5 size-3.5" />
            下载导入模板
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1.5 size-3.5" />
            {fileName || '上传文件'}
          </Button>
          <span className="text-xs text-muted-foreground">
            支持上传 .xlsx / .csv 文件
          </span>
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-2 py-2 text-left font-medium w-10">#</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[160px]">飞书文档链接</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[120px]">飞书文档标题</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[100px]">一级目录</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[100px]">二级目录</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[140px]">帮助中心文档标题</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[120px]">帮助中心路径标识</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[80px]">语言版本</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[90px]">同步方式</th>
                  <th className="px-2 py-2 text-left font-medium min-w-[80px]">负责人</th>
                  <th className="px-2 py-2 text-left font-medium w-[70px]">启用</th>
                  <th className="px-2 py-2 text-left font-medium w-[90px]">立即同步</th>
                  {validated && (
                    <th className="px-2 py-2 text-center font-medium w-[80px]">校验</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row: ImportRow, index: number) => (
                  <tr
                    key={row.id}
                    className={`border-t ${
                      row.status === 'fail' ? 'bg-destructive/5' : ''
                    }`}
                  >
                    <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-2 text-xs max-w-[160px] truncate" title={row.feishuDocUrl}>
                      {row.feishuDocUrl || '-'}
                    </td>
                    <td className="px-2 py-2 text-xs">{row.feishuDocTitle || '-'}</td>
                    <td className="px-2 py-2 text-xs">{row.firstCategoryName || '-'}</td>
                    <td className="px-2 py-2 text-xs">{row.secondCategoryName || '-'}</td>
                    <td className="px-2 py-2 text-xs">{row.helpCenterTitle || '-'}</td>
                    <td className="px-2 py-2 text-xs font-mono">{row.helpCenterSlug || '-'}</td>
                    <td className="px-2 py-2 text-xs">{row.language || '-'}</td>
                    <td className="px-2 py-2 text-xs">{row.syncMode || '-'}</td>
                    <td className="px-2 py-2 text-xs">{row.ownerName || '-'}</td>
                    <td className="px-2 py-2 text-xs">{row.enabled || '-'}</td>
                    <td className="px-2 py-2 text-xs">{row.syncAfterSave || '-'}</td>
                    {validated && (
                      <td className="px-2 py-2 text-center">
                        {row.status === 'pass' ? (
                          <Badge variant="outline" className="bg-success/10 text-success border-success/20 text-xs">
                            <CheckCircle2 className="mr-0.5 h-3 w-3" />通过
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                            <XCircle className="mr-0.5 h-3 w-3" />失败
                          </Badge>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {validated && failCount > 0 && (
          <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm font-medium text-destructive">校验失败详情</span>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {rows
                .filter((r: ImportRow) => r.status === 'fail')
                .flatMap((r: ImportRow) => r.errors ?? [])
                .map((msg: string, i: number) => (
                  <div key={i} className="text-xs text-destructive">
                    {msg}
                  </div>
                ))}
            </div>
          </div>
        )}

        {validated && (
          <div className="flex items-center gap-4 text-sm">
            <span>
              总行数：<strong>{rows.length}</strong>
            </span>
            <span className="text-success">
              通过：<strong>{passCount}</strong>
            </span>
            <span className="text-destructive">
              失败：<strong>{failCount}</strong>
            </span>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleClose(false)}>
            取消
          </Button>
          <Button variant="outline" onClick={handleValidate} disabled={rows.length === 0 || submitting}>
            <FileSpreadsheet className="mr-1.5 size-3.5" />
            校验数据
          </Button>
          <Button
            onClick={handleConfirmImport}
            disabled={!validated || passCount === 0 || submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            确认导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportTemplateDialog;
