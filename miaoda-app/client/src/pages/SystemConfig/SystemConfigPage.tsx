import React, { useState, useEffect, useCallback } from 'react';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import { Save, RotateCcw, Loader2, ShieldCheck, Server, Globe, Search } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@client/src/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/src/components/ui/select';
import { Checkbox } from '@client/src/components/ui/checkbox';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { toast } from 'sonner';
import { getSystemConfig, updateSystemConfig } from '@client/src/api/system-config';
import ConnectionCheckSection from './ConnectionCheckSection';
import type { SystemConfigResponse, UpdateSystemConfigRequest, Language, PublishScope, StagingDeployMode } from '@shared/api.interface';

// ========== Types ==========

type ConfigState = SystemConfigResponse & Record<string, unknown>;

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  type: 'input' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
  description?: string;
}

// ========== Constants ==========

const REPO_FIELDS: FieldDef[] = [
  {
    key: 'repoPlatform',
    label: '仓库平台',
    type: 'select',
    options: [
      { value: 'GitHub', label: 'GitHub' },
      { value: '公司 Git 仓库', label: '公司 Git 仓库' },
    ],
  },
  { key: 'repoUrl', label: '仓库地址', placeholder: 'https://github.com/org/repo', type: 'input' },
  { key: 'defaultBranch', label: '默认分支', placeholder: 'main', type: 'input' },
  { key: 'workBranchPrefix', label: '工作分支前缀', placeholder: 'docs/', type: 'input' },
  { key: 'docsDir', label: '帮助中心文档目录', placeholder: 'docs', type: 'input' },
  { key: 'docusaurusProjectDir', label: 'Docusaurus 项目根目录', placeholder: '/home/gm/workspace/code', type: 'input' },
];

const SERVICE_FIELDS: FieldDef[] = [
  { key: 'backendApiBaseUrl', label: '后端 API 地址', placeholder: 'https://api.example.com', type: 'input' },
  { key: 'stagingUrl', label: '测试环境地址', placeholder: 'https://staging.example.com', type: 'input' },
  { key: 'productionUrl', label: '正式环境地址', placeholder: 'https://www.example.com', type: 'input' },
  {
    key: 'deployMode',
    label: '部署方式',
    type: 'select',
    options: [
      { value: 'GitHub Pages', label: 'GitHub Pages' },
      { value: '公司服务器', label: '公司服务器' },
    ],
  },
];

const STAGING_DEPLOY_FIELDS: FieldDef[] = [
  { key: 'buildOutputDir', label: '构建产物目录', placeholder: 'build', type: 'input', description: 'Docusaurus 构建输出目录名，默认为 build' },
  {
    key: 'stagingDeployMode',
    label: '测试环境部署方式',
    type: 'select',
    options: [
      { value: 'local_static_dir', label: '本机静态目录 (local_static_dir)' },
      { value: 'server_static_dir', label: '公司服务器目录 (server_static_dir)' },
      { value: 'object_storage', label: '对象存储 (object_storage)' },
    ],
  },
  { key: 'stagingDeployDir', label: '测试环境部署目录', placeholder: '/home/workspace/staging-deploy', type: 'input', description: '仅 local_static_dir 模式生效，/tmp/ 下目录仅用于临时验证' },
  { key: 'autoBuildBeforeDeploy', label: '发布前自动构建', type: 'checkbox', description: '发布到测试环境前自动执行 npm run build' },
  { key: 'requireBuildCheck', label: '要求构建检查成功', type: 'checkbox', description: '要求最近一次构建检查成功才能发布（自动构建时可覆盖）' },
];

const THIRD_PARTY_ITEMS: {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  { key: 'chatbaseEnabled', label: 'Chatbase', description: 'AI 智能客服能力', icon: Search },
  { key: 'algoliaEnabled', label: 'Algolia', description: '全文搜索能力', icon: Globe },
  { key: 'feishuSyncEnabled', label: '飞书文档同步', description: '飞书文档同步能力', icon: Server },
];

const LANGUAGE_FIELD_KEYS: string[] = [
  'defaultLanguage',
  'enabledLanguages',
  'zhLangCode',
  'enLangCode',
  'defaultDocsDir',
  'enI18nDocsDir',
  'defaultPublishScope',
];

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: '英文' },
];

const PUBLISH_SCOPE_OPTIONS: { value: PublishScope; label: string }[] = [
  { value: 'all', label: '全部语言' },
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: '英文' },
];

// ========== Validation ==========

