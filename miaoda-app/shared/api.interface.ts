// ========== Common Types ==========

export type Language = 'zh-CN' | 'en';

// ========== Dashboard ==========

export interface DashboardStatistics {
  totalDocs: number;
  draftCount: number;
  pendingReviewCount: number;
  pendingPublishCount: number;
  publishedCount: number;
  noContentCount: number;
  failedImportCount: number;
}

export interface RecentImportTask {
  id: string;
  title: string;
  sourceUrl: string;
  status: string;
  createdAt: string;
  createdBy: string;
}

export interface RecentPublishTask {
  id: string;
  taskName: string;
  taskType: string;
  environment: string;
  status: string;
  createdAt: string;
  operator: string;
}

export interface RecentUpdatedDoc {
  id: string;
  title: string;
  firstCategory: string;
  publishStatus: string;
  updatedAt: string;
  owner: string;
}

// ========== Documents ==========

export type ContentStatus = '有正文' | '无正文' | '待补充' | '转换失败';
export type PublishStatus = '草稿' | '待审核' | '待发布' | '已发布' | '已归档';
export type SourceType = '手动创建' | '飞书导入' | '飞书同步';
export type TranslationStatus = '仅中文' | '仅英文' | '中英文完整' | '英文待更新';

export interface DocItem {
  id: string;
  title: string;
  summary: string;
  firstCategory: string;
  secondCategory: string;
  slug: string;
  filePath: string;
  helpCenterUrl: string;
  language: Language;
  translationGroupId: string | null;
  contentStatus: ContentStatus;
  publishStatus: PublishStatus;
  owner: string;
  lastPublisher: string;
  wordCount: number;
  sourceType: SourceType;
  sourceUrl: string;
  updatedAt: string;
  publishedAt: string;
  translationStatus?: TranslationStatus;
}

export interface DocDetailResponse extends DocItem {
  markdownContent?: string;
  relatedZhDoc: DocItem | null;
  relatedEnDoc: DocItem | null;
}

export interface DocStatistics {
  totalDocs: number;
  draftCount: number;
  noContentCount: number;
  pendingReviewCount: number;
  pendingPublishCount: number;
  publishedCount: number;
  failedImportCount: number;
  resourceErrorCount: number;
}

export type ResourceStatus = '未扫描' | '正常' | '异常';

export interface DocListParams {
  firstCategory?: string;
  secondCategory?: string;
  publishStatus?: PublishStatus;
  contentStatus?: ContentStatus;
  language?: Language;
  owner?: string;
  keyword?: string;
  translationStatus?: TranslationStatus;
  page?: number;
  pageSize?: number;
}

export interface DocListResponse {
  items: DocItem[];
  total: number;
}

export interface CreateDocRequest {
  title: string;
  summary?: string;
  firstCategory: string;
  secondCategory: string;
  slug: string;
  language: Language;
  markdownContent?: string;
  owner: string;
  sourceType: SourceType;
  sourceUrl?: string;
  translationGroupId?: string;
}

export interface UpdateDocRequest {
  title?: string;
  summary?: string;
  firstCategory?: string;
  secondCategory?: string;
  slug?: string;
  markdownContent?: string;
  owner?: string;
  publishStatus?: PublishStatus;
}

export interface PreviewPathParams {
  language: Language;
  firstCategory: string;
  secondCategory?: string;
  slug: string;
  excludeId?: string;
}

export interface PreviewPathResponse {
  filePath: string;
  helpCenterUrl: string;
  pathExists: boolean;
}

export interface MoveDocRequest {
  firstCategory: string;
  secondCategory?: string;
}

export interface BatchActionRequest {
  ids: string[];
  firstCategory?: string;
  secondCategory?: string;
}

export interface BatchActionResponse {
  successCount: number;
  failCount: number;
  skippedCount: number;
  errorMessages: string[];
}

// ========== Categories ==========

export interface CategoryItem {
  id: string;
  parentId: string;
  parentName?: string;
  level: number;
  nameCn: string;
  nameEn: string;
  slugEn: string;
  docusaurusPath: string;
  order: number;
  description: string;
  enabled: boolean;
  createdAt: string;
}

export interface CategoryOption {
  id: string;
  nameCn: string;
  nameEn: string;
  level: number;
  parentId: string;
  docusaurusPath?: string;
  slugEn?: string;
  enabled: boolean;
}

