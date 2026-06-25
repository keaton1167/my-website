import React, { useEffect, useRef, useCallback } from 'react';
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
import { Badge } from '@client/src/components/ui/badge';
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
import { documentsApi, categoriesApi } from '@client/src/api';
import type { DocItem, CategoryOption } from '@shared/api.interface';

const enVersionSchema = z.object({
  title: z.string().min(1, '英文标题不能为空'),
  summary: z.string().optional(),
  firstCategory: z.string().min(1, '请选择一级目录'),
  secondCategory: z.string().min(1, '请选择二级目录'),
  slug: z.string().min(1, '帮助中心路径标识不能为空').regex(/^[a-z0-9-]+$/, '路径标识只能使用小写英文、数字和短横线'),
  markdownContent: z.string().optional(),
  owner: z.string().min(1, '请选择负责人'),
});

type EnVersionFormValues = z.infer<typeof enVersionSchema>;

interface CreateEnglishVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zhDoc: DocItem | null;
  onSuccess: () => void;
}

const CreateEnglishVersionDialog: React.FC<CreateEnglishVersionDialogProps> = ({
  open,
  onOpenChange,
  zhDoc,
  onSuccess,
}) => {
  const [categoryOptions, setCategoryOptions] = React.useState<CategoryOption[]>([]);
  const [showEmptyContentConfirm, setShowEmptyContentConfirm] = React.useState<boolean>(false);
  const [pendingData, setPendingData] = React.useState<EnVersionFormValues | null>(null);
  const [pathPreview, setPathPreview] = React.useState<{ filePath: string; helpCenterUrl: string } | null>(null);
  const [pathPreviewLoading, setPathPreviewLoading] = React.useState<boolean>(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EnVersionFormValues>({
    resolver: zodResolver(enVersionSchema),
    mode: 'onChange',
    defaultValues: {
      title: '',
      summary: '',
      firstCategory: '',
      secondCategory: '',
      slug: '',
      markdownContent: '',
      owner: '',
    },
  });

  const slug = watch('slug');

  useEffect(() => {
    if (open && zhDoc) {
      reset({
        title: '',
        summary: '',
        firstCategory: zhDoc.firstCategory,
        secondCategory: zhDoc.secondCategory,
        slug: zhDoc.slug,
        markdownContent: '',
        owner: zhDoc.owner,
      });
    } else if (open) {
      reset({
        title: '',
        summary: '',
        firstCategory: '',
        secondCategory: '',
        slug: '',
        markdownContent: '',
        owner: '',
      });
    }
  }, [open, zhDoc, reset]);

  const fetchPathPreview = useCallback(async (fc: string, sc: string, s: string) => {
    if (!fc || !s) {
      setPathPreview(null);
      return;
    }
    setPathPreviewLoading(true);
    try {
      const result = await documentsApi.previewPath({
        language: 'en',
        firstCategory: fc,
        secondCategory: sc || undefined,
        slug: s,
      });
      setPathPreview(result);
    } catch {
      setPathPreview(null);
    } finally {
      setPathPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !zhDoc) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void fetchPathPreview(zhDoc.firstCategory, zhDoc.secondCategory, slug);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [slug, open, zhDoc, fetchPathPreview]);

  const nameMap = new Map<string, string>();
  categoryOptions.forEach((opt: CategoryOption) => {
    nameMap.set(opt.id, opt.nameCn);
  });

  const executeSave = async (data: EnVersionFormValues): Promise<void> => {
    if (!zhDoc) return;
    try {
      await documentsApi.createDoc({
        title: data.title,
        summary: data.summary,
        firstCategory: data.firstCategory,
        secondCategory: data.secondCategory,
        slug: data.slug,
        markdownContent: data.markdownContent,
        owner: data.owner || '',
        sourceType: '手动创建',
        language: 'en',
        translationGroupId: zhDoc.translationGroupId ?? undefined,
      });
      toast.success('英文版本已创建');
      onSuccess();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '创建英文版本失败';
      toast.error(errorMsg);
    }
  };

  const onSubmitForm = async (data: EnVersionFormValues): Promise<void> => {
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>创建英文版本</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmitForm)} className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">原中文文档标题</label>
              <Input value={zhDoc?.title ?? ''} disabled />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">英文标题 *</label>
              <Input {...register('title')} placeholder="请输入英文标题" />
              {errors.title && (
                <p className="text-xs text-destructive mt-1">{errors.title.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">英文摘要</label>
              <Textarea
                {...register('summary')}
                placeholder="请输入英文摘要"
                rows={2}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">语言版本</label>
              <Badge variant="outline" className="text-xs">英文</Badge>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <label className="text-sm font-medium mb-1 block">一级目录</label>
                <Controller
                  control={control}
                  name="firstCategory"
                  render={({ field }) => (
                    <Select value={field.value} disabled>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="一级目录" />
                      </SelectTrigger>
                      <SelectContent>
                        {categoryOptions
                          .filter((opt: CategoryOption) => opt.level === 1)
                          .map((opt: CategoryOption) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.nameCn}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="min-w-0">
                <label className="text-sm font-medium mb-1 block">二级目录</label>
                <Controller
                  control={control}
                  name="secondCategory"
                  render={({ field }) => (
                    <Select value={field.value} disabled>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="二级目录" />
                      </SelectTrigger>
                      <SelectContent>
                        {categoryOptions
                          .filter((opt: CategoryOption) => opt.level === 2)
                          .map((opt: CategoryOption) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.nameCn}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">帮助中心路径标识</label>
              <Input {...register('slug')} placeholder="english-slug" />
              {errors.slug && (
                <p className="text-xs text-destructive mt-1">{errors.slug.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">负责人</label>
              <Controller
                control={control}
                name="owner"
                render={({ field }) => (
                  <UserSelect
                    value={field.value}
                    onChange={(v: string) => field.onChange(v)}
                  />
                )}
              />
              {errors.owner && (
                <p className="text-xs text-destructive mt-1">{errors.owner.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">正文内容</label>
              <Textarea
                {...register('markdownContent')}
                placeholder="可输入英文 Markdown 正文，也可保存为草稿后续编辑"
                rows={4}
              />
            </div>

            {pathPreviewLoading && (
              <p className="text-xs text-muted-foreground">正在生成路径预览...</p>
            )}
            {pathPreview && (
              <div className="rounded border p-3 space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">帮助中心文件路径：</span>
                  <span className="font-mono text-xs break-all">{pathPreview.filePath}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">帮助中心文档链接：</span>
                  {pathPreview.helpCenterUrl ? (
                    <UniversalLink to={pathPreview.helpCenterUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline text-xs break-all">
                      {pathPreview.helpCenterUrl}
                    </UniversalLink>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? '保存中...' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showEmptyContentConfirm} onOpenChange={(v: boolean) => { if (!v) setShowEmptyContentConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>正文内容为空</AlertDialogTitle>
            <AlertDialogDescription>
              当前正文内容为空，将以"无正文"状态保存草稿。是否继续？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSave}>继续保存</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default CreateEnglishVersionDialog;