function isValidUrl(value: string): boolean {
  return /^https?:\/\/.+/.test(value);
}

const PATH_SEGMENT_RE = /^[a-zA-Z0-9_\-]+(\/[a-zA-Z0-9_\-]+)*$/;

function isValidPathSegment(value: string): boolean {
  return PATH_SEGMENT_RE.test(value);
}

function validateRepoFields(config: ConfigState): string | null {
  if (!config.repoPlatform) return '仓库平台不能为空';
  if (!config.repoUrl?.trim()) return '仓库地址不能为空';
  if (!isValidUrl(config.repoUrl)) return '仓库地址必须以 http:// 或 https:// 开头';
  if (!config.defaultBranch?.trim()) return '默认分支不能为空';
  if ((config.defaultBranch?.length ?? 0) > 50) return '默认分支不能超过 50 个字符';
  if (!config.workBranchPrefix?.trim()) return '工作分支前缀不能为空';
  if ((config.workBranchPrefix?.length ?? 0) > 50) return '工作分支前缀不能超过 50 个字符';
  if (!config.docsDir?.trim()) return '帮助中心文档目录不能为空';
  if ((config.docsDir?.length ?? 0) > 100) return '帮助中心文档目录不能超过 100 个字符';
  if (!isValidPathSegment(config.docsDir)) return '帮助中心文档目录仅允许字母、数字、短横线、下划线和斜杠（如 docs/help）';
  if (!config.docusaurusProjectDir?.trim()) return 'Docusaurus 项目根目录不能为空';
  if ((config.docusaurusProjectDir?.length ?? 0) > 255) return 'Docusaurus 项目根目录不能超过 255 个字符';
  if (!config.docusaurusProjectDir?.startsWith('/')) return 'Docusaurus 项目根目录必须为绝对路径（以 / 开头）';
  return null;
}

function validateServiceFields(config: ConfigState): string | null {
  if (!config.backendApiBaseUrl?.trim()) return '后端 API 地址不能为空';
  if (!isValidUrl(config.backendApiBaseUrl)) return '后端 API 地址必须以 http:// 或 https:// 开头';
  if (!config.stagingUrl?.trim()) return '测试环境地址不能为空';
  if (!isValidUrl(config.stagingUrl)) return '测试环境地址必须以 http:// 或 https:// 开头';
  if (!config.productionUrl?.trim()) return '正式环境地址不能为空';
  if (!isValidUrl(config.productionUrl)) return '正式环境地址必须以 http:// 或 https:// 开头';
  if (!config.deployMode) return '部署方式不能为空';
  return null;
}

function validateStagingDeployFields(config: ConfigState): string | null {
  if (!config.buildOutputDir?.trim()) return '构建产物目录不能为空';
  if (!config.stagingDeployMode) return '测试环境部署方式不能为空';
  if (config.stagingDeployMode === 'local_static_dir') {
    if (!config.stagingDeployDir?.trim()) return '测试环境部署目录不能为空';
    if (!(config.stagingDeployDir as string).startsWith('/')) return '测试环境部署目录必须为绝对路径';
  }
  return null;
}

function validateLanguageFields(config: ConfigState): string | null {
  if (!config.defaultLanguage) return '默认语言不能为空';
  const enabled = config.enabledLanguages as Language[];
  if (!Array.isArray(enabled) || enabled.length === 0) return '请至少启用一种语言';
  if (!config.zhLangCode?.trim()) return '中文语言标识不能为空';
  if (!config.enLangCode?.trim()) return '英文语言标识不能为空';
  if (!config.defaultDocsDir?.trim()) return '默认文档目录不能为空';
  if (!isValidPathSegment(config.defaultDocsDir as string)) return '默认文档目录仅允许字母、数字、短横线、下划线和斜杠';
  if (!config.enI18nDocsDir?.trim()) return '英文 i18n 文档目录不能为空';
  if (!isValidPathSegment(config.enI18nDocsDir as string)) return '英文 i18n 文档目录仅允许字母、数字、短横线、下划线和斜杠';
  if (!config.defaultPublishScope) return '默认发布范围不能为空';
  return null;
}

// ========== Form Field Renderer ==========

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (val: string) => void;
}) {
  if (field.type === 'select') {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{field.label}</label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <div className="flex items-center gap-3 py-2">
        <Checkbox
          checked={value === 'true' || value === true as unknown as string}
          onCheckedChange={(checked) => onChange(String(checked))}
        />
        <div>
          <label className="text-sm font-medium text-foreground">{field.label}</label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      </div>
    );
  }

  return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{field.label}</label>
        <Input
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
      </div>
  );
}