export interface CategoryListParams {
  page?: number;
  pageSize?: number;
}

export interface CategoryListResponse {
  items: CategoryItem[];
  total: number;
}

export interface CreateCategoryRequest {
  parentId?: string;
  level: number;
  nameCn: string;
  nameEn: string;
  slugEn: string;
  order: number;
  description?: string;
  enabled: boolean;
}

export interface UpdateCategoryRequest {
  nameCn?: string;
  nameEn?: string;
  slugEn?: string;
  level?: number;
  parentId?: string;
  order?: number;
  enabled?: boolean;
  description?: string;
}

export interface CategoryDependenciesResponse {
  hasChildren: boolean;
  hasDocs: boolean;
  childCount: number;
  docCount: number;
}

export interface ToggleCategoryStatusRequest {
  enabled: boolean;
}

export interface UpdateCategoryOrderRequest {
  order: number;
}

// ========== Import ==========

export type ImportStatus = '待转换' | '转换中' | '成功' | '失败';

export interface ImportFeishuRequest {
  sourceUrl: string;
  targetFirstCategory: string;
  targetSecondCategory: string;
  title: string;
  slug: string;
  owner: string;
  summary?: string;
}

export interface ImportFeishuResponse {
  taskId: string;
  status: ImportStatus;
  convertedMarkdown?: string;
  errorMessage?: string;
}

export interface ImportTaskItem {
  id: string;
  sourceType: string;
  sourceUrl: string;
  targetCategory: string;
  targetDocId: string;
  status: ImportStatus;
  convertedMarkdown: string;
  errorMessage: string;
  createdBy: string;
  createdAt: string;
  finishedAt: string;
}

// ========== Feishu Doc Mappings ==========

export type SyncMode = '手动同步' | '定时同步' | '事件触发同步';
export type SyncStatus = '未同步' | '同步中' | '同步成功' | '同步失败' | '已暂停';

