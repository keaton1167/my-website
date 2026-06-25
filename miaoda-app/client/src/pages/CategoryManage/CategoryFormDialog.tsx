import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { categoriesApi } from '@client/src/api';
import type {
  CategoryItem,
  CategoryOption,
  CategoryDependenciesResponse,
} from '@shared/api.interface';

import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@client/src/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@client/src/components/ui/form';

// ── Zod Schema ──────────────────────────────────────────

const categoryFormSchema = z
  .object({
    nameCn: z.string().min(1, '中文名不能为空'),
    nameEn: z.string().optional(),
    slugEn: z
      .string()
      .min(1, '目录路径标识不能为空')
      .regex(/^[a-z0-9-]+$/, '目录路径标识只能使用小写英文、数字和短横线'),
    level: z.coerce.number().min(1).max(2),
    parentId: z.string().optional(),
    order: z.coerce.number().int().min(0, '排序不能为负数'),
    enabled: z.boolean(),
    description: z.string().optional(),
  })
  .refine(
    (data) => data.level !== 2 || (data.parentId && data.parentId.length > 0),
    { message: '二级目录必须选择父级目录', path: ['parentId'] },
  );

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

// ── Props ───────────────────────────────────────────────

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingItem: CategoryItem | null;
  onSuccess: () => void;
}

// ── Component ───────────────────────────────────────────

