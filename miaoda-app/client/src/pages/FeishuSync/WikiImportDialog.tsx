import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Badge } from '@client/src/components/ui/badge';
import { feishuMappingsApi } from '@client/src/api';
import { WikiTreeSelector } from './WikiTreeSelector';
import { WikiImportConfirmTable } from './WikiImportConfirmTable';
import type { WikiImportConfirmTableRef, WikiImportRow } from './WikiImportConfirmTable';
import type {
  CategoryOption,
  WikiDiagnoseResponse,
  WikiPreviewTreeResponse,
  WikiImportResponse,
  WikiTreeNodeItem,
  WikiImportNode,
  WikiSpaceItem,
  WikiDiagnoseCheckItem,
} from '@shared/api.interface';

interface WikiImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryOptions: CategoryOption[];
  onSuccess: () => void;
}

interface DiagnoseCheckEntry {
  label: string;
  key: keyof Pick<WikiDiagnoseResponse, 'credential' | 'wikiRead' | 'docRead' | 'resourceDownload'>;
}

const DIAGNOSE_CHECKS: DiagnoseCheckEntry[] = [
  { label: '应用凭证', key: 'credential' },
  { label: '知识库读取', key: 'wikiRead' },
  { label: '文档读取', key: 'docRead' },
  { label: '资源下载', key: 'resourceDownload' },
];

const STEP_LABELS = ['链接诊断', '选择文档', '导入确认', '导入结果'];

function collectSelectedNodes(
  nodes: WikiTreeNodeItem[],
  selectedKeys: Set<string>,
  parentPath: string = '',
): WikiImportNode[] {
  const result: WikiImportNode[] = [];
  for (const node of nodes) {
    const currentPath = parentPath ? `${parentPath} > ${node.title}` : node.title;
    if (selectedKeys.has(node.nodeToken)) {
      result.push({
        nodeToken: node.nodeToken,
        objToken: node.objToken,
        title: node.title,
        wikiUrl: node.wikiUrl,
        wikiPath: currentPath,
      });
    }
    if (node.children.length > 0) {
      result.push(...collectSelectedNodes(node.children, selectedKeys, currentPath));
    }
  }
  return result;
}

