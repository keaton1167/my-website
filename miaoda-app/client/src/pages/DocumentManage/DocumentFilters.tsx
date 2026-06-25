import React from 'react';
import { Search, RotateCcw, RefreshCw, LayoutGrid, Table2 } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Input } from '@client/src/components/ui/input';
import { UserSelect } from '@client/src/components/business-ui/user-select';
import type { PublishStatus, ContentStatus, CategoryOption, Language, TranslationStatus } from '@shared/api.interface';

interface DocumentFiltersProps {
  firstCategory: string;
  secondCategory: string;
  publishStatus: string;
  contentStatus: string;
  language: string;
  owner: string;
  keyword: string;
  translationStatus: string;
  viewMode: 'group' | 'table';
  filterResetKey: number;
  categoryOptions: CategoryOption[];
  onFirstCategoryChange: (value: string) => void;
  onSecondCategoryChange: (value: string) => void;
  onPublishStatusChange: (value: string) => void;
  onContentStatusChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onKeywordChange: (value: string) => void;
  onTranslationStatusChange: (value: string) => void;
  onSearch: () => void;
  onReset: () => void;
  onRefresh: () => void;
  onViewModeChange: (mode: 'group' | 'table') => void;
}

const PUBLISH_STATUS_OPTIONS: { value: PublishStatus; label: string }[] = [
  { value: '草稿', label: '草稿' },
  { value: '待审核', label: '待审核' },
  { value: '待发布', label: '待发布' },
  { value: '已发布', label: '已发布' },
  { value: '已归档', label: '已归档' },
];

const CONTENT_STATUS_OPTIONS: { value: ContentStatus; label: string }[] = [
  { value: '有正文', label: '有正文' },
  { value: '无正文', label: '无正文' },
  { value: '待补充', label: '待补充' },
  { value: '转换失败', label: '转换失败' },
];

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
   { value: 'en', label: '英文' },
];

const TRANSLATION_STATUS_OPTIONS: { value: TranslationStatus; label: string }[] = [
  { value: '仅中文', label: '仅中文' },
  { value: '仅英文', label: '仅英文' },
  { value: '中英文完整', label: '中英文完整' },
  { value: '英文待更新', label: '英文待更新' },
];

const DocumentFilters: React.FC<DocumentFiltersProps> = ({
  firstCategory,
  secondCategory,
  publishStatus,
  contentStatus,
  language,
  owner,
  keyword,
  viewMode,
  filterResetKey,
  categoryOptions,
  onFirstCategoryChange,
  onSecondCategoryChange,
  onPublishStatusChange,
  onContentStatusChange,
  onLanguageChange,
  onOwnerChange,
  onKeywordChange,
  translationStatus,
  onTranslationStatusChange,
  onSearch,
  onReset,
  onRefresh,
  onViewModeChange,
}) => {
  const level1Options = categoryOptions.filter((opt: CategoryOption) => opt.level === 1);
  const level2Options = categoryOptions.filter((opt: CategoryOption) => {
    if (!firstCategory) return opt.level === 2;
    return opt.level === 2 && opt.parentId === firstCategory;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Select key={`fc-${filterResetKey}`} value={firstCategory || undefined} onValueChange={(v: string) => {
          onFirstCategoryChange(v);
          onSecondCategoryChange('');
        }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="请选择一级目录" />
          </SelectTrigger>
          <SelectContent>
            {level1Options.map((opt: CategoryOption) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.nameCn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select key={`sc-${filterResetKey}`} value={secondCategory || undefined} onValueChange={onSecondCategoryChange} disabled={!firstCategory}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={firstCategory ? '请选择二级目录' : '请先选择一级目录'} />
          </SelectTrigger>
          <SelectContent>
            {level2Options.map((opt: CategoryOption) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.nameCn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select key={`ps-${filterResetKey}`} value={publishStatus || undefined} onValueChange={onPublishStatusChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="请选择发布状态" />
          </SelectTrigger>
          <SelectContent>
            {PUBLISH_STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select key={`lang-${filterResetKey}`} value={language || undefined} onValueChange={onLanguageChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="请选择语言版本" />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="w-[200px]">
          <UserSelect
            value={owner || null}
            onChange={(v: string | null) => onOwnerChange(v ?? '')}
            triggerType="search"
            placeholder="请选择负责人"
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="搜索标题或摘要"
              value={keyword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onKeywordChange(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button size="sm" onClick={onSearch}>
            <Search className="mr-1 size-3.5" />
            查询
          </Button>
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="mr-1 size-3.5" />
            重置
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-1 size-3.5" />
            刷新
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DocumentFilters;