export interface FeishuDocMapping {
  id: string;
  feishuDocTitle: string;
  feishuDocUrl: string;
  feishuDocToken: string;
  targetFirstCategory: string;
  targetSecondCategory: string;
  helpCenterTitle: string;
  helpCenterSlug: string;
  helpCenterFilePath: string;
  helpCenterUrl: string;
  language: Language;
  syncMode: SyncMode;
  syncStatus: SyncStatus;
  lastSyncAt: string;
  lastSyncBy: string;
  owner: string;
  enabled: boolean;
  translationGroupId: string;
  targetDocumentId: string;
  translationStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeishuMappingListParams {
  targetFirstCategory?: string;
  targetSecondCategory?: string;
  syncMode?: SyncMode;
  syncStatus?: SyncStatus;
  language?: Language;
  owner?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface FeishuMappingListResponse {
  items: FeishuDocMapping[];
  total: number;
}

export interface FeishuMappingStatistics {
  totalCount: number;
  syncSuccessCount: number;
  syncFailedCount: number;
  pausedCount: number;
  todaySyncCount: number;
}

export interface CreateFeishuMappingRequest {
  feishuDocUrl: string;
  feishuDocTitle?: string;
  feishuDocToken?: string;
  targetFirstCategory: string;
  targetSecondCategory?: string;
  helpCenterTitle: string;
  helpCenterSlug: string;
  language: Language;
  owner: string;
  syncMode: SyncMode;
  enabled?: boolean;
  syncAfterSave?: boolean;
  targetDocumentId?: string;
}

export interface UpdateFeishuMappingRequest {
  feishuDocTitle?: string;
  targetFirstCategory?: string;
  targetSecondCategory?: string;
  helpCenterTitle?: string;
  helpCenterSlug?: string;
  owner?: string;
  syncMode?: SyncMode;
  enabled?: boolean;
  syncStatus?: string;
  language?: Language;
  targetDocumentId?: string;
}

export interface FeishuSyncLogItem {
  id: string;
  mappingId: string;
  syncType: string;
  status: string;
  convertedMarkdown: string;
  errorMessage: string;
  buildCheckStatus: string;
  commitId: string;
  createdBy: string;
  createdAt: string;
  finishedAt: string;
  language?: Language;
  feishuDocTitle?: string;
  helpCenterTitle?: string;
  helpCenterFilePath?: string;
}

export interface FeishuSyncLogListResponse {
  items: FeishuSyncLogItem[];
  total: number;
}

export interface BatchSyncRequest {
  ids: string[];
}

export interface BatchCreateFeishuMappingRequest {
  items: CreateFeishuMappingRequest[];
}

export interface BatchCreateFeishuMappingResponse {
  ids: string[];
  total: number;
}

export interface PreviewMarkdownRequest {
  id: string;
}

export type FeishuErrorCategory =
  | 'credential_missing'
  | 'app_permission'
  | 'wiki_permission'
  | 'doc_permission'
  | 'doc_security'
  | 'link_parse_error'
  | 'unknown';

export interface PreviewMarkdownResponse {
  success: boolean;
  markdown: string;
  title: string;
  errorMessage?: string;
  errorCategory?: FeishuErrorCategory;
}

export interface DrivePermissionCheckItem {
  ok: boolean;
  message: string;
  apiCode?: number;
  suggestion?: string;
}

export interface DrivePermissionDebugInfo {
  endpoint: string;
  tokenType: string;
  httpStatus?: number;
  responseHeaders?: Record<string, string>;
  diagnosis?: string;
}

export interface DrivePermissionCheckResponse {
  credential: DrivePermissionCheckItem;
  docRead: DrivePermissionCheckItem;
  resourceDownload: DrivePermissionCheckItem & {
    debugInfo?: DrivePermissionDebugInfo;
    imageResult?: DrivePermissionCheckItem;
    attachmentResult?: DrivePermissionCheckItem;
  };
}

export interface BlockDiagnosticItem {
  blockId: string;
  blockType: number;
  blockTypeName: string;
  hasFile: boolean;
  hasFileView: boolean;
  hasView: boolean;
  hasDrive: boolean;
  hasImage: boolean;
  tokenSourceField: string;
  tokenFieldName: string;
  maskedToken: string;
  fileName: string;
  extension: string;
  downloadMediasResult: { httpStatus: number; ok: boolean; detail: string };
  downloadFilesResult: { httpStatus: number; ok: boolean; detail: string };
}

export interface BlockDiagnosticResponse {
  docToken: string;
  blocks: BlockDiagnosticItem[];
  conclusion: string;
}

export interface RetryResourcesResponse {
  success: boolean;
  imagesRetried: number;
  imagesSuccess: number;
  attachmentsRetried: number;
  attachmentsSuccess: number;
  errorMessage?: string;
}

export interface BuildCheckRequest {
  scope?: PublishScope;
}

export interface BuildCheckResponse {
  success: boolean;
  taskId: string;
  message?: string;
}

export interface BuildCheckLogResponse {
  buildLog: string;
  success: boolean;
  errorMessage?: string;
}

export interface GitCommitRequest {
  scope?: PublishScope;
  mappingId?: string;
}

export interface GitCommitResponse {
  success: boolean;
  taskId: string;
  message?: string;
}

// ========== Publish ==========

export type TaskType = '构建检查' | '测试环境发布' | '正式环境发布' | '回滚申请' | 'Git提交' | '发布到网站' | '草稿预览' | '构建产物包';

export type PrMergeStatus = 'none' | 'pending' | 'merged' | 'failed';
export type DeploySubStatus = 'none' | 'pending' | 'success' | 'failure' | 'timeout';
export type SecurityCheckResult = 'none' | 'passed' | 'failed';
export type DeployEnvironment = '测试环境' | '正式环境' | '预览环境';
export type TaskStatus = '待执行' | '执行中' | '成功' | '失败' | '已取消';

export type PublishScope = 'all' | 'zh-CN' | 'en';

export type BuildScope = 'publishedOnly' | 'releaseCandidate';

export interface PublishTaskItem {
  id: string;
  taskName: string;
  taskType: TaskType;
  environment: DeployEnvironment;
  publishScope: PublishScope;
  status: TaskStatus;
  operator: string;
  relatedDocs: string[];
  buildLog: string;
  deployLog: string;
  errorMessage: string;
  createdAt: string;
  finishedAt: string;
  prUrl?: string;
  prNumber?: number;
  prCreatedAt?: string;
  mergeStatus?: PrMergeStatus;
  prMergedAt?: string;
  mergeCommitSha?: string;
  deployStatus?: DeploySubStatus;
  workflowRunId?: string;
  deployUrl?: string;
  deployedAt?: string;
  securityCheckResult?: SecurityCheckResult;
  securityCheckErrors?: string;
  deployErrorMessage?: string;
  downloadUrl?: string;
  zipSize?: number;
  docCount?: number;
}

export interface PublishTaskListParams {
  taskType?: TaskType;
  environment?: DeployEnvironment;
  publishScope?: PublishScope;
  status?: TaskStatus;
  operator?: string;
  page?: number;
  pageSize?: number;
}

export interface PublishTaskListResponse {
  items: PublishTaskItem[];
  total: number;
}

export interface TaskLogsResponse {
  buildLog?: string;
  deployLog?: string;
  errorMessage?: string;
}

export interface PublishStatsResponse {
  total: number;
  buildCheckCount: number;
  stagingDeployCount: number;
  productionDeployCount: number;
  websitePublishCount: number;
  failedCount: number;
}

export interface WebsitePublishRequest {
  scope?: PublishScope;
  previewOnly?: boolean;
  buildScope?: 'publishedOnly' | 'releaseCandidate';
  forceConfig?: {
    url: string;
    baseUrl: string;
  };
}

export interface WebsitePublishResponse {
  success: boolean;
  taskId: string;
  message?: string;
}

export interface PipelineStepInfo {
  status: string;
  branchName?: string;
  commitHash?: string;
  prUrl?: string;
  prNumber?: number;
  result?: string;
  errors?: string[];
  mergeCommitSha?: string;
  mergedAt?: string;
  workflowRunId?: string;
  deployUrl?: string;
  actionsUrl?: string;
}

export interface PublishPipelineDetail {
  taskId: string;
  status: TaskStatus;
  errorMessage?: string;
  pipeline: {
    build: PipelineStepInfo;
    gitPush: PipelineStepInfo;
    prCreate: PipelineStepInfo;
    securityCheck: PipelineStepInfo;
    merge: PipelineStepInfo;
    deploy: PipelineStepInfo;
  };
}

export interface CreateRollbackRequest {
  environment: DeployEnvironment;
  versionTaskId: string;
  reason: string;
  publishScope?: PublishScope;
}

export interface RollbackVersionItem {
  versionId: string;
  sourceTaskName: string;
  commitHash: string;
  deployedAt: string;
  backupDir: string;
  fileCount: number;
  totalSize: string;
}

export interface RollbackVersionsResponse {
  items: RollbackVersionItem[];
}

// ========== System Config ==========

export type ConnectionStatus = '未检测' | '正常' | '异常';
export type ConnectionType = 'git' | 'backendApi' | 'staging' | 'production' | 'server';
export type RepoPlatform = 'GitHub' | '公司 Git 仓库';
export type DeployMode = 'GitHub Pages' | '公司服务器';
export type StagingDeployMode = 'local_static_dir' | 'server_static_dir' | 'object_storage';
export type ProductionDeployMode = 'local_static_dir' | 'server_static_dir' | 'object_storage';

export interface SystemConfigResponse {
  repoPlatform: RepoPlatform;
  repoUrl: string;
  defaultBranch: string;
  workBranchPrefix: string;
  docsDir: string;
  docusaurusProjectDir: string;
  defaultLanguage: Language;
  enabledLanguages: Language[];
  zhLangCode: string;
  enLangCode: string;
  defaultDocsDir: string;
  enI18nDocsDir: string;
  defaultPublishScope: PublishScope;
  backendApiBaseUrl: string;
  stagingUrl: string;
  productionUrl: string;
  deployMode: DeployMode;
  gitConnectionStatus: ConnectionStatus;
  backendApiConnectionStatus: ConnectionStatus;
  stagingConnectionStatus: ConnectionStatus;
  productionConnectionStatus: ConnectionStatus;
  serverConnectionStatus: ConnectionStatus;
  gitLastCheckedAt?: string;
  backendApiLastCheckedAt?: string;
  stagingLastCheckedAt?: string;
  productionLastCheckedAt?: string;
  serverLastCheckedAt?: string;
  chatbaseEnabled: boolean;
  algoliaEnabled: boolean;
  feishuSyncEnabled: boolean;
  buildOutputDir: string;
  stagingDeployMode: StagingDeployMode;
  stagingDeployDir: string;
  autoBuildBeforeDeploy: boolean;
  requireBuildCheck: boolean;
  productionDeployMode: ProductionDeployMode;
  productionDeployDir: string;
  requireStagingSuccessBeforeProduction: boolean;
  requireBuildCheckBeforeProduction: boolean;
  autoBuildBeforeProductionDeploy: boolean;
  sensitiveFieldsTip: string;
}

export interface UpdateSystemConfigRequest {
  repoPlatform?: RepoPlatform;
  repoUrl?: string;
  defaultBranch?: string;
  workBranchPrefix?: string;
  docsDir?: string;
  docusaurusProjectDir?: string;
  defaultLanguage?: Language;
  enabledLanguages?: Language[];
  zhLangCode?: string;
  enLangCode?: string;
  defaultDocsDir?: string;
  enI18nDocsDir?: string;
  defaultPublishScope?: PublishScope;
  backendApiBaseUrl?: string;
  stagingUrl?: string;
  productionUrl?: string;
  deployMode?: DeployMode;
  buildOutputDir?: string;
  stagingDeployMode?: StagingDeployMode;
  stagingDeployDir?: string;
  autoBuildBeforeDeploy?: boolean;
  requireBuildCheck?: boolean;
  productionDeployMode?: ProductionDeployMode;
  productionDeployDir?: string;
  requireStagingSuccessBeforeProduction?: boolean;
  requireBuildCheckBeforeProduction?: boolean;
  autoBuildBeforeProductionDeploy?: boolean;
}

export interface CheckConnectionRequest {
  type: ConnectionType;
}

export interface CheckConnectionResponse {
  success: boolean;
  status: ConnectionStatus;
  message?: string;
  lastCheckedAt: string;
}

// ========== Task Queue ==========

export type TaskQueueType =
  | 'feishu_sync'
  | 'feishu_batch_sync'
  | 'auto_sync'
  | 'publish_staging'
  | 'publish_production'
  | 'rollback'
  | 'import';

export type TaskQueueStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface TaskQueueRecord {
  id: string;
  taskType: TaskQueueType;
  title: string;
  status: TaskQueueStatus;
  priority: number;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  logs: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  parentTaskId: string | null;
  refType: string | null;
  refId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskQueueListParams {
  taskType?: TaskQueueType;
  status?: TaskQueueStatus;
  page?: number;
  pageSize?: number;
}

export interface TaskQueueListResponse {
  items: TaskQueueRecord[];
  total: number;
}

export interface EnqueueRequest {
  taskType: TaskQueueType;
  title: string;
  payload: Record<string, unknown>;
  priority?: number;
  parentTaskId?: string;
  refType?: string;
  refId?: string;
  maxRetries?: number;
}

export interface EnqueueResponse {
  id: string;
}

// ========== Common ==========

export interface SuccessResponse {
  success: boolean;
}

export interface CreateResponse {
  id: string;
}

export interface StagingPreCheckResponse {
  ok: boolean;
  errors: string[];
}

export interface ProductionPreCheckResponse {
  ok: boolean;
  errors: string[];
}

// ========== Wiki Import ==========

export interface WikiDiagnoseRequest {
  wikiUrl: string;
}

export interface WikiDiagnoseCheckItem {
  ok: boolean;
  message: string;
}

export interface WikiDiagnoseResponse {
  credential: WikiDiagnoseCheckItem;
  wikiRead: WikiDiagnoseCheckItem;
  docRead: WikiDiagnoseCheckItem;
  resourceDownload: WikiDiagnoseCheckItem;
  spaceId: string;
  spaceName: string;
}

export interface WikiPreviewTreeRequest {
  wikiUrl: string;
}

export type WikiNodeType = 'folder' | 'docx' | 'sheet' | 'bitable' | 'shortcut' | 'unsupported';

export interface WikiTreeNodeItem {
  nodeToken: string;
  title: string;
  objType: string;
  objToken: string;
  hasChild: boolean;
  parentToken: string;
  nodeType: WikiNodeType;
  wikiUrl: string;
  existingMapping: boolean;
  children: WikiTreeNodeItem[];
}

export interface WikiPreviewTreeResponse {
  spaceId: string;
  spaceName: string;
  rootNodeToken: string;
  tree: WikiTreeNodeItem[];
  totalDocCount: number;
  existingMappingCount: number;
  importableCount: number;
  truncated: boolean;
}

export interface WikiImportNode {
  nodeToken: string;
  objToken: string;
  title: string;
  wikiUrl: string;
  targetFirstCategory?: string;
  targetSecondCategory?: string;
  helpCenterTitle?: string;
  helpCenterSlug?: string;
  language?: Language;
  syncMode?: SyncMode;
  owner?: string;
  wikiPath?: string;
}

export interface WikiImportRequest {
  selectedNodes: WikiImportNode[];
  targetFirstCategory: string;
  targetSecondCategory?: string;
  owner: string;
  language: Language;
  syncMode: SyncMode;
  syncAfterCreate: boolean;
}

export interface WikiImportResultItem {
  title: string;
  wikiUrl: string;
  status: 'success' | 'failed' | 'skipped';
  mappingId?: string;
  reason?: string;
}

export interface WikiImportResponse {
  totalCount: number;
  successCount: number;
  failCount: number;
  skipCount: number;
  items: WikiImportResultItem[];
}

export interface WikiSpaceItem {
  spaceId: string;
  name: string;
  description: string;
}

export interface WikiListSpacesResponse {
  available: boolean;
  message?: string;
  spaces: WikiSpaceItem[];
}

// ========== Preview ==========

export interface PreviewStatusResponse {
  deployed: boolean;
  docCount: number;
  previewUrl: string;
  updatedAt: string | null;
}

// ========== Attachment Preview ==========

export type AttachmentPreviewType = 'pdf' | 'pptx' | 'xlsx' | 'unknown';

export interface AttachmentPreviewInfo {
  type: AttachmentPreviewType;
  fileName: string;
  fileUrl: string;
  downloadUrl: string;
}

export function getAttachmentPreviewType(fileName: string): AttachmentPreviewType {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'pptx' || ext === 'ppt') return 'pptx';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  return 'unknown';
}

export function isAttachmentFileUrl(url: string): boolean {
  if (/\/files\/help-center\//.test(url)) return true;
  return /\/assets\/files\/.*\.(pdf|pptx|ppt|xlsx|xls)$/i.test(url);
}

export function parseAttachmentInfo(href: string, children: string): AttachmentPreviewInfo {
  const fileName = children || href.split('/').pop() || '附件';
  return {
    type: getAttachmentPreviewType(fileName),
    fileName,
    fileUrl: href,
    downloadUrl: href,
  };
}

// ========== Build Artifact ==========

export interface ResourceAnomalyItem {
  docTitle: string;
  language: string;
  filePath: string;
  resourcePath: string;
  resourceDir: string;
  fileName: string;
  reason: string;
}

export interface DocumentBuildInfo {
  title: string;
  language: Language;
  firstCategory: string;
  secondCategory: string;
  helpCenterPath: string;
  imageCount: number;
  externalLinkCount: number;
  attachmentCount: number;
  hasResourceError: boolean;
  missingImages: string[];
  zeroByteAttachments: string[];
}

export interface BuildArtifactResult {
  taskId: string;
  docCount: number;
  buildDirPath: string;
  zipFilePath: string;
  zipSize: number;
  downloadUrl: string;
  storageDownloadUrl?: string;
  docList: DocumentBuildInfo[];
  resourceAnomalyCount: number;
}

export interface RepairImagesRequest {
  ids: string[];
}

export interface ResourceRepairItem {
  token: string;
  targetPath: string;
  success: boolean;
  tokenSource: 'feishu_source' | 'filename_fallback';
  errorReason?: string;
  fileSize?: number;
}

export interface ResourceRepairResult {
  mappingId: string;
  docTitle: string;
  docId: string;
  totalMissing: number;
  repaired: number;
  failed: number;
  resourceStatusAfter: '正常' | '异常';
  remainingIssues: number;
  items: ResourceRepairItem[];
}

export interface PptxPollutionScanResult {
  totalPolluted: number;
  pollutedDocuments: Array<{
    id: string;
    title: string;
    slug: string;
    patterns: string[];
  }>;
  totalPptxReferences: number;
  pptxReferenceDocuments: Array<{
    id: string;
    title: string;
    slug: string;
  }>;
}

export interface CleanPptxPollutionResult {
  totalCleaned: number;
  cleanedDocuments: Array<{
    id: string;
    title: string;
    slug: string;
  }>;
  errors: string[];
}