export const CategoryFormDialog: React.FC<CategoryFormDialogProps> = ({
  open,
  onOpenChange,
  editingItem,
  onSuccess,
}) => {
  const [parentOptions, setParentOptions] = useState<CategoryOption[]>([]);
  const [dependencies, setDependencies] =
    useState<CategoryDependenciesResponse | null>(null);

  const isEditing = editingItem !== null;

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      nameCn: '',
      nameEn: '',
      slugEn: '',
      level: 1,
      parentId: '',
      order: 0,
      enabled: true,
      description: '',
    },
  });

  const watchLevel = form.watch('level');
  const watchSlugEn = form.watch('slugEn');
  const watchParentId = form.watch('parentId');

  const pathPreview = useMemo((): string => {
    if (!watchSlugEn) return 'docs/...';
    if (watchLevel === 1) return `docs/${watchSlugEn}`;
    const parent = parentOptions.find(
      (opt: CategoryOption) => opt.id === watchParentId,
    );
    if (!parent) return 'docs/...';
    const parentSegment =
      parent.docusaurusPath?.replace(/^docs\//, '') ?? '';
    return `docs/${parentSegment}/${watchSlugEn}`;
  }, [watchLevel, watchSlugEn, watchParentId, parentOptions]);

  const pathChanged = useMemo((): boolean => {
    if (!editingItem) return false;
    if (watchSlugEn !== editingItem.slugEn) return true;
    if ((watchParentId || '') !== (editingItem.parentId || '')) return true;
    return false;
  }, [editingItem, watchSlugEn, watchParentId]);

  const showPathWarning =
    isEditing && dependencies?.hasDocs === true && pathChanged;

  const fetchParentOptions = useCallback(async () => {
    try {
      const data = await categoriesApi.getCategoryOptions();
      setParentOptions(data.items);
    } catch (_err: unknown) {
      // silent fallback
    }
  }, []);

  const fetchDependencies = useCallback(async (id: string) => {
    try {
      const data = await categoriesApi.checkCategoryDependencies(id);
      setDependencies(data);
    } catch (_err: unknown) {
      // silent fallback
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchParentOptions();
      if (editingItem) {
        form.reset({
          nameCn: editingItem.nameCn,
          nameEn: editingItem.nameEn || '',
          slugEn: editingItem.slugEn,
          level: editingItem.level,
          parentId: editingItem.parentId || '',
          order: editingItem.order ?? 0,
          enabled: editingItem.enabled ?? true,
          description: editingItem.description || '',
        });
        void fetchDependencies(editingItem.id);
      } else {
        form.reset({
          nameCn: '',
          nameEn: '',
          slugEn: '',
          level: 1,
          parentId: '',
          order: 0,
          enabled: true,
          description: '',
        });
        setDependencies(null);
      }
    }
  }, [open, editingItem, form, fetchParentOptions, fetchDependencies]);

  const createParentOptions = useMemo(
    () =>
      parentOptions.filter(
        (opt: CategoryOption) => opt.level === 1 && opt.enabled,
      ),
    [parentOptions],
  );

  const editParentOptions = useMemo(
    () =>
      parentOptions.filter(
        (opt: CategoryOption) =>
          opt.level === 1 &&
          (!editingItem || opt.id !== editingItem.id),
      ),
    [parentOptions, editingItem],
  );

  const levelDisabled =
    isEditing && dependencies?.hasChildren === true;

  const onSubmit = async (values: CategoryFormValues): Promise<void> => {
    try {
      if (editingItem) {
          await categoriesApi.updateCategory(editingItem.id, {
          nameCn: values.nameCn,
          nameEn: values.nameEn || undefined,
          slugEn: values.slugEn,
          level: values.level,
          parentId: values.level === 2 ? values.parentId : undefined,
          order: values.order,
          enabled: values.enabled,
          description: values.description,
        });
        toast.success('目录更新成功');
      } else {
          await categoriesApi.createCategory({
          nameCn: values.nameCn,
          nameEn: values.nameEn || values.nameCn,
          slugEn: values.slugEn,
          level: values.level,
          parentId: values.level === 2 ? values.parentId : undefined,
          order: values.order ?? 0,
          enabled: values.enabled ?? true,
          description: values.description,
        });
        toast.success('目录创建成功');
      }
      onSuccess();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '操作失败';
      toast.error(errorMsg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? '编辑目录' : '新增目录'}</DialogTitle>
          <DialogDescription>
            {isEditing ? '修改目录信息' : '填写目录信息并创建'}
          </DialogDescription>
        </DialogHeader>

        {showPathWarning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>修改路径可能影响已有帮助中心链接</span>
          </div>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="nameCn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>中文名 <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="请输入中文名" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="nameEn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>英文名</FormLabel>
                  <FormControl>
                    <Input placeholder="请输入英文名（选填）" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slugEn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>目录路径标识 <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="如: getting-started" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>级别 <span className="text-destructive">*</span></FormLabel>
                  <Select
                    value={String(field.value)}
                    onValueChange={(val: string) => {
                      const newLevel = Number(val);
                      field.onChange(newLevel);
                      if (newLevel === 1) {
                        form.setValue('parentId', '');
                      }
                    }}
                    disabled={levelDisabled}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="选择级别" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="1">一级目录</SelectItem>
                      <SelectItem value="2">二级目录</SelectItem>
                    </SelectContent>
                  </Select>
                  {levelDisabled && (
                    <p className="text-xs text-muted-foreground">
                      该目录下存在子目录，不可更改级别
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 父级目录 - 新增模式: 二级目录时显示 Select */}
            {!isEditing && watchLevel === 2 && (
              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>父级目录 <span className="text-destructive">*</span></FormLabel>
                    <Select
                      value={field.value || ''}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择父级目录" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {createParentOptions.map((opt: CategoryOption) => (
                          <SelectItem key={opt.id} value={opt.id}>
                            {opt.nameCn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* 父级目录 - 编辑模式: 一级显示"-"，二级显示 Select */}
            {isEditing && watchLevel === 1 && (
              <FormItem>
                <FormLabel>父级目录</FormLabel>
                <FormControl>
                  <Input value="-" disabled readOnly />
                </FormControl>
              </FormItem>
            )}

            {isEditing && watchLevel === 2 && (
              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>父级目录 <span className="text-destructive">*</span></FormLabel>
                    <Select
                      value={field.value || ''}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择父级目录" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {editParentOptions.map((opt: CategoryOption) => (
                          <SelectItem key={opt.id} value={opt.id}>
                            {opt.nameCn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* 排序 - 仅编辑模式 */}
            {isEditing && (
              <FormField
                control={form.control}
                name="order"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>排序</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* 状态 - 仅编辑模式 */}
            {isEditing && (
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>状态</FormLabel>
                    <Select
                      value={field.value ? 'true' : 'false'}
                      onValueChange={(val: string) =>
                        field.onChange(val === 'true')
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择状态" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="true">已启用</SelectItem>
                        <SelectItem value="false">已停用</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormItem>
              <FormLabel>帮助中心路径预览</FormLabel>
              <FormControl>
                <Input value={pathPreview} disabled readOnly />
              </FormControl>
            </FormItem>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>描述</FormLabel>
                  <FormControl>
                    <Textarea placeholder="可选，目录描述" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit">{isEditing ? '保存' : '创建'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
