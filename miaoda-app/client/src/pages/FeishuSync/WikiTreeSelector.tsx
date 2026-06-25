import React, { useState, useMemo, useCallback } from 'react';
import {
  FolderOpen,
  FileText,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { Checkbox } from '@client/src/components/ui/checkbox';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import type { WikiTreeNodeItem } from '@shared/api.interface';

interface WikiTreeSelectorProps {
  tree: WikiTreeNodeItem[];
  selectedKeys: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  totalDocCount: number;
  existingMappingCount: number;
  truncated: boolean;
}

function collectCheckableDocKeys(nodes: WikiTreeNodeItem[]): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    if (node.nodeType === 'docx' && !node.existingMapping) {
      keys.push(node.nodeToken);
    }
    if (node.children.length > 0) {
      keys.push(...collectCheckableDocKeys(node.children));
    }
  }
  return keys;
}

function getIcon(nodeType: string): React.ReactNode {
  switch (nodeType) {
    case 'folder':
      return <FolderOpen className="size-4 text-amber-500 shrink-0" />;
    case 'docx':
      return <FileText className="size-4 text-blue-500 shrink-0" />;
    default:
      return <AlertCircle className="size-4 text-muted-foreground shrink-0" />;
  }
}

interface TreeNodeRowProps {
  node: WikiTreeNodeItem;
  depth: number;
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
}

const TreeNodeRow: React.FC<TreeNodeRowProps> = ({
  node,
  depth,
  selectedKeys,
  onToggle,
}) => {
  const [expanded, setExpanded] = useState<boolean>(true);
  const isDocx = node.nodeType === 'docx';
  const hasChildren = node.children.length > 0;
  const canCheck = isDocx && !node.existingMapping;
  const isDisabled = !canCheck;
  const isChecked = selectedKeys.has(node.nodeToken);

  const handleToggle = useCallback((): void => {
    if (canCheck) onToggle(node.nodeToken);
  }, [canCheck, node.nodeToken, onToggle]);

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/50 rounded-sm cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="flex items-center justify-center size-4 shrink-0"
            onClick={(): void => setExpanded((v: boolean) => !v)}
          >
            <ChevronRight
              className={`size-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <Checkbox
          checked={isChecked}
          onCheckedChange={handleToggle}
          disabled={isDisabled}
        />
        {getIcon(node.nodeType)}
        <span
          className={`text-sm truncate ${isDisabled && !hasChildren ? 'text-muted-foreground' : ''}`}
          title={node.title}
        >
          {node.title}
        </span>
        {node.existingMapping && (
          <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/30 shrink-0">
            已映射
          </Badge>
        )}
        {!isDocx && !node.existingMapping && (
          <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/30 shrink-0" title={node.objType}>
            不支持
          </Badge>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child: WikiTreeNodeItem) => (
            <TreeNodeRow
              key={child.nodeToken}
              node={child}
              depth={depth + 1}
              selectedKeys={selectedKeys}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const WikiTreeSelector: React.FC<WikiTreeSelectorProps> = ({
  tree,
  selectedKeys,
  onSelectionChange,
  totalDocCount,
  existingMappingCount,
  truncated,
}) => {
  const allCheckableKeys = useMemo<string[]>(() => collectCheckableDocKeys(tree), [tree]);
  const importableCount = allCheckableKeys.length;
  const selectedCount = selectedKeys.size;
  const allSelected = allCheckableKeys.length > 0 && selectedCount === allCheckableKeys.length;

  const handleToggle = useCallback(
    (key: string): void => {
      const next = new Set(selectedKeys);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      onSelectionChange(next);
    },
    [selectedKeys, onSelectionChange],
  );

  const handleSelectAll = useCallback((): void => {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allCheckableKeys));
    }
  }, [allSelected, allCheckableKeys, onSelectionChange]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7"
          onClick={handleSelectAll}
        >
          {allSelected ? '取消全选' : '全选文档'}
        </Button>
        <span className="text-xs text-muted-foreground">
          已选 <span className="font-medium text-primary">{selectedCount}</span> 篇 / 可导入 {importableCount} 篇
        </span>
      </div>
      {truncated && (
        <div className="mx-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-700">
          目录树已截断，仅展示前 200 个节点
        </div>
      )}
      <div className="max-h-[360px] overflow-y-auto rounded-md border">
        {tree.map((node: WikiTreeNodeItem) => (
          <TreeNodeRow
            key={node.nodeToken}
            node={node}
            depth={0}
            selectedKeys={selectedKeys}
            onToggle={handleToggle}
          />
        ))}
      </div>
      <div className="text-xs text-muted-foreground px-2">
        共 {totalDocCount} 篇文档，已映射 {existingMappingCount} 篇，可导入 {importableCount} 篇
      </div>
    </div>
  );
};

export { WikiTreeSelector };
export type { WikiTreeSelectorProps };
