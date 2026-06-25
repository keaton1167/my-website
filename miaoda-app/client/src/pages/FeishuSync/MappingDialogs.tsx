import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, XCircle, Clock, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Badge } from '@client/src/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@client/src/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Switch } from '@client/src/components/ui/switch';
import { UserSelect } from '@client/src/components/business-ui/user-select';
import { UserDisplay } from '@client/src/components/business-ui/user-display';
import { Streamdown } from '@client/src/components/ui/streamdown';
import { feishuMappingsApi, documentsApi, categoriesApi } from '@client/src/api';
import type {
  FeishuDocMapping,
  CreateFeishuMappingRequest,
  UpdateFeishuMappingRequest,
  CreateDocRequest,
  SyncMode,
  SyncStatus,
  CategoryOption,
  Language,
  FeishuErrorCategory,
} from '@shared/api.interface';

const mappingFormSchema = z.object({
  feishuDocUrl: z.string().min(1, '飞书文档链接不能为空'),
  feishuDocTitle: z.string().min(1, '飞书文档标题不能为空'),
  targetFirstCategory: z.string().min(1, '请选择一级目录'),
  targetSecondCategory: z.string().min(1, '请选择二级目录'),
  helpCenterTitle: z.string().min(1, '帮助中心文档标题不能为空'),
  helpCenterSlug: z
    .string()
    .min(1, '帮助中心路径标识不能为空')
    .regex(/^[a-z0-9-]+$/, '路径标识只能使用小写英文、数字和短横线'),
  owner: z.string().min(1, '请选择负责人'),
  language: z.enum(['zh-CN', 'en'] as const),
  syncMode: z.enum(['手动同步', '定时同步', '事件触发同步'] as const),
  enabled: z.boolean(),
  syncAfterSave: z.boolean(),
});

type MappingFormData = z.infer<typeof mappingFormSchema>;

const LANGUAGE_LABELS: Record<string, string> = { 'zh-CN': '中文', en: '英文' };

function buildPathForLang(parts: string[], lang: string): string {
  const joined = parts.join('/');
  return lang === 'en'
    ? `i18n/en/docusaurus-plugin-content-docs/current/${joined}.mdx`
    : `docs/${joined}.mdx`;
}

function buildUrlForLang(parts: string[], lang: string): string {
  const joined = parts.join('/');
  return lang === 'en'
    ? `https://help.example.com/en/${joined}`
    : `https://help.example.com/${joined}`;
}

interface MappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryOptions: CategoryOption[];
  onSuccess: () => void;
}

