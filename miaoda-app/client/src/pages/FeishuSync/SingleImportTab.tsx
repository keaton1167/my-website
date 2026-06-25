import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, RotateCcw, FileDown, Save } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
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
import { UserSelect } from '@client/src/components/business-ui/user-select';
import { Streamdown } from '@client/src/components/ui/streamdown';
import { importApi, categoriesApi } from '@client/src/api';
import type { ImportFeishuRequest, ImportStatus, CategoryOption } from '@shared/api.interface';

const IMPORT_STATUS_CONFIG: Record<
  ImportStatus,
  { variant: 'secondary' | 'default' | 'destructive' | 'outline'; label: string }
> = {
  待转换: { variant: 'secondary', label: '待转换' },
  转换中: { variant: 'default', label: '转换中' },
  成功: { variant: 'outline', label: '成功' },
  失败: { variant: 'destructive', label: '失败' },
};

const feishuImportSchema = z.object({
  sourceUrl: z.string().min(1, '飞书文档链接不能为空'),
  targetFirstCategory: z.string().min(1, '请选择一级目录'),
  targetSecondCategory: z.string().optional(),
  title: z.string().min(1, '文档标题不能为空'),
  slug: z
    .string()
    .min(1, '帮助中心路径标识不能为空')
    .regex(/^[a-z0-9-]+$/, '仅允许小写字母、数字和连字符'),
  owner: z.string().min(1, '请选择负责人'),
  summary: z.string().optional(),
});

type FeishuImportFormData = z.infer<typeof feishuImportSchema>;

const SingleImportTab: React.FC = () => {
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [convertedMarkdown, setConvertedMarkdown] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isConverting, setIsConverting] = useState(false);

  const form = useForm<FeishuImportFormData>({
    resolver: zodResolver(feishuImportSchema),
    defaultValues: {
      sourceUrl: '',
      targetFirstCategory: '',
      targetSecondCategory: '',
      title: '',
      slug: '',
      summary: '',
      owner: '',
    },
  });

  const watchedFirstCategory = form.watch('targetFirstCategory');

  const firstCategoryOptions: CategoryOption[] = categoryOptions.filter(
    (opt: CategoryOption) => opt.level === 1,
  );
  const secondCategoryOptions: CategoryOption[] = categoryOptions.filter(
    (opt: CategoryOption) =>
      opt.level === 2 && opt.parentId === watchedFirstCategory,
  );

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const result = await categoriesApi.getCategoryOptions(true);
        setCategoryOptions(result.items);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '加载目录失败';
        toast.error(msg);
      }
    };
    loadCategories();
  }, []);

  useEffect(() => {
    form.setValue('targetSecondCategory', '');
  }, [watchedFirstCategory, form]);

  const onSubmit = useCallback(
    async (data: FeishuImportFormData) => {
      setIsConverting(true);
      setImportStatus(null);
      setConvertedMarkdown('');
      setErrorMessage('');

      try {
        const request: ImportFeishuRequest = {
          sourceUrl: data.sourceUrl!,
          targetFirstCategory: data.targetFirstCategory!,
          targetSecondCategory: data.targetSecondCategory ?? '',
          title: data.title!,
          slug: data.slug!,
          owner: data.owner!,
          summary: data.summary,
        };
        const result = await importApi.importFeishuDoc(request);
        setImportStatus(result.status);

        if (result.status === '成功' && result.convertedMarkdown) {
          setConvertedMarkdown(result.convertedMarkdown);
          toast.success('文档转换成功');
        } else if (result.status === '失败') {
          setErrorMessage(result.errorMessage ?? '转换失败');
          toast.error('文档转换失败');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '导入请求失败';
        setImportStatus('失败');
        setErrorMessage(msg);
        toast.error(msg);
      } finally {
        setIsConverting(false);
      }
    },
    [],
  );

  const handleReset = useCallback(() => {
    form.reset();
    setImportStatus(null);
    setConvertedMarkdown('');
    setErrorMessage('');
  }, [form]);

  const handleSaveDraft = useCallback(() => {
    toast.success('文档已保存为草稿，可在文档管理中查看');
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">单篇导入</h2>
        {importStatus && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">状态：</span>
            <Badge variant={IMPORT_STATUS_CONFIG[importStatus].variant}>
              {importStatus === '转换中' && (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              )}
              {IMPORT_STATUS_CONFIG[importStatus].label}
            </Badge>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">导入配置</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="sourceUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        飞书文档链接 <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="https://feishu.cn/docx/..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex flex-wrap gap-4">
                  <FormField
                    control={form.control}
                    name="targetFirstCategory"
                    render={({ field }) => (
                      <FormItem className="flex-1 min-w-[180px]">
                        <FormLabel>
                          目标一级目录 <span className="text-destructive">*</span>
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="请选择一级目录" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {firstCategoryOptions.map((opt: CategoryOption) => (
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

                  <FormField
                    control={form.control}
                    name="targetSecondCategory"
                    render={({ field }) => (
                      <FormItem className="flex-1 min-w-[180px]">
                        <FormLabel>目标二级目录</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="请选择二级目录" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {secondCategoryOptions.map((opt: CategoryOption) => (
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
                </div>

                <div className="flex flex-wrap gap-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem className="flex-1 min-w-[180px]">
                        <FormLabel>
                          文档标题 <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="请输入文档标题" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="slug"
                    render={({ field }) => (
                      <FormItem className="flex-1 min-w-[180px]">
                        <FormLabel>
                          帮助中心路径标识 <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="如: getting-started" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="owner"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        负责人 <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <UserSelect
                          value={field.value || null}
                          onChange={(v: string | null) => field.onChange(v ?? '')}
                          placeholder="请选择负责人"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="summary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>文档摘要</FormLabel>
                      <FormControl>
                        <Textarea placeholder="请输入文档摘要（可选）" rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={isConverting}>
                    {isConverting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        转换中...
                      </>
                    ) : (
                      <>
                        <FileDown className="mr-2 h-4 w-4" />
                        开始转换
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={importStatus !== '成功'}
                    onClick={handleSaveDraft}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    保存为草稿
                  </Button>
                  <Button type="button" variant="outline" onClick={handleReset}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重置
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Markdown 预览</CardTitle>
          </CardHeader>
          <CardContent>
            {importStatus === '失败' && errorMessage && (
              <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {errorMessage}
              </div>
            )}
            {convertedMarkdown ? (
              <div className="rounded-md border p-4 min-h-[300px]">
                <Streamdown mode="static">{convertedMarkdown}</Streamdown>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-md border border-dashed p-12 text-muted-foreground">
                {isConverting
                  ? '正在转换中，请稍候...'
                  : '转换成功后将在此预览 Markdown 内容'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SingleImportTab;
