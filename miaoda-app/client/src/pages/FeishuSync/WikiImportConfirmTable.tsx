import React, { useState, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
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
import { UserSelect } from '@client/src/components/business-ui/user-select';
import type {
  CategoryOption,
  Language,
  SyncMode,
  WikiImportNode,
} from '@shared/api.interface';

const SLUG_REGEX = /^[a-z0-9-]+$/;
const SYNC_MODES: SyncMode[] = ['手动同步', '定时同步', '事件触发同步'];

interface WikiImportRow {
  nodeToken: string;
  objToken: string;
  wikiUrl: string;
  feishuTitle: string;
  wikiPath: string;
  targetFirstCategory: string;
  targetSecondCategory: string;
  helpCenterTitle: string;
  helpCenterSlug: string;
  language: Language;
  owner: string;
  syncMode: SyncMode;
}

interface RowErrors {
  [nodeToken: string]: string[];
}

interface WikiImportConfirmTableProps {
  selectedNodes: WikiImportNode[];
  categoryOptions: CategoryOption[];
}

export interface WikiImportConfirmTableRef {
  validate: () => boolean;
  getRows: () => WikiImportRow[];
  getSyncAfterCreate: () => boolean;
}

function generateSlug(title: string): string {
  const ascii = title.replace(/[^\x20-\x7E]/g, '').trim();
  if (!ascii) return `doc-${Date.now().toString(36)}`;
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `doc-${Date.now().toString(36)}`;
}

function buildPathMap(nodes: WikiImportNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    if (node.wikiPath) {
      map.set(node.nodeToken, node.wikiPath);
    }
  }
  return map;
}

function initRow(node: WikiImportNode): WikiImportRow {
  return {
    nodeToken: node.nodeToken,
    objToken: node.objToken,
    wikiUrl: node.wikiUrl,
    feishuTitle: node.title,
    wikiPath: node.wikiPath || node.title,
    targetFirstCategory: '',
    targetSecondCategory: '',
    helpCenterTitle: node.title,
    helpCenterSlug: generateSlug(node.title),
    language: 'zh-CN' as Language,
    owner: '',
    syncMode: '手动同步',
  };
}

