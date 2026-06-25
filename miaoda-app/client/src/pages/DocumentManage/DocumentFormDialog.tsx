import React, { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { UserSelect } from '@client/src/components/business-ui/user-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@client/src/components/ui/alert-dialog';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import { documentsApi, categoriesApi } from '@client/src/api';
import type { DocItem, CategoryOption, Language } from '@shared/api.interface';

const docFormSchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  summary: z.string().optional(),
  language: z.enum(['zh-CN', 'en']),
  firstCategory: z.string().min(1, '请选择一级目录'),
  secondCategory: z.string().min(1, '请选择二级目录'),
  slug: z.string().min(1, '帮助中心路径标识不能为空').regex(/^[a-z0-9-]+$/, '路径标识只能使用小写英文、数字和短横线'),
  markdownContent: z.string().optional(),
  owner: z.string().min(1, '请选择负责人'),
});

type DocFormValues = z.infer<typeof docFormSchema>;

interface DocumentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingItem: DocItem | null;
  onSuccess: () => void;
}

const LANGUAGE_LABELS: Record<Language, string> = {
  'zh-CN': '中文',
  'en': '英文',
};

const DocumentFormDialog: React.FC<DocumentFormDialogProps> = ({
  open,
  onOpenChange,
  editingItem,
  onSuccess,
}) => {
  const [categoryOptions, setCategoryOptions] = React.useState<CategoryOption[]>([]);
  const [showEmptyContentConfirm, setShowEmptyContentConfirm] = React.useState<boolean>(false);
  const [pendingData, setPendingData] = React.useState<DocFormValues | null>(null);
  const [pathPreview, setPathPreview] = React.useState<{ filePath: string; helpCenterUrl: string; pathExists: boolean } | null>(null);
  const [pathPreviewLoading, setPathPreviewLoading] = React.useState<boolean>(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      void categoriesApi.getCategoryOptions(true).then((res) => {
        setCategoryOptions(res.items);
      });
    }
  }, [open]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DocFormValues>({
    resolver: zodResolver(docFormSchema),
    mode: 'onChange',
    defaultValues: {
      title: '',
      summary: '',
      language: 'zh-CN',
      firstCategory: '',
      secondCategory: '',
      slug: '',
      markdownContent: '',
      owner: '',
    },
  });

  const firstCategory = watch('firstCategory');
  const secondCategory = watch('secondCategory');
  const slug = watch('slug');
  const language = watch('language');

  useEffect(() => {
    if (open && editingItem) {
      reset({
        title: editingItem.title,
        summary: editingItem.summary,
        language: editingItem.language,
        firstCategory: editingItem.firstCategory,
        secondCategory: editingItem.secondCategory,
        slug: editingItem.slug,
        markdownContent: '',
        owner: editingItem.owner,
      });
    } else if (open) {
      reset({
        title: '',
        summary: '',
        language: 'zh-CN',
        firstCategory: '',
        secondCategory: '',
        slug: `doc-${Date.now().toString(36)}`,
        markdownContent: '',
        owner: '',
      });
    }
  }, [open, editingItem, reset]);

  const fetchPathPreview = useCallback(async (lang: Language, fc: string, sc: string, s: string, excludeId?: string) => {
    if (!fc || !s) {
      setPathPreview(null);
      return;
    }
    setPathPreviewLoading(true);
    try {
      const result = await documentsApi.previewPath({
        language: lang,
        firstCategory: fc,
        secondCategory: sc || undefined,
        slug: s,
        excludeId,
      });
      setPathPreview(result);
    } catch {
      setPathPreview(null);
    } finally {
      setPathPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void fetchPathPreview(language, firstCategory, secondCategory, slug, editingItem?.id);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [language, firstCategory, secondCategory, slug, open, fetchPathPreview, editingItem?.id]);

  const level1Options = categoryOptions.filter(
    (opt: CategoryOption) => opt.level === 1,
  );
  const level2Options = categoryOptions.filter((opt: CategoryOption) => {
    if (!firstCategory) return [];
    return opt.level === 2 && opt.parentId === firstCategory;
  });

  const executeSave = async (data: DocFormValues): Promise<void> => {
    try {
      if (editingItem) {
        await documentsApi.updateDoc(editingItem.id, {
          title: data.title,
          summary: data.summary,
          firstCategory: data.firstCategory,
          secondCategory: data.secondCategory,
          slug: data.slug,
          markdownContent: data.markdownContent,
          owner: data.owner,
        });
        toast.success('文档已更新');
      } else {
        await documentsApi.createDoc({
          title: data.title,
          summary: data.summary,
          firstCategory: data.firstCategory,
          secondCategory: data.secondCategory,
          slug: data.slug,
          markdownContent: data.markdownContent,
          owner: data.owner || '',
          sourceType: '手动创建',
          language: data.language,
        });
        toast.success('文档已保存', {
          description: '可前往发布中心发布更新',
          action: { label: '去发布', onClick: () => navigate('/publish-center') },
        });
      }
      onSuccess();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '操作失败';
      toast.error(errorMsg);
    }
  };

  const onSubmitForm = async (data: DocFormValues): Promise<void> => {
    const hasContent = data.markdownContent && data.markdownContent.trim().length > 0;
    if (!hasContent) {
      setPendingData(data);
      setShowEmptyContentConfirm(true);
      return;
    }
    await executeSave(data);
  };

  const handleConfirmSave = async (): Promise<void> => {
    setShowEmptyContentConfirm(false);
    if (pendingData) {
      await executeSave(pendingData);
      setPendingData(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingItem ? '编辑文档' : '新建文档'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmitForm)} className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">标题 *</label>
            <Input {...register('title')} placeholder="请输入标题" />
            {errors.title && (
              <p className="text-xs text-destructive mt-1">{errors.title.message}</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">摘要</label>
            <Textarea
              {...register('summary')}
              placeholder="请输入摘要"
              rows={2}
            />
          </div>

          <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
          <div>
            <label className="text-sm font-medium mb-1 block">语言版本 *</label>
            <Controller
              control={control}
              name="language"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={!!editingItem}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择语言版本" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">中文</SelectItem>
                    <SelectItem value="en">英文</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {editingItem && (
              <p className="text-xs text-muted-foreground mt-1">
                编辑模式下语言版本不可更改
              </p>
            )}
            {errors.language && (
              <p className="text-xs text-destructive mt-1">{errors.language.message}</p>
            )}
          </div>
          </CanRole>

          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <label className="text-sm font-medium mb-1 block">一级目录 *</label>
              <Controller
                control={control}
                name="firstCategory"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v: string) => {
                      field.onChange(v);
                      setValue('secondCategory', '');
                    }}
                  >
                    <SelectTrigger className="w-full">
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
                )}
              />
              {errors.firstCategory && (
                <p className="text-xs text-destructive mt-1">
                  {errors.firstCategory.message}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <label className="text-sm font-medium mb-1 block">二级目录 *</label>
              <Controller
                control={control}
                name="secondCategory"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!firstCategory}
                  >
                    <SelectTrigger className="w-full">
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
                )}
              />
              {errors.secondCategory && (
                <p className="text-xs text-destructive mt-1">
                  {errors.secondCategory.message}
                </p>
              )}
            </div>
          </div>

          <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
          <div>
            <label className="text-sm font-medium mb-1 block">帮助中心路径标识 *</label>
            <Input {...register('slug')} placeholder="如: getting-started" />
            <p className="text-xs text-muted-foreground mt-1">
              路径标识只能使用小写英文、数字和短横线
            </p>
            {errors.slug && (
              <p className="text-xs text-destructive mt-1">{errors.slug.message}</p>
            )}
          </div>
          </CanRole>

          <div className="rounded-md border bg-muted/50 p-3 flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">帮助中心访问地址预览：</span>
            {pathPreviewLoading ? (
              <span className="text-xs text-muted-foreground">加载中...</span>
            ) : pathPreview?.filePath ? (
              <>
                <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
                <span className="text-sm font-mono break-all">{pathPreview.filePath}</span>
                {pathPreview.pathExists && (
                  <p className="text-xs text-destructive font-medium">
                    该路径已被占用，请更换路径标识
                  </p>
                )}
                </CanRole>
                {pathPreview.helpCenterUrl && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">访问地址：</span>
                    <UniversalLink
                      to={pathPreview.helpCenterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary underline break-all"
                    >
                      {pathPreview.helpCenterUrl}
                    </UniversalLink>
                  </div>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">请选择目录</span>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">正文内容</label>
            <Textarea
              {...register('markdownContent')}
              placeholder="输入文档正文内容，可使用标题、列表、链接等格式"
              rows={4}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">负责人 *</label>
            <Controller
              control={control}
              name="owner"
              render={({ field }) => (
                <UserSelect
                  value={field.value || null}
                  onChange={(v: string | null) => field.onChange(v ?? '')}
                  triggerType="search"
                  placeholder="请选择负责人"
                />
              )}
            />
            {errors.owner && (
              <p className="text-xs text-destructive mt-1">{errors.owner.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting || !!pathPreview?.pathExists}>
              {isSubmitting ? '保存中...' : '保存草稿'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <AlertDialog open={showEmptyContentConfirm} onOpenChange={setShowEmptyContentConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>提示</AlertDialogTitle>
            <AlertDialogDescription>
              当前文档暂无正文，发布前需要补充正文内容。是否继续保存？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingData(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmSave()}>
              继续保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};

export default DocumentFormDialog;