// ========== Config Form Section ==========

function ConfigFormSection({
  title,
  fields,
  config,
  onSave,
  onReset,
  saving,
  hasChanges,
  onFieldChange,
}: {
  title: string;
  fields: FieldDef[];
  config: ConfigState;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  hasChanges: boolean;
  onFieldChange: (key: string, value: string) => void;
}) {
  return (
    <Card className="border shadow-none">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fields.map((field) => (
            <ConfigField
              key={field.key}
              field={field}
              value={(config[field.key] as string) ?? ''}
              onChange={(val: string) => onFieldChange(field.key, val)}
            />
          ))}
        </div>
        <div className="flex items-center gap-3 mt-6 pt-4 border-t">
          <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            保存
          </Button>
          </CanRole>
          {hasChanges && (
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              重置
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ========== Third Party Section ==========

function ThirdPartySection({ config }: { config: ConfigState }) {
  return (
    <Card className="border shadow-none">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">第三方能力</CardTitle>
        <CardDescription className="text-sm">
          以下为第三方服务启用状态，如需调整请联系管理员
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {THIRD_PARTY_ITEMS.map((item) => {
            const enabled = config[item.key] as boolean;
            const Icon = item.icon;
            return (
              <div key={item.key} className="flex items-center justify-between py-3 border-b last:border-b-0">
                <div className="flex items-center gap-3">
                  <div className="rounded-md p-2 bg-accent text-accent-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    enabled
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-gray-50 text-gray-500 border border-gray-200'
                  }`}
                >
                  {enabled ? '已启用' : '未启用'}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ========== Language Config Section ==========

function LanguageConfigSection({
  config,
  onSave,
  onReset,
  saving,
  hasChanges,
  onFieldChange,
  enabledLanguages,
  onEnabledLanguagesChange,
}: {
  config: ConfigState;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  hasChanges: boolean;
  onFieldChange: (key: string, value: string) => void;
  enabledLanguages: Language[];
  onEnabledLanguagesChange: (langs: Language[]) => void;
}) {
  const toggleLanguage = (lang: Language) => {
    const next = enabledLanguages.includes(lang)
      ? enabledLanguages.filter((l: Language) => l !== lang)
      : [...enabledLanguages, lang];
    onEnabledLanguagesChange(next);
  };

  return (
    <Card className="border shadow-none">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">语言配置</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">默认语言</label>
              <Select
                value={config.defaultLanguage as string}
                onValueChange={(v: string) => onFieldChange('defaultLanguage', v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">默认发布范围</label>
              <Select
                value={config.defaultPublishScope as string}
                onValueChange={(v: string) => onFieldChange('defaultPublishScope', v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PUBLISH_SCOPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">中文语言标识</label>
              <Input
                value={(config.zhLangCode as string) ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('zhLangCode', e.target.value)}
                placeholder="zh-CN"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">英文语言标识</label>
              <Input
                value={(config.enLangCode as string) ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('enLangCode', e.target.value)}
                placeholder="en"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">默认文档目录</label>
              <Input
                value={(config.defaultDocsDir as string) ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('defaultDocsDir', e.target.value)}
                placeholder="docs"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">英文 i18n 文档目录</label>
              <Input
                value={(config.enI18nDocsDir as string) ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onFieldChange('enI18nDocsDir', e.target.value)}
                placeholder="i18n/en/docusaurus-plugin-content-docs/current"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">启用语言</label>
            <div className="flex items-center gap-6">
              {LANGUAGE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={enabledLanguages.includes(opt.value)}
                    onCheckedChange={() => toggleLanguage(opt.value)}
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6 pt-4 border-t">
          <CanRole roles={['super_admin', 'publish_admin']} fallback={null}>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            保存
          </Button>
          </CanRole>
          {hasChanges && (
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              重置
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ========== Main Page ==========

const SystemConfigPage: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [originalConfig, setOriginalConfig] = useState<ConfigState | null>(null);
  const [savingRepo, setSavingRepo] = useState<boolean>(false);
  const [savingService, setSavingService] = useState<boolean>(false);
  const [savingLanguage, setSavingLanguage] = useState<boolean>(false);
  const [savingStagingDeploy, setSavingStagingDeploy] = useState<boolean>(false);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSystemConfig();
      const state = data as ConfigState;
      setConfig(state);
      setOriginalConfig(state);
    } catch {
      toast.error('获取系统配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const updateField = useCallback((key: string, value: string) => {
    setConfig((prev) => prev ? { ...prev, [key]: value } : prev);
  }, []);

  const updateConfigFields = useCallback((updates: Record<string, unknown>) => {
    setConfig((prev) => prev ? { ...prev, ...updates } : prev);
  }, []);

  const hasRepoChanges = config && originalConfig
    ? REPO_FIELDS.some((f) => config[f.key] !== originalConfig[f.key])
    : false;

  const hasServiceChanges = config && originalConfig
    ? SERVICE_FIELDS.some((f) => config[f.key] !== originalConfig[f.key])
    : false;

  const hasStagingDeployChanges = config && originalConfig
    ? STAGING_DEPLOY_FIELDS.some((f) => String(config[f.key]) !== String(originalConfig[f.key]))
    : false;

  const enabledLanguages: Language[] = Array.isArray(config?.enabledLanguages)
    ? (config!.enabledLanguages as Language[])
    : ['zh-CN', 'en'];

  const originalEnabledLanguages: Language[] = Array.isArray(originalConfig?.enabledLanguages)
    ? (originalConfig!.enabledLanguages as Language[])
    : ['zh-CN', 'en'];

  const hasLanguageChanges = config && originalConfig
    ? LANGUAGE_FIELD_KEYS.some((key) => {
        if (key === 'enabledLanguages') {
          return JSON.stringify(enabledLanguages.sort()) !== JSON.stringify(originalEnabledLanguages.sort());
        }
        return config[key] !== originalConfig[key];
      })
    : false;

  const handleSaveRepo = useCallback(async () => {
    if (!config) return;
    const validationError = validateRepoFields(config);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSavingRepo(true);
    try {
      const payload: UpdateSystemConfigRequest = {};
      for (const f of REPO_FIELDS) {
        const val = config[f.key];
        if (val !== originalConfig?.[f.key]) {
          (payload as Record<string, unknown>)[f.key] = val;
        }
      }
      await updateSystemConfig(payload);
      setOriginalConfig((prev) => prev ? { ...prev, ...payload } : prev);
      toast.success('仓库配置已保存');
    } catch {
      toast.error('保存仓库配置失败');
    } finally {
      setSavingRepo(false);
    }
  }, [config, originalConfig]);

  const handleSaveService = useCallback(async () => {
    if (!config) return;
    const validationError = validateServiceFields(config);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSavingService(true);
    try {
      const payload: UpdateSystemConfigRequest = {};
      for (const f of SERVICE_FIELDS) {
        const val = config[f.key];
        if (val !== originalConfig?.[f.key]) {
          (payload as Record<string, unknown>)[f.key] = val;
        }
      }
      await updateSystemConfig(payload);
      setOriginalConfig((prev) => prev ? { ...prev, ...payload } : prev);
      toast.success('服务配置已保存');
    } catch {
      toast.error('保存服务配置失败');
    } finally {
      setSavingService(false);
    }
  }, [config, originalConfig]);

  const handleResetRepo = useCallback(() => {
    if (!originalConfig) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const updated = { ...prev };
      for (const f of REPO_FIELDS) {
        updated[f.key] = originalConfig[f.key];
      }
      return updated;
    });
  }, [originalConfig]);

  const handleResetService = useCallback(() => {
    if (!originalConfig) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const updated = { ...prev };
      for (const f of SERVICE_FIELDS) {
        updated[f.key] = originalConfig[f.key];
      }
      return updated;
    });
  }, [originalConfig]);

  const handleSaveStagingDeploy = useCallback(async () => {
    if (!config) return;
    const validationError = validateStagingDeployFields(config);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSavingStagingDeploy(true);
    try {
      const payload: UpdateSystemConfigRequest = {};
      for (const f of STAGING_DEPLOY_FIELDS) {
        const val = config[f.key];
        if (f.type === 'checkbox') {
          const boolVal = String(val) === 'true';
          (payload as Record<string, unknown>)[f.key] = boolVal;
        } else {
          (payload as Record<string, unknown>)[f.key] = val;
        }
      }
      await updateSystemConfig(payload);
      setOriginalConfig((prev) => prev ? { ...prev, ...payload } : prev);
      toast.success('测试环境部署配置已保存');
    } catch {
      toast.error('保存测试环境部署配置失败');
    } finally {
      setSavingStagingDeploy(false);
    }
  }, [config, originalConfig]);

  const handleResetStagingDeploy = useCallback(() => {
    if (!originalConfig) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const updated = { ...prev };
      for (const f of STAGING_DEPLOY_FIELDS) {
        updated[f.key] = originalConfig[f.key];
      }
      return updated;
    });
  }, [originalConfig]);

  const handleSaveLanguage = useCallback(async () => {
    if (!config) return;
    const validationError = validateLanguageFields(config);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSavingLanguage(true);
    try {
      const payload: UpdateSystemConfigRequest = {};
      for (const key of LANGUAGE_FIELD_KEYS) {
        if (key === 'enabledLanguages') {
          if (JSON.stringify(enabledLanguages.sort()) !== JSON.stringify(originalEnabledLanguages.sort())) {
            payload.enabledLanguages = enabledLanguages;
          }
        } else {
          const val = config[key];
          if (val !== originalConfig?.[key]) {
            (payload as Record<string, unknown>)[key] = val;
          }
        }
      }
      await updateSystemConfig(payload);
      setOriginalConfig((prev) => prev ? { ...prev, ...payload } : prev);
      toast.success('语言配置已保存');
    } catch {
      toast.error('保存语言配置失败');
    } finally {
      setSavingLanguage(false);
    }
  }, [config, originalConfig, enabledLanguages, originalEnabledLanguages]);

  const handleResetLanguage = useCallback(() => {
    if (!originalConfig) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const updated = { ...prev };
      for (const key of LANGUAGE_FIELD_KEYS) {
        updated[key] = originalConfig[key];
      }
      return updated;
    });
  }, [originalConfig]);

  const handleEnabledLanguagesChange = useCallback((langs: Language[]) => {
    setConfig((prev) => prev ? { ...prev, enabledLanguages: langs } : prev);
  }, []);

  if (loading) {
    return (
      <div className="max-w-4xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        {Array.from({ length: 4 }).map((_, i: number) => (
          <Card key={i} className="border shadow-none">
            <CardHeader><Skeleton className="h-5 w-24" /></CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">加载配置失败，请刷新页面重试</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-foreground">系统配置</h1>
        <p className="text-sm text-muted-foreground">
          用于维护帮助中心仓库、后端服务、测试环境、正式环境和第三方能力的基础配置。
        </p>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-blue-800">安全提示</p>
          <p className="text-xs text-blue-600">
            {config.sensitiveFieldsTip}。GitHub Token、SSH Key、App Secret 等敏感密钥不在本页面管理。
          </p>
        </div>
      </div>

      <ConfigFormSection
        title="仓库配置"
        fields={REPO_FIELDS}
        config={config}
        onSave={handleSaveRepo}
        onReset={handleResetRepo}
        saving={savingRepo}
        hasChanges={!!hasRepoChanges}
        onFieldChange={updateField}
      />

      <ConfigFormSection
        title="服务配置"
        fields={SERVICE_FIELDS}
        config={config}
        onSave={handleSaveService}
        onReset={handleResetService}
        saving={savingService}
        hasChanges={!!hasServiceChanges}
        onFieldChange={(key, value) => {
          if (STAGING_DEPLOY_FIELDS.some((f) => f.type === 'checkbox')) {
            updateField(key, value);
          } else {
            updateField(key, value);
          }
        }}
      />

      <ConfigFormSection
        title="测试环境部署配置"
        fields={STAGING_DEPLOY_FIELDS}
        config={{
          ...config,
          autoBuildBeforeDeploy: String(config.autoBuildBeforeDeploy),
          requireBuildCheck: String(config.requireBuildCheck),
        } as unknown as ConfigState}
        onSave={handleSaveStagingDeploy}
        onReset={handleResetStagingDeploy}
        saving={savingStagingDeploy}
        hasChanges={!!hasStagingDeployChanges}
        onFieldChange={(key, value) => {
          const field = STAGING_DEPLOY_FIELDS.find((f) => f.key === key);
          if (field?.type === 'checkbox') {
            updateConfigFields({ [key]: value === 'true' });
          } else {
            updateField(key, value);
          }
        }}
      />

      <LanguageConfigSection
        config={config}
        onSave={handleSaveLanguage}
        onReset={handleResetLanguage}
        saving={savingLanguage}
        hasChanges={!!hasLanguageChanges}
        onFieldChange={updateField}
        enabledLanguages={enabledLanguages}
        onEnabledLanguagesChange={handleEnabledLanguagesChange}
      />

      <ConnectionCheckSection
        config={config as unknown as Record<string, unknown>}
        onUpdateConfig={updateConfigFields}
      />

      <ThirdPartySection config={config} />
    </div>
  );
};

export default SystemConfigPage;
