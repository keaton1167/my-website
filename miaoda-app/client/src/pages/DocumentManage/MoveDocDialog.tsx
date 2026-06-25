import React, { useEffect } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { documentsApi, categoriesApi } from '@client/src/api';
import type { DocItem, CategoryOption } from '@shared/api.interface';

const moveFormSchema = z.object({
  firstCategory: z.string().min(1, '请选择目标一级目录'),
  secondCategory: z.string().optional(),
});

type MoveFormValues = z.infer<typeof moveFormSchema>;

interface MoveDocDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: DocItem | null;
  onSuccess: () => void;
}

const MoveDocDialog: React.FC<MoveDocDialogProps> = ({
  open,
  onOpenChange,
  doc,
  onSuccess,
}) => {
  const [categoryOptions, setCategoryOptions] = React.useState<CategoryOption[]>([]);

  useEffect(() => {
    if (open) {
      void categoriesApi.getCategoryOptions(true).then((res) => {
        setCategoryOptions(res.items);
      });
    }
  }, [open]);

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MoveFormValues>({
    resolver: zodResolver(moveFormSchema),
    defaultValues: {
      firstCategory: '',
      secondCategory: '',
    },
  });

  const firstCategory = watch('firstCategory');

  useEffect(() => {
    if (open && doc) {
      reset({
        firstCategory: doc.firstCategory,
        secondCategory: doc.secondCategory,
      });
    }
  }, [open, doc, reset]);

  const level1Options = categoryOptions.filter(
    (opt: CategoryOption) => opt.level === 1,
  );
  const level2Options = categoryOptions.filter((opt: CategoryOption) => {
    if (!firstCategory) return opt.level === 2;
    return opt.level === 2 && opt.parentId === firstCategory;
  });

  const onSubmitForm = async (data: MoveFormValues): Promise<void> => {
    if (!doc) return;
    try {
      await documentsApi.moveDoc(doc.id, {
        firstCategory: data.firstCategory,
        secondCategory: data.secondCategory,
      });
      toast.success('文档已移动');
      onSuccess();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '移动失败';
      toast.error(errorMsg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>移动文档目录</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmitForm)} className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">目标一级目录 *</label>
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
                  <SelectTrigger>
                    <SelectValue placeholder="请选择" />
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

          <div>
            <label className="text-sm font-medium mb-1 block">目标二级目录</label>
            <Controller
              control={control}
              name="secondCategory"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="请选择" />
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
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '提交中...' : '确认移动'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default MoveDocDialog;
