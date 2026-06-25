import React, { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Copy, Loader2 } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Switch } from '@client/src/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { UserSelect } from '@client/src/components/business-ui/user-select';
import { feishuMappingsApi, documentsApi } from '@client/src/api';
import type {
  CreateFeishuMappingRequest,
  CreateDocRequest,
  SyncMode,
  CategoryOption,
  Language,
} from '@shared/api.interface';

const SYNC_MODES: SyncMode[] = ['手动同步', '定时同步', '事件触发同步'];
const SLUG_REGEX = /^[a-z0-9-]+$/;

interface BatchRow {
  id: string;
  feishuDocUrl: string;
  feishuDocTitle: string;
  targetFirstCategory: string;
  targetSecondCategory: string;
  helpCenterTitle: string;
  helpCenterSlug: string;
  language: Language;
  syncMode: SyncMode;
  owner: string;
  enabled: boolean;
  syncAfterSave: boolean;
}

function genId(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyRow(): BatchRow {
  return {
    id: genId(),
    feishuDocUrl: '',
    feishuDocTitle: '',
    targetFirstCategory: '',
    targetSecondCategory: '',
    helpCenterTitle: '',
    helpCenterSlug: '',
    language: 'zh-CN' as Language,
    syncMode: '手动同步',
    owner: '',
    enabled: true,
    syncAfterSave: false,
  };
}

function buildPathPreview(
  row: BatchRow,
  catOptions: CategoryOption[],
): string {
  const firstSlug =
    catOptions.find(
      (o: CategoryOption) => o.level === 1 && o.id === row.targetFirstCategory,
    )?.slugEn ?? '';
  const secondSlug =
    catOptions.find(
      (o: CategoryOption) =>
        o.level === 2 &&
        o.id === row.targetSecondCategory &&
        o.parentId === row.targetFirstCategory,
    )?.slugEn ?? '';
  if (!firstSlug || !secondSlug || !row.helpCenterSlug) return '';
  const joined = `${firstSlug}/${secondSlug}/${row.helpCenterSlug}`;
  return row.language === 'en'
    ? `i18n/en/docusaurus-plugin-content-docs/current/${joined}.md`
    : `docs/${joined}.md`;
}

function buildFilePath(
  row: BatchRow,
  catOptions: CategoryOption[],
): string {
  const firstSlug =
    catOptions.find(
      (o: CategoryOption) => o.level === 1 && o.id === row.targetFirstCategory,
    )?.slugEn ?? '';
  const secondSlug =
    catOptions.find(
      (o: CategoryOption) =>
        o.level === 2 &&
        o.id === row.targetSecondCategory &&
        o.parentId === row.targetFirstCategory,
    )?.slugEn ?? '';
  if (!firstSlug || !secondSlug || !row.helpCenterSlug) return '';
  return `${firstSlug}/${secondSlug}/${row.helpCenterSlug}`;
}

interface RowErrors {
  [rowId: string]: string[];
}

interface BatchCreateMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryOptions: CategoryOption[];
  onSuccess: () => void;
}