const CreateMappingDialog: React.FC<MappingDialogProps> = ({
  open,
  onOpenChange,
  categoryOptions,
  onSuccess,
}) => {
  const [submitting, setSubmitting] = React.useState(false);
  const [linkExisting, setLinkExisting] = React.useState(false);
  const [existingDocs, setExistingDocs] = React.useState<{ id: string; title: string; language: string; translationGroupId: string | null }[]>([]);
  const [selectedDocId, setSelectedDocId] = React.useState('');
  const form = useForm<MappingFormData>({
    resolver: zodResolver(mappingFormSchema),
    defaultValues: {
      feishuDocUrl: '',
      feishuDocTitle: '',
      targetFirstCategory: '',
      targetSecondCategory: '',
      helpCenterTitle: '',
      helpCenterSlug: '',
      language: 'zh-CN' as const,
      owner: '',
      syncMode: '手动同步',
      enabled: true,
      syncAfterSave: false,
    },
  });

  const watchedFirstCategory = form.watch('targetFirstCategory');
  const watchedSecondCategory = form.watch('targetSecondCategory');
  const watchedSlug = form.watch('helpCenterSlug');
  const watchedSyncAfterSave = form.watch('syncAfterSave');

  const firstOpts = categoryOptions.filter((o: CategoryOption) => o.level === 1);
  const secondOpts = categoryOptions.filter(
    (o: CategoryOption) => o.level === 2 && o.parentId === watchedFirstCategory,
  );

  const firstCatSlug = firstOpts.find((o: CategoryOption) => o.id === watchedFirstCategory)?.slugEn ?? '';
  const secondCatSlug = secondOpts.find((o: CategoryOption) => o.id === watchedSecondCategory)?.slugEn ?? '';

  const watchedLanguage = form.watch('language');
  const pathParts = [firstCatSlug, secondCatSlug, watchedSlug].filter(Boolean);
  const previewFilePath = pathParts.length === 3 ? buildPathForLang(pathParts, watchedLanguage) : '';
  const previewLink = pathParts.length === 3 ? buildUrlForLang(pathParts, watchedLanguage) : '';

  React.useEffect(() => {
    if (!linkExisting || !open) { setExistingDocs([]); setSelectedDocId(''); return; }
    documentsApi.getDocList({ language: watchedLanguage, page: 1, pageSize: 200 })
      .then((res) => {
        setExistingDocs(res.items.map((d) => ({ id: d.id, title: d.title, language: d.language, translationGroupId: d.translationGroupId })));
      })
      .catch(() => setExistingDocs([]));
  }, [linkExisting, watchedLanguage, open]);

  React.useEffect(() => {
    form.setValue('targetSecondCategory', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedFirstCategory]);

  const onSubmit = async (data: MappingFormData) => {
    setSubmitting(true);
    try {
      const req: CreateFeishuMappingRequest = {
        feishuDocUrl: data.feishuDocUrl,
        feishuDocTitle: data.feishuDocTitle,
        targetFirstCategory: data.targetFirstCategory,
        targetSecondCategory: data.targetSecondCategory,
        helpCenterTitle: data.helpCenterTitle,
        helpCenterSlug: data.helpCenterSlug,
        owner: data.owner,
        syncMode: data.syncMode as SyncMode,
        enabled: data.enabled,
        syncAfterSave: data.syncAfterSave,
        language: data.language as Language,
        targetDocumentId: linkExisting && selectedDocId ? selectedDocId : undefined,
      };
      const mappingResult = await feishuMappingsApi.createMapping(req);

      if (!linkExisting || !selectedDocId) {
        try {
          const docReq: CreateDocRequest = {
            title: data.helpCenterTitle,
            firstCategory: data.targetFirstCategory,
            secondCategory: data.targetSecondCategory,
            slug: data.helpCenterSlug,
            owner: data.owner,
            sourceType: '飞书同步',
            sourceUrl: data.feishuDocUrl,
            language: data.language as Language,
          };
          const docResult = await documentsApi.createDoc(docReq);
          if (docResult.id && mappingResult.id) {
            await feishuMappingsApi.updateMapping({
              id: mappingResult.id,
              targetDocumentId: docResult.id,
            });
          }
        } catch (docErr: unknown) {
          const docMsg = docErr instanceof Error ? docErr.message : '未知错误';
          toast.error(`映射已创建，但帮助中心文档创建失败：${docMsg}`);
          onSuccess();
          setSubmitting(false);
          return;
        }
      }

      toast.success('映射已创建');
      onSuccess();
      onOpenChange(false);
      form.reset();
      setLinkExisting(false);
      setSelectedDocId('');

      if (data.syncAfterSave && mappingResult.id) {
        setTimeout(() => {
          feishuMappingsApi.syncOne(mappingResult.id)
            .then(() => onSuccess())
            .catch(() => {});
        }, 500);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增映射</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="feishuDocUrl" render={({ field }) => (
              <FormItem>
                <FormLabel>飞书文档链接 <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input placeholder="https://feishu.cn/docx/..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="feishuDocTitle" render={({ field }) => (
              <FormItem>
                <FormLabel>飞书文档标题 <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input placeholder="请输入飞书文档标题" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex gap-4">
              <FormField control={form.control} name="targetFirstCategory" render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>目标一级目录 <span className="text-destructive">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {firstOpts.map((o: CategoryOption) => <SelectItem key={o.id} value={o.id}>{o.nameCn}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="targetSecondCategory" render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>目标二级目录 <span className="text-destructive">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={!watchedFirstCategory}>
                    <FormControl><SelectTrigger><SelectValue placeholder={watchedFirstCategory ? '请选择' : '请先选择一级目录'} /></SelectTrigger></FormControl>
                    <SelectContent>
                      {secondOpts.map((o: CategoryOption) => <SelectItem key={o.id} value={o.id}>{o.nameCn}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="helpCenterTitle" render={({ field }) => (
              <FormItem>
                <FormLabel>帮助中心文档标题 <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input placeholder="请输入文档标题" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="helpCenterSlug" render={({ field }) => (
              <FormItem>
                <FormLabel>帮助中心路径标识 <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input placeholder="如: getting-started" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="language" render={({ field }) => (
              <FormItem>
                <FormLabel>语言版本 <span className="text-destructive">*</span></FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="zh-CN">中文</SelectItem>
                    <SelectItem value="en">英文</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            {previewFilePath && (
              <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
                <div className="text-muted-foreground">
                  <span className="font-medium">文件路径：</span>
                  <code className="ml-1">{previewFilePath}</code>
                </div>
                <div className="text-muted-foreground">
                  <span className="font-medium">文档链接：</span>
                  <code className="ml-1">{previewLink}</code>
                </div>
              </div>
            )}
            <FormField control={form.control} name="syncMode" render={({ field }) => (
              <FormItem>
                <FormLabel>同步方式 <span className="text-destructive">*</span></FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="手动同步">手动同步</SelectItem>
                    <SelectItem value="定时同步">定时同步</SelectItem>
                    <SelectItem value="事件触发同步">事件触发同步</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="owner" render={({ field }) => (
              <FormItem>
                <FormLabel>负责人 <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <UserSelect value={field.value || null} onChange={(v: string | null) => field.onChange(v ?? '')} placeholder="请选择负责人" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <FormLabel>关联已有文档</FormLabel>
                <Switch checked={linkExisting} onCheckedChange={(v: boolean) => { setLinkExisting(v); if (!v) setSelectedDocId(''); }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {linkExisting
                  ? '将映射关联到帮助中心中已有的文档，复用其翻译组。'
                  : '关闭时将创建新的帮助中心文档和翻译组。'}
              </p>
              {linkExisting && (
                <Select value={selectedDocId} onValueChange={(v: string) => setSelectedDocId(v)}>
                  <SelectTrigger><SelectValue placeholder="请选择要关联的文档" /></SelectTrigger>
                  <SelectContent>
                    {existingDocs.length === 0 && <SelectItem value="__empty__" disabled>暂无可选文档</SelectItem>}
                    {existingDocs.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.title}（{d.language === 'en' ? '英文' : '中文'}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <FormField control={form.control} name="enabled" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <FormLabel>是否启用</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="syncAfterSave" render={({ field }) => (
              <FormItem className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <FormLabel>保存后立即同步</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </div>
                <p className="text-xs text-muted-foreground">
                  {field.value
                    ? '保存后将立即拉取飞书文档内容，转换为 Markdown，并写入帮助中心文档。'
                    : '保存后仅创建映射关系，不会立即转换内容。可后续在列表中手动同步。'}
                </p>
              </FormItem>
            )} />
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">初始同步状态</span>
              <Badge variant={watchedSyncAfterSave ? 'default' : 'secondary'}>
                {watchedSyncAfterSave ? '同步中' : '未同步'}
              </Badge>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

interface EditMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapping: FeishuDocMapping | null;
  categoryOptions: CategoryOption[];
  onSuccess: () => void;
  onSave: (id: string, updates: Partial<FeishuDocMapping>, pathChangeLogs?: string[]) => void;
  currentSyncStatus: SyncStatus;
}

const EditMappingDialog: React.FC<EditMappingDialogProps> = ({
  open,
  onOpenChange,
  mapping,
  categoryOptions,
  onSuccess,
  onSave,
  currentSyncStatus,
}) => {
  const [submitting, setSubmitting] = React.useState(false);
  const [originalValues, setOriginalValues] = React.useState({
    targetFirstCategory: '',
    targetSecondCategory: '',
    helpCenterSlug: '',
  });
  const form = useForm<MappingFormData>({
    resolver: zodResolver(mappingFormSchema),
    defaultValues: {
      feishuDocUrl: '',
      feishuDocTitle: '',
      targetFirstCategory: '',
      targetSecondCategory: '',
      helpCenterTitle: '',
      helpCenterSlug: '',
      owner: '',
      syncMode: '手动同步',
      enabled: true,
      syncAfterSave: false,
    },
  });

  React.useEffect(() => {
    if (mapping && open) {
      form.reset({
        feishuDocUrl: mapping.feishuDocUrl,
        feishuDocTitle: mapping.feishuDocTitle,
        targetFirstCategory: mapping.targetFirstCategory,
        targetSecondCategory: mapping.targetSecondCategory,
        helpCenterTitle: mapping.helpCenterTitle,
        helpCenterSlug: mapping.helpCenterSlug,
        language: (mapping.language || 'zh-CN') as Language,
        owner: mapping.owner,
        syncMode: mapping.syncMode as SyncMode,
        enabled: mapping.enabled,
        syncAfterSave: false,
      });
      setOriginalValues({
        targetFirstCategory: mapping.targetFirstCategory,
        targetSecondCategory: mapping.targetSecondCategory,
        helpCenterSlug: mapping.helpCenterSlug,
      });
    }
  }, [mapping, open, form]);

  const watchedFirstCategory = form.watch('targetFirstCategory');
  const watchedSecondCategory = form.watch('targetSecondCategory');
  const watchedSlug = form.watch('helpCenterSlug');
  const firstOpts = categoryOptions.filter((o: CategoryOption) => o.level === 1);
  const secondOpts = categoryOptions.filter(
    (o: CategoryOption) => o.level === 2 && o.parentId === watchedFirstCategory,
  );

  const firstCatSlug = firstOpts.find((o: CategoryOption) => o.id === watchedFirstCategory)?.slugEn ?? '';
  const secondCatSlug = secondOpts.find((o: CategoryOption) => o.id === watchedSecondCategory)?.slugEn ?? '';
  const editLanguage = mapping?.language || 'zh-CN';
  const pathParts = [firstCatSlug, secondCatSlug, watchedSlug].filter(Boolean);
  const previewFilePath = pathParts.length === 3 ? buildPathForLang(pathParts, editLanguage) : '';
  const previewLink = pathParts.length === 3 ? buildUrlForLang(pathParts, editLanguage) : '';

  const isPathChanged =
    watchedFirstCategory !== originalValues.targetFirstCategory ||
    watchedSecondCategory !== originalValues.targetSecondCategory ||
    watchedSlug !== originalValues.helpCenterSlug;

  React.useEffect(() => {
    form.setValue('targetSecondCategory', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedFirstCategory]);

  const onSubmit = (data: MappingFormData) => {
    if (!mapping) return;
    setSubmitting(true);

    const newFirstCatSlug = firstOpts.find((o: CategoryOption) => o.id === data.targetFirstCategory)?.slugEn ?? '';
    const newSecondCatSlug = secondOpts.find((o: CategoryOption) => o.id === data.targetSecondCategory)?.slugEn ?? '';
    const newPathParts = [newFirstCatSlug, newSecondCatSlug, data.helpCenterSlug].filter(Boolean);
    const newFilePath = newPathParts.length === 3 ? buildPathForLang(newPathParts, editLanguage) : '';
    const newUrl = newPathParts.length === 3 ? buildUrlForLang(newPathParts, editLanguage) : '';

    const updates: Partial<FeishuDocMapping> = {
      feishuDocTitle: data.feishuDocTitle,
      targetFirstCategory: data.targetFirstCategory,
      targetSecondCategory: data.targetSecondCategory,
      helpCenterTitle: data.helpCenterTitle,
      helpCenterSlug: data.helpCenterSlug,
      helpCenterFilePath: newFilePath,
      helpCenterUrl: newUrl,
      owner: data.owner,
      syncMode: data.syncMode as SyncMode,
      enabled: data.enabled,
    };

    let pathChangeLogs: string[] | undefined;
    if (isPathChanged) {
      if (currentSyncStatus !== '已暂停') {
        updates.syncStatus = '未同步';
      }
      pathChangeLogs = ['映射路径已修改，需重新同步'];
    }

    onSave(mapping.id, updates, pathChangeLogs);
    toast.success('映射已更新');
    onOpenChange(false);
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑映射</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="feishuDocUrl" render={({ field }) => (
              <FormItem>
                <FormLabel>飞书文档链接</FormLabel>
                <FormControl><Input {...field} disabled /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="feishuDocTitle" render={({ field }) => (
              <FormItem>
                <FormLabel>飞书文档标题</FormLabel>
                <FormControl><Input {...field} disabled /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex gap-4">
              <FormField control={form.control} name="targetFirstCategory" render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>目标一级目录 <span className="text-destructive">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {firstOpts.map((o: CategoryOption) => <SelectItem key={o.id} value={o.id}>{o.nameCn}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="targetSecondCategory" render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>目标二级目录 <span className="text-destructive">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={!watchedFirstCategory}>
                    <FormControl><SelectTrigger><SelectValue placeholder={watchedFirstCategory ? '请选择' : '请先选择一级目录'} /></SelectTrigger></FormControl>
                    <SelectContent>
                      {secondOpts.map((o: CategoryOption) => <SelectItem key={o.id} value={o.id}>{o.nameCn}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="helpCenterTitle" render={({ field }) => (
              <FormItem>
                <FormLabel>帮助中心文档标题 <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="helpCenterSlug" render={({ field }) => (
              <FormItem>
                <FormLabel>帮助中心路径标识 <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input placeholder="如: getting-started" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormItem>
              <FormLabel>语言版本</FormLabel>
              <FormControl>
                <Input value={LANGUAGE_LABELS[editLanguage] ?? '中文'} disabled readOnly />
              </FormControl>
            </FormItem>
            {previewFilePath && (
              <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
                <div className="text-muted-foreground">
                  <span className="font-medium">文件路径预览：</span>
                  <code className="ml-1">{previewFilePath}</code>
                </div>
                <div className="text-muted-foreground">
                  <span className="font-medium">文档链接预览：</span>
                  <code className="ml-1">{previewLink}</code>
                </div>
              </div>
            )}
            {isPathChanged && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>修改目录或路径标识可能影响已有帮助中心链接，请确认是否继续。</span>
              </div>
            )}
            <FormField control={form.control} name="syncMode" render={({ field }) => (
              <FormItem>
                <FormLabel>同步方式</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="手动同步">手动同步</SelectItem>
                    <SelectItem value="定时同步">定时同步</SelectItem>
                    <SelectItem value="事件触发同步">事件触发同步</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="owner" render={({ field }) => (
              <FormItem>
                <FormLabel>负责人 <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <UserSelect value={field.value || null} onChange={(v: string | null) => field.onChange(v ?? '')} placeholder="请选择负责人" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="enabled" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <FormLabel>是否启用</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

interface PreviewMarkdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  markdown: string;
  errorMessage?: string;
  errorCategory?: FeishuErrorCategory;
}

const ERROR_GUIDANCE: Record<FeishuErrorCategory, { label: string; items: string[] }> = {
  credential_missing: {
    label: '飞书应用凭证未配置',
    items: [
      '请联系管理员配置环境变量 FEISHU_APP_ID 和 FEISHU_APP_SECRET',
      '配置完成后需重启应用服务',
    ],
  },
  app_permission: {
    label: '应用权限不足',
    items: [
      '前往飞书开放平台，确认以下权限已开通并发布版本：',
      '  - docx:document:readonly（查看新版文档）',
      '  - wiki:wiki:readonly（查看知识库）',
      '权限开通后需在「版本管理与发布」中发布新版本才能生效',
    ],
  },
  wiki_permission: {
    label: '知识库权限不足',
    items: [
      '当前文档链接为知识库 (/wiki/) 链接，应用需要知识库阅读权限',
      '请将飞书应用添加为知识库的可阅读成员：',
      '  1. 在飞书中创建一个群组',
      '  2. 将飞书应用以「机器人」身份加入该群组',
      '  3. 在知识库设置中，将该群组添加为成员，角色选「可阅读」',
      '同时确认已开通 wiki:wiki:readonly 权限并已发布版本',
    ],
  },
  doc_permission: {
    label: '文档无访问权限',
    items: [
      '请将文档分享给飞书应用，或检查文档是否存在',
      '确认已开通 docx:document:readonly 权限并已发布版本',
      '如文档设置了密级保护，请确保应用有对应密级的访问权限',
    ],
  },
  doc_security: {
    label: '文档密级限制',
    items: [
      '该文档设置了密级保护，当前应用无权访问',
      '请联系文档所有者降低密级或授权应用访问',
    ],
  },
  link_parse_error: {
    label: '链接解析失败',
    items: [
      '请检查飞书文档链接格式是否正确',
      '支持的格式：https://xxx.feishu.cn/docx/... 或 https://xxx.feishu.cn/wiki/...',
      '仅支持 docx 类型文档，不支持表格、多维表格等其他类型',
    ],
  },
  unknown: {
    label: '未知错误',
    items: [],
  },
};

const CATEGORY_BADGE_STYLE: Record<FeishuErrorCategory, string> = {
  credential_missing: 'bg-warning/10 text-warning border-warning/20',
  app_permission: 'bg-destructive/10 text-destructive border-destructive/20',
  wiki_permission: 'bg-destructive/10 text-destructive border-destructive/20',
  doc_permission: 'bg-destructive/10 text-destructive border-destructive/20',
  doc_security: 'bg-warning/10 text-warning border-warning/20',
  link_parse_error: 'bg-muted text-muted-foreground border-border',
  unknown: 'bg-muted text-muted-foreground border-border',
};

const PreviewMarkdownDialog: React.FC<PreviewMarkdownDialogProps> = ({
  open,
  onOpenChange,
  title,
  markdown,
  errorMessage,
  errorCategory,
}) => {
  const hasError = !!errorMessage;
  const category = errorCategory ?? 'unknown';
  const guidance = ERROR_GUIDANCE[category] ?? ERROR_GUIDANCE.unknown;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>预览 Markdown - {title}</DialogTitle>
        </DialogHeader>
        {hasError ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              <span className="font-medium text-destructive">预览失败</span>
              <Badge variant="outline" className={CATEGORY_BADGE_STYLE[category]}>
                {guidance.label}
              </Badge>
            </div>
            {guidance.items.length > 0 && (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-destructive mb-2">请检查以下事项：</p>
                <ul className="space-y-1.5">
                  {guidance.items.map((item: string, i: number) => (
                    <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-destructive/50 shrink-0" />
                      <span className="whitespace-pre-wrap">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-md border border-border/60 bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">原始错误信息</p>
              <p className="text-xs text-muted-foreground font-mono break-words">{errorMessage}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-md border p-4 min-h-[200px]">
            <Streamdown mode="static">{markdown || '暂无内容'}</Streamdown>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

interface SyncLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapping: FeishuDocMapping | null;
  onResync: (id: string) => void;
  syncSteps?: string[];
  errorReason?: string;
}

const SUCCESS_STEPS = [
  '开始同步',
  '已拉取飞书文档内容',
  '已转换为 Markdown',
  '已生成帮助中心文件路径',
  '已写入帮助中心文档',
  '已生成目录文件',
  '已写入 Markdown 文件',
  '同步成功',
];

const formatLogDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const STATUS_LABEL: Record<string, string> = {
  未同步: '未同步',
  同步中: '同步中',
  同步成功: '同步成功',
  同步失败: '同步失败',
  已暂停: '已暂停',
};

const STATUS_STYLE: Record<string, string> = {
  未同步: 'bg-muted text-muted-foreground border-border',
  同步中: 'bg-primary/10 text-primary border-primary/20',
  同步成功: 'bg-success/10 text-success border-success/20',
  同步失败: 'bg-destructive/10 text-destructive border-destructive/20',
  已暂停: 'bg-warning/10 text-warning border-warning/20',
};

const SyncLogDialog: React.FC<SyncLogDialogProps> = ({
  open,
  onOpenChange,
  mapping,
  onResync,
  syncSteps,
  errorReason,
}) => {
  const status = mapping?.syncStatus ?? '未同步';
  const failSteps = [
    '开始同步',
    '参数校验失败：缺少飞书文档链接',
    '同步失败',
  ];

  const renderTimeline = () => {
    if (status === '未同步') {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Clock className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">该映射尚未执行同步，暂无日志。</p>
        </div>
      );
    }
    if (status === '同步中') {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mb-3 h-10 w-10 animate-spin opacity-40" />
          <p className="text-sm">同步任务正在执行中，请稍后刷新查看结果。</p>
        </div>
      );
    }
    if (status === '已暂停') {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Clock className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">该映射已暂停同步，暂无新的同步任务。</p>
        </div>
      );
    }
    const steps = syncSteps ?? (status === '同步失败' ? failSteps : SUCCESS_STEPS);
    const isSuccess = status === '同步成功';
    return (
      <div className="relative pl-6 space-y-0">
        {steps.map((step: string, i: number) => {
          const isLast = i === steps.length - 1;
          const isFailStep = step === '同步失败' || step.startsWith('参数校验失败');
          const iconColor = isFailStep ? 'text-destructive' : isLast && isSuccess ? 'text-success' : 'text-primary';
          const Icon = isFailStep ? XCircle : isSuccess && isLast ? CheckCircle2 : RefreshCw;
          return (
            <div key={i} className="relative flex items-start gap-3 pb-4 last:pb-0">
              {!isLast && (
                <div className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-border" />
              )}
              <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${iconColor}`} />
              <span className={`text-sm leading-6 ${isLast ? 'font-medium' : ''} ${isFailStep ? 'text-destructive font-medium' : isLast && isSuccess ? 'text-success' : 'text-foreground'}`}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>同步日志 - {mapping?.helpCenterTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            <div>
              <span className="text-muted-foreground">飞书文档标题</span>
              <p className="mt-0.5 font-medium truncate">{mapping?.feishuDocTitle || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">帮助中心文档标题</span>
              <p className="mt-0.5 font-medium truncate">{mapping?.helpCenterTitle || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">同步方式</span>
              <p className="mt-0.5">{mapping?.syncMode || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">当前同步状态</span>
              <p className="mt-0.5">
                <Badge variant="outline" className={STATUS_STYLE[status]}>
                  {STATUS_LABEL[status]}
                </Badge>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">上次同步时间</span>
              <p className="mt-0.5">{formatLogDate(mapping?.lastSyncAt ?? '')}</p>
            </div>
            <div>
              <span className="text-muted-foreground">上次同步人</span>
              <p className="mt-0.5">{mapping?.lastSyncBy ? <UserDisplay value={[mapping.lastSyncBy]} size="small" /> : '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">负责人</span>
              <p className="mt-0.5">{mapping?.owner ? <UserDisplay value={[mapping.owner]} size="small" /> : '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">语言版本</span>
              <p className="mt-0.5">
                <Badge variant="outline" className={mapping?.language === 'en' ? 'bg-success/10 text-success border-success/20' : 'bg-primary/10 text-primary border-primary/20'}>
                  {LANGUAGE_LABELS[mapping?.language ?? 'zh-CN'] ?? '中文'}
                </Badge>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">翻译组 ID</span>
              <p className="mt-0.5 font-mono text-xs truncate" title={mapping?.translationGroupId || '-'}>
                {mapping?.translationGroupId ? `${mapping.translationGroupId.slice(0, 8)}...` : '-'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">翻译组状态</span>
              <p className="mt-0.5">
                {mapping?.translationStatus ? (
                  <Badge variant="outline" className={
                    mapping.translationStatus === '中英文完整' ? 'bg-success/10 text-success border-success/20' :
                    mapping.translationStatus === '英文待更新' ? 'bg-warning/10 text-warning border-warning/20' :
                    mapping.translationStatus === '仅英文' ? 'bg-success/10 text-success border-success/20' :
                    'bg-primary/10 text-primary border-primary/20'
                  }>
                    {mapping.translationStatus}
                  </Badge>
                ) : '-'}
              </p>
            </div>
          </div>
          {status === '同步失败' && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span className="font-medium">失败原因：</span>{errorReason || '缺少飞书文档链接'}
            </div>
          )}
          <div>
            <p className="mb-3 text-sm font-medium text-muted-foreground">同步步骤</p>
            {renderTimeline()}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button
            disabled={status === '同步中'}
            onClick={() => { if (mapping) onResync(mapping.id); }}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            重新同步
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface DeleteMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapping: FeishuDocMapping | null;
  onSuccess: () => void;
}

const DeleteMappingDialog: React.FC<DeleteMappingDialogProps> = ({
  open,
  onOpenChange,
  mapping,
  onSuccess,
}) => {
  const [deleting, setDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (!mapping) return;
    setDeleting(true);
    try {
      await feishuMappingsApi.deleteMapping(mapping.id);
      toast.success('映射已删除');
      onSuccess();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          确定要删除映射「{mapping?.helpCenterTitle}」吗？此操作不可撤销。
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export {
  CreateMappingDialog,
  EditMappingDialog,
  PreviewMarkdownDialog,
  SyncLogDialog,
  DeleteMappingDialog,
};