const WikiImportConfirmTable = forwardRef<WikiImportConfirmTableRef, WikiImportConfirmTableProps>(
  ({ selectedNodes, categoryOptions }, ref) => {
    const [rows, setRows] = useState<WikiImportRow[]>(
      () => selectedNodes.map(initRow),
    );
    const [errors, setErrors] = useState<RowErrors>({});
    const [syncAfterCreate, setSyncAfterCreate] = useState<boolean>(false);

    const [batchFirst, setBatchFirst] = useState<string>('');
    const [batchSecond, setBatchSecond] = useState<string>('');
    const [batchOwner, setBatchOwner] = useState<string>('');
    const [batchLang, setBatchLang] = useState<Language>('zh-CN');
    const [batchSyncMode, setBatchSyncMode] = useState<SyncMode>('手动同步');

    const firstCatOptions = useMemo<CategoryOption[]>(
      () => categoryOptions.filter((c: CategoryOption) => c.level === 1 && c.enabled),
      [categoryOptions],
    );

    const updateRow = useCallback((nodeToken: string, field: keyof WikiImportRow, value: unknown): void => {
      setRows((prev: WikiImportRow[]) =>
        prev.map((r: WikiImportRow) => {
          if (r.nodeToken !== nodeToken) return r;
          const updated = { ...r, [field]: value };
          if (field === 'targetFirstCategory') {
            updated.targetSecondCategory = '';
          }
          return updated;
        }),
      );
    }, []);

    const applyBatch = useCallback((): void => {
      setRows((prev: WikiImportRow[]) =>
        prev.map((r: WikiImportRow) => {
          const updated = { ...r };
          if (batchFirst) {
            updated.targetFirstCategory = batchFirst;
            updated.targetSecondCategory = '';
          }
          if (batchSecond) updated.targetSecondCategory = batchSecond;
          if (batchOwner) updated.owner = batchOwner;
          if (batchLang) updated.language = batchLang;
          if (batchSyncMode) updated.syncMode = batchSyncMode;
          return updated;
        }),
      );
      setErrors({});
    }, [batchFirst, batchSecond, batchOwner, batchLang, batchSyncMode]);

    const validate = useCallback((): boolean => {
      const newErrors: RowErrors = {};
      let hasError = false;
      const pathSet = new Set<string>();

      rows.forEach((row: WikiImportRow, idx: number) => {
        const rowErrs: string[] = [];
        const rowNum = idx + 1;
        if (!row.targetFirstCategory) rowErrs.push(`第${rowNum}行：请选择目标一级目录`);
        if (!row.helpCenterTitle) rowErrs.push(`第${rowNum}行：帮助中心标题不能为空`);
        if (!row.helpCenterSlug) {
          rowErrs.push(`第${rowNum}行：帮助中心路径标识不能为空`);
        } else if (!SLUG_REGEX.test(row.helpCenterSlug)) {
          rowErrs.push(`第${rowNum}行：路径标识只能使用小写英文、数字和短横线`);
        }
        if (!row.owner) rowErrs.push(`第${rowNum}行：请选择负责人`);

        if (rowErrs.length > 0) hasError = true;
        newErrors[row.nodeToken] = rowErrs;

        const pathKey = `${row.language}:${row.helpCenterSlug}`;
        if (pathKey !== `${row.language}:`) {
          if (pathSet.has(pathKey)) {
            hasError = true;
            rowErrs.push(`第${rowNum}行：路径标识重复`);
          }
          pathSet.add(pathKey);
        }
      });

      setErrors(newErrors);
      return !hasError;
    }, [rows]);

    const getRows = useCallback((): WikiImportRow[] => rows, [rows]);

    useImperativeHandle(ref, () => ({ validate, getRows, getSyncAfterCreate: () => syncAfterCreate }), [validate, getRows, syncAfterCreate]);

    const batchSecondOpts = useMemo<CategoryOption[]>(
      () => categoryOptions.filter(
        (c: CategoryOption) => c.level === 2 && c.enabled && c.parentId === batchFirst,
      ),
      [categoryOptions, batchFirst],
    );

    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-dashed p-3 flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">批量填充默认值</span>
          <div className="grid grid-cols-5 gap-2">
            <Select value={batchFirst || undefined} onValueChange={(v: string) => { setBatchFirst(v); setBatchSecond(''); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="一级目录" /></SelectTrigger>
              <SelectContent>
                {firstCatOptions.map((c: CategoryOption) => (
                  <SelectItem key={c.id} value={c.id}>{c.nameCn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={batchSecond || undefined} onValueChange={setBatchSecond} disabled={!batchFirst}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={batchFirst ? '二级目录' : '先选一级'} /></SelectTrigger>
              <SelectContent>
                {batchSecondOpts.map((c: CategoryOption) => (
                  <SelectItem key={c.id} value={c.id}>{c.nameCn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <UserSelect value={batchOwner || null} onChange={(v: string | null) => setBatchOwner(v ?? '')} placeholder="负责人" />
            <Select value={batchLang} onValueChange={(v: Language) => setBatchLang(v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">中文</SelectItem>
                <SelectItem value="en">英文</SelectItem>
              </SelectContent>
            </Select>
            <Select value={batchSyncMode} onValueChange={(v: SyncMode) => setBatchSyncMode(v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SYNC_MODES.map((m: SyncMode) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" className="self-start h-7 text-xs" onClick={applyBatch}>
            应用到所有行
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-left font-medium w-10">#</th>
                <th className="px-2 py-2 text-left font-medium min-w-[140px]">飞书文档标题</th>
                <th className="px-2 py-2 text-left font-medium min-w-[160px]">飞书所在路径</th>
                <th className="px-2 py-2 text-left font-medium min-w-[120px]">一级目录</th>
                <th className="px-2 py-2 text-left font-medium min-w-[120px]">二级目录</th>
                <th className="px-2 py-2 text-left font-medium min-w-[140px]">帮助中心标题</th>
                <th className="px-2 py-2 text-left font-medium min-w-[120px]">路径标识</th>
                <th className="px-2 py-2 text-left font-medium min-w-[80px]">语言</th>
                <th className="px-2 py-2 text-left font-medium min-w-[130px]">负责人</th>
                <th className="px-2 py-2 text-left font-medium min-w-[100px]">同步方式</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: WikiImportRow, index: number) => {
                const rowErrs = errors[row.nodeToken] ?? [];
                const hasErr = rowErrs.length > 0;
                const secondOpts = categoryOptions.filter(
                  (c: CategoryOption) => c.level === 2 && c.enabled && c.parentId === row.targetFirstCategory,
                );
                return (
                  <tr key={row.nodeToken} className={`border-t ${hasErr ? 'bg-destructive/5' : ''}`}>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{index + 1}</td>
                    <td className="px-2 py-2 text-xs" title={row.feishuTitle}>
                      <span className="truncate block max-w-[140px]">{row.feishuTitle}</span>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground" title={row.wikiPath}>
                      <span className="truncate block max-w-[160px]">{row.wikiPath}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={row.targetFirstCategory || undefined}
                        onValueChange={(v: string) => updateRow(row.nodeToken, 'targetFirstCategory', v)}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择" /></SelectTrigger>
                        <SelectContent>
                          {firstCatOptions.map((c: CategoryOption) => (
                            <SelectItem key={c.id} value={c.id}>{c.nameCn}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={row.targetSecondCategory || undefined}
                        onValueChange={(v: string) => updateRow(row.nodeToken, 'targetSecondCategory', v)}
                        disabled={!row.targetFirstCategory}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder={row.targetFirstCategory ? '请选择' : '先选一级'} />
                        </SelectTrigger>
                        <SelectContent>
                          {secondOpts.map((c: CategoryOption) => (
                            <SelectItem key={c.id} value={c.id}>{c.nameCn}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={row.helpCenterTitle}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateRow(row.nodeToken, 'helpCenterTitle', e.target.value)
                        }
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={row.helpCenterSlug}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateRow(row.nodeToken, 'helpCenterSlug', e.target.value)
                        }
                        className="h-8 text-xs font-mono"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={row.language}
                        onValueChange={(v: Language) => updateRow(row.nodeToken, 'language', v)}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="zh-CN">中文</SelectItem>
                          <SelectItem value="en">英文</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <UserSelect
                        value={row.owner || null}
                        onChange={(v: string | null) => updateRow(row.nodeToken, 'owner', v ?? '')}
                        placeholder="选择"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={row.syncMode}
                        onValueChange={(v: SyncMode) => updateRow(row.nodeToken, 'syncMode', v)}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SYNC_MODES.map((m: SyncMode) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
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
              .map((msg: string, i: number) => <div key={i}>{msg}</div>)}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch checked={syncAfterCreate} onCheckedChange={setSyncAfterCreate} />
          <span className="text-sm">保存后立即同步（生成草稿，不自动发布）</span>
        </div>

        <div className="text-xs text-muted-foreground">
          共 {rows.length} 篇文档待导入
        </div>
      </div>
    );
  },
);

WikiImportConfirmTable.displayName = 'WikiImportConfirmTable';

export { WikiImportConfirmTable };
export type { WikiImportRow, WikiImportConfirmTableProps };