const BatchCreateMappingDialog: React.FC<BatchCreateMappingDialogProps> = ({
  open,
  onOpenChange,
  categoryOptions,
  onSuccess,
}) => {
  const [rows, setRows] = useState<BatchRow[]>([createEmptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<RowErrors>({});

  const updateRow = (id: string, field: keyof BatchRow, value: unknown) => {
    setRows((prev: BatchRow[]) =>
      prev.map((r: BatchRow) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        if (field === 'targetFirstCategory') {
          updated.targetSecondCategory = '';
        }
        return updated;
      }),
    );
  };

  const addRow = () => {
    setRows((prev: BatchRow[]) => [...prev, createEmptyRow()]);
  };

  const removeRow = (id: string) => {
    setRows((prev: BatchRow[]) => {
      if (prev.length <= 1) return prev;
      return prev.filter((r: BatchRow) => r.id !== id);
    });
    setErrors((prev: RowErrors) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const copyPrevDir = (index: number) => {
    if (index === 0) {
      toast.warning('当前行没有上一行可复制');
      return;
    }
    const prev = rows[index - 1];
    if (!prev) return;
    setRows((prevRows: BatchRow[]) =>
      prevRows.map((r: BatchRow, i: number) =>
        i === index
          ? {
              ...r,
              targetFirstCategory: prev.targetFirstCategory,
              targetSecondCategory: prev.targetSecondCategory,
              owner: prev.owner,
            }
          : r,
      ),
    );
  };

  const clearAll = () => {
    setRows([createEmptyRow()]);
    setErrors({});
  };

  const validate = (): boolean => {
    const newErrors: RowErrors = {};
    const pathSet = new Set<string>();
    let hasError = false;

    rows.forEach((row: BatchRow, idx: number) => {
      const rowErrors: string[] = [];
      const rowNum = idx + 1;
      if (!row.feishuDocUrl) rowErrors.push(`第${rowNum}行：飞书文档链接不能为空`);
      if (!row.feishuDocTitle) rowErrors.push(`第${rowNum}行：飞书文档标题不能为空`);
      if (!row.targetFirstCategory) rowErrors.push(`第${rowNum}行：请选择目标一级目录`);
      if (!row.targetSecondCategory) rowErrors.push(`第${rowNum}行：请选择目标二级目录`);
      if (!row.helpCenterTitle) rowErrors.push(`第${rowNum}行：帮助中心文档标题不能为空`);
      if (!row.helpCenterSlug) {
        rowErrors.push(`第${rowNum}行：帮助中心路径标识不能为空`);
      } else if (!SLUG_REGEX.test(row.helpCenterSlug)) {
        rowErrors.push(`第${rowNum}行：路径标识只能使用小写英文、数字和短横线`);
      }
      if (!row.syncMode) rowErrors.push(`第${rowNum}行：请选择同步方式`);
      if (!row.owner) rowErrors.push(`第${rowNum}行：请选择负责人`);

      if (rowErrors.length > 0) {
        hasError = true;
      }
      newErrors[row.id] = rowErrors;

      const pathKey = `${row.language}:${buildFilePath(row, categoryOptions)}`;
      if (pathKey !== `${row.language}:`) {
        if (pathSet.has(pathKey)) {
          hasError = true;
          rowErrors.push(`第${rowNum}行：存在重复的帮助中心文件路径，请检查路径标识`);
        }
        pathSet.add(pathKey);
      }
    });

    setErrors(newErrors);
    if (hasError) {
      const firstErr = Object.values(newErrors)
        .find((e: string[]) => e.length > 0)?.[0] ?? '';
      toast.error(firstErr || '请检查表单填写');
    }
    return !hasError;
  };

  const handleSaveAll = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const items: CreateFeishuMappingRequest[] = rows.map(
        (row: BatchRow): CreateFeishuMappingRequest => ({
          feishuDocUrl: row.feishuDocUrl,
          feishuDocTitle: row.feishuDocTitle,
          targetFirstCategory: row.targetFirstCategory,
          targetSecondCategory: row.targetSecondCategory,
          helpCenterTitle: row.helpCenterTitle,
          helpCenterSlug: row.helpCenterSlug,
          owner: row.owner,
          syncMode: row.syncMode,
          enabled: row.enabled,
          syncAfterSave: row.syncAfterSave,
          language: row.language,
        }),
      );

      const result = await feishuMappingsApi.batchCreateMapping({ items });

      const docPromises: Promise<unknown>[] = rows.map(
        (row: BatchRow): Promise<unknown> => {
          const docReq: CreateDocRequest = {
            title: row.helpCenterTitle,
            firstCategory: row.targetFirstCategory,
            secondCategory: row.targetSecondCategory,
            slug: row.helpCenterSlug,
            owner: row.owner,
            sourceType: '飞书同步',
            sourceUrl: row.feishuDocUrl,
            language: row.language,
          };
          return documentsApi.createDoc(docReq);
        },
      );
      await Promise.all(docPromises);

      toast.success(`已成功创建 ${result.total} 条映射`);
      onSuccess();
      onOpenChange(false);
      setRows([createEmptyRow()]);
      setErrors({});

      const syncIds: string[] = [];
      result.ids.forEach((id: string, idx: number) => {
        if (rows[idx]?.syncAfterSave) syncIds.push(id);
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
      toast.error(err instanceof Error ? err.message : '批量创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v && !submitting) {
      setRows([createEmptyRow()]);
      setErrors({});
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批量新增映射</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-2">
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="mr-1 size-3.5" />
            新增一行
          </Button>
          <Button size="sm" variant="outline" onClick={clearAll}>
            清空全部
          </Button>
          <span className="text-sm text-muted-foreground ml-auto">
            共 {rows.length} 行
          </span>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-left font-medium w-10">#</th>
                <th className="px-2 py-2 text-left font-medium min-w-[180px]">飞书文档链接</th>
                <th className="px-2 py-2 text-left font-medium min-w-[140px]">飞书文档标题</th>
                <th className="px-2 py-2 text-left font-medium min-w-[130px]">一级目录</th>
                <th className="px-2 py-2 text-left font-medium min-w-[130px]">二级目录</th>
                <th className="px-2 py-2 text-left font-medium min-w-[160px]">帮助中心标题</th>
                <th className="px-2 py-2 text-left font-medium min-w-[120px]">帮助中心路径标识</th>
                <th className="px-2 py-2 text-left font-medium min-w-[90px]">语言版本</th>
                <th className="px-2 py-2 text-left font-medium min-w-[200px]">文件路径预览</th>
                <th className="px-2 py-2 text-left font-medium min-w-[110px]">同步方式</th>
                <th className="px-2 py-2 text-left font-medium min-w-[140px]">负责人</th>
                <th className="px-2 py-2 text-center font-medium w-[60px]">启用</th>
                <th className="px-2 py-2 text-center font-medium w-[90px]">立即同步</th>
                <th className="px-2 py-2 text-center font-medium w-[100px]">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: BatchRow, index: number) => {
                const rowErrs = errors[row.id] ?? [];
                const hasErr = rowErrs.length > 0;
                const preview = buildPathPreview(row, categoryOptions);
                const secondOpts = categoryOptions.filter(
                  (o: CategoryOption) =>
                    o.level === 2 && o.parentId === row.targetFirstCategory,
                );
                return (
                  <tr
                    key={row.id}
                    className={`border-t ${hasErr ? 'bg-destructive/5' : ''}`}
                  >
                    <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={row.feishuDocUrl}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateRow(row.id, 'feishuDocUrl', e.target.value)
                        }
                        placeholder="https://..."
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={row.feishuDocTitle}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateRow(row.id, 'feishuDocTitle', e.target.value)
                        }
                        placeholder="文档标题"
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={row.targetFirstCategory || undefined}
                        onValueChange={(v: string) =>
                          updateRow(row.id, 'targetFirstCategory', v)
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="请选择" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoryOptions
                            .filter((o: CategoryOption) => o.level === 1)
                            .map((o: CategoryOption) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.nameCn}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={row.targetSecondCategory || undefined}
                        onValueChange={(v: string) =>
                          updateRow(row.id, 'targetSecondCategory', v)
                        }
                        disabled={!row.targetFirstCategory}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue
                            placeholder={
                              row.targetFirstCategory ? '请选择' : '先选一级'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {secondOpts.map((o: CategoryOption) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.nameCn}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={row.helpCenterTitle}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateRow(row.id, 'helpCenterTitle', e.target.value)
                        }
                        placeholder="文档标题"
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={row.helpCenterSlug}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateRow(row.id, 'helpCenterSlug', e.target.value)
                        }
                        placeholder="如：getting-started"
                        className="h-8 text-xs font-mono"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={row.language}
                        onValueChange={(v: Language) =>
                          updateRow(row.id, 'language', v)
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="zh-CN">中文</SelectItem>
                          <SelectItem value="en">英文</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <code className="text-xs text-muted-foreground break-all">
                        {preview || '待生成'}
                      </code>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={row.syncMode}
                        onValueChange={(v: SyncMode) =>
                          updateRow(row.id, 'syncMode', v)
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SYNC_MODES.map((m: SyncMode) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <UserSelect
                        value={row.owner || null}
                        onChange={(v: string | null) =>
                          updateRow(row.id, 'owner', v ?? '')
                        }
                        placeholder="选择"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Switch
                        checked={row.enabled}
                        onCheckedChange={(v: boolean) =>
                          updateRow(row.id, 'enabled', v)
                        }
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Switch
                        checked={row.syncAfterSave}
                        onCheckedChange={(v: boolean) =>
                          updateRow(row.id, 'syncAfterSave', v)
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => copyPrevDir(index)}
                          title="复制上一行目录配置"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => removeRow(row.id)}
                          disabled={rows.length <= 1}
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {Object.values(errors).some((e: string[]) => e.length > 0) && (
          <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive max-h-24 overflow-y-auto">
            {Object.entries(errors)
              .filter(([, v]: [string, string[]]) => v.length > 0)
              .flatMap(([, v]: [string, string[]]) => v)
              .slice(0, 10)
              .map((msg: string, i: number) => (
                <div key={i}>{msg}</div>
              ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleClose(false)}>
            取消
          </Button>
          <Button onClick={handleSaveAll} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存全部
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BatchCreateMappingDialog;