const WikiImportDialog: React.FC<WikiImportDialogProps> = ({
  open,
  onOpenChange,
  categoryOptions,
  onSuccess,
}) => {
  const [step, setStep] = useState<number>(1);
  const [wikiUrl, setWikiUrl] = useState<string>('');
  const [diagnosing, setDiagnosing] = useState<boolean>(false);
  const [diagnoseResult, setDiagnoseResult] = useState<WikiDiagnoseResponse | null>(null);
  const [loadingTree, setLoadingTree] = useState<boolean>(false);
  const [treeData, setTreeData] = useState<WikiPreviewTreeResponse | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [syncAfterCreate, setSyncAfterCreate] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<WikiImportResponse | null>(null);
  const [inputMode, setInputMode] = useState<'link' | 'select'>('link');
  const [loadingSpaces, setLoadingSpaces] = useState<boolean>(false);
  const [spacesResult, setSpacesResult] = useState<{ available: boolean; message?: string; spaces: WikiSpaceItem[] } | null>(null);
  const [autoDiagnosing, setAutoDiagnosing] = useState<boolean>(false);
  const tableRef = useRef<WikiImportConfirmTableRef>(null);

  const diagnoseAllPass = diagnoseResult !== null
    && diagnoseResult.credential.ok
    && diagnoseResult.wikiRead.ok
    && diagnoseResult.docRead.ok
    && diagnoseResult.resourceDownload.ok;

  const resetAll = useCallback((): void => {
    setStep(1);
    setWikiUrl('');
    setDiagnosing(false);
    setDiagnoseResult(null);
    setLoadingTree(false);
    setTreeData(null);
    setSelectedKeys(new Set());
    setSyncAfterCreate(false);
    setImporting(false);
    setImportResult(null);
    setInputMode('link');
    setLoadingSpaces(false);
    setSpacesResult(null);
    setAutoDiagnosing(false);
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean): void => {
    if (!nextOpen) resetAll();
    onOpenChange(nextOpen);
  }, [onOpenChange, resetAll]);

  const handleDiagnose = useCallback(async (): Promise<void> => {
    if (!wikiUrl.trim()) {
      toast.error('请输入知识库链接');
      return;
    }
    setDiagnosing(true);
    try {
      const result = await feishuMappingsApi.wikiDiagnose({ wikiUrl: wikiUrl.trim() });
      setDiagnoseResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '诊断失败';
      toast.error(msg);
    } finally {
      setDiagnosing(false);
    }
  }, [wikiUrl]);

  const handleLoadTree = useCallback(async (): Promise<void> => {
    setLoadingTree(true);
    try {
      const result = await feishuMappingsApi.wikiPreviewTree({ wikiUrl: wikiUrl.trim() });
      setTreeData(result);
      setSelectedKeys(new Set());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '读取目录失败';
      toast.error(msg);
    } finally {
      setLoadingTree(false);
    }
  }, [wikiUrl]);

  const goToStep = useCallback((target: number): void => {
    if (target === 2 && step === 1) {
      handleLoadTree();
    }
    setStep(target);
  }, [step, handleLoadTree]);

  const handleImport = useCallback(async (): Promise<void> => {
    if (!tableRef.current) return;
    const valid = tableRef.current.validate();
    if (!valid) {
      toast.error('请修正表格中的错误后再导入');
      return;
    }
    const rows = tableRef.current.getRows();
    const shouldSync = tableRef.current.getSyncAfterCreate();
    if (rows.length === 0) {
      toast.error('没有可导入的文档');
      return;
    }
    setImporting(true);
    try {
      const nodes: WikiImportNode[] = rows.map((row: WikiImportRow): WikiImportNode => ({
        nodeToken: row.nodeToken,
        objToken: row.objToken,
        title: row.feishuTitle,
        wikiUrl: row.wikiUrl,
        wikiPath: row.wikiPath,
        targetFirstCategory: row.targetFirstCategory,
        targetSecondCategory: row.targetSecondCategory || undefined,
        helpCenterTitle: row.helpCenterTitle,
        helpCenterSlug: row.helpCenterSlug,
        language: row.language,
        syncMode: row.syncMode,
        owner: row.owner,
      }));
      const result = await feishuMappingsApi.wikiImport({
        selectedNodes: nodes,
        targetFirstCategory: '',
        owner: '',
        language: 'zh-CN',
        syncMode: '手动同步',
        syncAfterCreate: shouldSync,
      });
      setImportResult(result);
      setStep(4);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '导入失败';
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  }, []);

  const handleComplete = useCallback((): void => {
    handleOpenChange(false);
    onSuccess();
  }, [handleOpenChange, onSuccess]);

  const renderDiagnoseItem = (item: WikiDiagnoseCheckItem, label: string): React.ReactNode => (
    <div className="flex items-center gap-2 text-sm">
      {item.ok
        ? <CheckCircle2 className="size-4 text-green-600 shrink-0" />
        : <XCircle className="size-4 text-red-500 shrink-0" />}
      <span className={item.ok ? 'text-foreground' : 'text-red-500'}>
        {label}：{item.message}
      </span>
    </div>
  );

  const handleLoadSpaces = useCallback(async (): Promise<void> => {
    setLoadingSpaces(true);
    try {
      const result = await feishuMappingsApi.wikiListSpaces();
      setSpacesResult(result);
      if (!result.available && result.message) {
        toast.error(result.message);
        setInputMode('link');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取知识库列表失败';
      toast.error(msg);
      setSpacesResult({ available: false, message: msg, spaces: [] });
      setInputMode('link');
    } finally {
      setLoadingSpaces(false);
    }
  }, []);

  const handleSelectAndDiagnose = useCallback(async (space: WikiSpaceItem): Promise<void> => {
    const spaceUrl = `https://feishu.cn/wiki/space/${space.spaceId}`;
    setWikiUrl(spaceUrl);
    setAutoDiagnosing(true);
    setDiagnoseResult(null);
    try {
      const diagResult = await feishuMappingsApi.wikiDiagnose({ wikiUrl: spaceUrl });
      setDiagnoseResult(diagResult);
      const allOk = diagResult.credential.ok && diagResult.wikiRead.ok
        && diagResult.docRead.ok && diagResult.resourceDownload.ok;
      if (allOk) {
        setLoadingTree(true);
        const treeResult = await feishuMappingsApi.wikiPreviewTree({ wikiUrl: spaceUrl });
        setTreeData(treeResult);
        setSelectedKeys(new Set());
        setLoadingTree(false);
        setStep(2);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '诊断失败';
      toast.error(msg);
    } finally {
      setAutoDiagnosing(false);
    }
  }, []);

  const renderStep1 = (): React.ReactNode => (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 border-b pb-2">
        <button
          type="button"
          className={`px-3 py-1.5 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
            inputMode === 'link'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={(): void => setInputMode('link')}
        >
          粘贴链接
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
            inputMode === 'select'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={(): void => { setInputMode('select'); if (!spacesResult) handleLoadSpaces(); }}
        >
          选择知识库
        </button>
      </div>

      {inputMode === 'link' && (
        <>
          <div className="flex items-center gap-2">
            <Input
              value={wikiUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWikiUrl(e.target.value)}
              placeholder="请粘贴飞书知识库链接，如 /wiki/space/{spaceId} 或 /wiki/{nodeToken}"
              className="flex-1"
            />
            <Button
              onClick={handleDiagnose}
              disabled={diagnosing || !wikiUrl.trim()}
              variant="outline"
            >
              {diagnosing ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  诊断中
                </>
              ) : '诊断权限'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            支持的链接格式：知识库空间链接（/wiki/space/...）或目录节点链接（/wiki/...）
          </p>
        </>
      )}

      {inputMode === 'select' && (
        <div className="flex flex-col gap-3">
          {loadingSpaces && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              正在加载飞书应用可访问的知识库...
            </div>
          )}
          {!loadingSpaces && !autoDiagnosing && spacesResult && !spacesResult.available && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p>无法自动列出知识库列表：{spacesResult.message}</p>
              <p className="mt-1 text-xs">请切换到「粘贴链接」模式，手动输入知识库链接。</p>
            </div>
          )}
          {!loadingSpaces && !autoDiagnosing && spacesResult && spacesResult.available && spacesResult.spaces.length === 0 && (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              飞书应用当前无可访问的知识库。请确认已将飞书应用机器人添加为知识库协作者。
            </div>
          )}
          {!loadingSpaces && !autoDiagnosing && spacesResult && spacesResult.available && spacesResult.spaces.length > 0 && (
            <div className="max-h-[240px] overflow-y-auto rounded-md border divide-y">
              {spacesResult.spaces.map((space: WikiSpaceItem) => (
                <button
                  key={space.spaceId}
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                  onClick={(): void => { handleSelectAndDiagnose(space); }}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{space.name || space.spaceId}</span>
                    {space.description && (
                      <span className="text-xs text-muted-foreground truncate">{space.description}</span>
                    )}
                    <span className="text-xs text-muted-foreground mt-0.5">spaceId: {space.spaceId}</span>
                  </div>
                  <Badge variant="outline" className="shrink-0 ml-2 text-xs">选择</Badge>
                </button>
              ))}
            </div>
          )}
          {autoDiagnosing && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="size-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">正在诊断知识库权限并加载目录...</span>
            </div>
          )}
          {!loadingSpaces && !spacesResult && !autoDiagnosing && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Button variant="outline" onClick={handleLoadSpaces}>
                加载可访问知识库
              </Button>
            </div>
          )}
          {autoDiagnosing && diagnoseResult && !diagnoseAllPass && (
            <div className="rounded-md border p-4 flex flex-col gap-2">
              <p className="text-sm font-medium text-red-600">诊断未通过，请检查以下项目：</p>
              {DIAGNOSE_CHECKS.map((check: DiagnoseCheckEntry) =>
                renderDiagnoseItem(diagnoseResult[check.key], check.label),
              )}
            </div>
          )}
        </div>
      )}

      {diagnoseResult && inputMode === 'link' && (
        <div className="rounded-md border p-4 flex flex-col gap-2">
          {DIAGNOSE_CHECKS.map((check: DiagnoseCheckEntry) =>
            renderDiagnoseItem(diagnoseResult[check.key], check.label),
          )}
          {diagnoseResult.spaceId && (
            <div className="mt-2 text-xs text-muted-foreground">
              知识库：{diagnoseResult.spaceName || diagnoseResult.spaceId}（{diagnoseResult.spaceId}）
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderStep2 = (): React.ReactNode => (
    <div className="flex flex-col gap-3">
      {loadingTree && !treeData && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          正在读取知识库目录...
        </div>
      )}
      {treeData && (
        <WikiTreeSelector
          tree={treeData.tree}
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          totalDocCount={treeData.totalDocCount}
          existingMappingCount={treeData.existingMappingCount}
          truncated={treeData.truncated}
        />
      )}
    </div>
  );

  const selectedNodes = useMemo<WikiImportNode[]>(() => {
    if (!treeData) return [];
    return collectSelectedNodes(treeData.tree, selectedKeys);
  }, [treeData, selectedKeys]);

  const renderStep3 = (): React.ReactNode => (
    <WikiImportConfirmTable
      ref={tableRef}
      selectedNodes={selectedNodes}
      categoryOptions={categoryOptions}
    />
  );

  const renderStep4 = (): React.ReactNode => (
    <div className="flex flex-col gap-4">
      {importing && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          正在导入 {selectedKeys.size} 篇文档...
        </div>
      )}
      {importResult && !importing && (
        <>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50">
              成功 {importResult.successCount}
            </Badge>
            <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">
              失败 {importResult.failCount}
            </Badge>
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
              跳过 {importResult.skipCount}
            </Badge>
          </div>
          <div className="max-h-[280px] overflow-y-auto rounded-md border divide-y">
            {importResult.items.map((item, idx: number) => (
              <div key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate mr-2" title={item.title}>{item.title}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="outline"
                    className={
                      item.status === 'success'
                        ? 'border-green-300 text-green-700'
                        : item.status === 'failed'
                          ? 'border-red-300 text-red-700'
                          : 'border-amber-300 text-amber-700'
                    }
                  >
                    {item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '跳过'}
                  </Badge>
                  {item.reason && (
                    <span className="text-xs text-muted-foreground max-w-[160px] truncate" title={item.reason}>
                      {item.reason}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const renderFooter = (): React.ReactNode => (
    <div className="flex items-center justify-between pt-2">
      <span className="text-xs text-muted-foreground">步骤 {step}/4 — {STEP_LABELS[step - 1]}</span>
      <div className="flex items-center gap-2">
        {step > 1 && step < 4 && (
          <Button variant="outline" size="sm" onClick={(): void => goToStep(step - 1)}>
            上一步
          </Button>
        )}
        {step === 1 && (
          <Button size="sm" disabled={!diagnoseAllPass} onClick={(): void => goToStep(2)}>
            下一步
          </Button>
        )}
        {step === 2 && (
          <Button size="sm" disabled={selectedKeys.size === 0} onClick={(): void => goToStep(3)}>
            下一步
          </Button>
        )}
        {step === 3 && (
          <Button size="sm" disabled={importing} onClick={handleImport}>
            {importing ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                导入中
              </>
            ) : '开始导入'}
          </Button>
        )}
        {step === 4 && (
          <Button size="sm" onClick={handleComplete}>
            完成
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`${step === 3 ? 'max-w-[95vw]' : 'max-w-3xl'} max-h-[90vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>知识库导入</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 min-h-[320px]">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {renderFooter()}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { WikiImportDialog };
export type { WikiImportDialogProps };
