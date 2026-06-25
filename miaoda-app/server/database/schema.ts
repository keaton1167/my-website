/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const opType = pgEnum("op_type", ['INSERT', 'UPDATE', 'DELETE']);

export const pgAudit = pgTable("pg_audit", {
  eventId: varchar("event_id", { length: 64 }).primaryKey(),
  eventTime: timestamp("event_time", { mode: 'string' }).notNull(),
  targetTable: varchar("target_table", { length: 255 }).notNull(),
  type: opType("type").notNull(),
  /**
   * 数据变更日志详情
   */
  details: jsonb("details"),
}, (table) => [
  index("idx_pg_audit_table_name").on(table.targetTable, table.eventTime),
  index("idx_pg_audit_table").on(table.targetTable),
]);

export const taskQueue = pgTable("task_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskType: varchar("task_type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  priority: integer("priority").notNull().default(0),
  /**
   * @type Record<string, unknown> 任务参数 JSON
   */
  payload: jsonb("payload"),
  /**
   * @type Record<string, unknown> 任务结果 JSON
   */
  result: jsonb("result"),
  logs: text("logs"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(0),
  parentTaskId: uuid("parent_task_id"),
  refType: varchar("ref_type", { length: 50 }),
  refId: uuid("ref_id"),
  startedAt: customTimestamptz("started_at", { precision: 3 }),
  finishedAt: customTimestamptz("finished_at", { precision: 3 }),
  createdBy: userProfile("created_by"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_tq_status").on(table.status),
  index("idx_tq_task_type").on(table.taskType),
  index("idx_tq_ref").on(table.refType, table.refId),
  index("idx_tq_parent_task_id").on(table.parentTaskId),
  index("idx_tq_created_at").on(table.createdAt),
]);

export const feishuSyncTasks = pgTable("feishu_sync_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  mappingId: uuid("mapping_id").notNull(),
  syncType: varchar("sync_type", { length: 255 }),
  status: varchar("status", { length: 255 }).default('待执行'),
  convertedMarkdown: text("converted_markdown"),
  errorMessage: text("error_message"),
  buildCheckStatus: varchar("build_check_status", { length: 255 }),
  commitId: varchar("commit_id", { length: 255 }),
  createdBy: userProfile("created_by"),
  finishedAt: customTimestamptz("finished_at", { precision: 3 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_fst_mapping_id").on(table.mappingId),
  index("idx_fst_status").on(table.status),
]);

export const feishuDocMappings = pgTable("feishu_doc_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  feishuDocTitle: varchar("feishu_doc_title", { length: 255 }),
  feishuDocUrl: text("feishu_doc_url").notNull(),
  feishuDocToken: varchar("feishu_doc_token", { length: 255 }),
  targetFirstCategory: varchar("target_first_category", { length: 255 }),
  targetSecondCategory: varchar("target_second_category", { length: 255 }),
  helpCenterTitle: varchar("help_center_title", { length: 255 }),
  helpCenterSlug: varchar("help_center_slug", { length: 255 }),
  helpCenterFilePath: varchar("help_center_file_path", { length: 255 }),
  helpCenterUrl: varchar("help_center_url", { length: 255 }),
  syncMode: varchar("sync_mode", { length: 255 }).default('手动同步'),
  syncStatus: varchar("sync_status", { length: 255 }).default('未同步'),
  lastSyncAt: customTimestamptz("last_sync_at", { precision: 3 }),
  lastSyncBy: userProfile("last_sync_by"),
  owner: userProfile("owner"),
  enabled: boolean("enabled").default(true),
  language: varchar("language", { length: 10 }).default('zh-CN'),
  translationGroupId: uuid("translation_group_id"),
  targetDocumentId: uuid("target_document_id"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_fdm_sync_mode").on(table.syncMode),
  index("idx_fdm_sync_status").on(table.syncStatus),
  index("idx_fdm_target_first_category").on(table.targetFirstCategory),
  uniqueIndex("idx_fdm_language_help_center_file_path").on(table.language, table.helpCenterFilePath),
  index("idx_fdm_translation_group_id").on(table.translationGroupId),
]);

export const systemConfig = pgTable("system_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  repoPlatform: varchar("repo_platform", { length: 255 }).default('GitHub'),
  repoUrl: text("repo_url"),
  defaultBranch: varchar("default_branch", { length: 255 }).default('main'),
  workBranchPrefix: varchar("work_branch_prefix", { length: 255 }).default('docs/'),
  deployMode: varchar("deploy_mode", { length: 255 }).default('公司服务器'),
  backendApiBaseUrl: text("backend_api_base_url"),
  stagingUrl: text("staging_url"),
  productionUrl: text("production_url"),
  gitConnectionStatus: varchar("git_connection_status", { length: 255 }).default('未检测'),
  backendApiConnectionStatus: varchar("backend_api_connection_status", { length: 255 }).default('未检测'),
  stagingConnectionStatus: varchar("staging_connection_status", { length: 255 }).default('未检测'),
  productionConnectionStatus: varchar("production_connection_status", { length: 255 }).default('未检测'),
  serverConnectionStatus: varchar("server_connection_status", { length: 255 }).default('未检测'),
  gitLastCheckedAt: customTimestamptz("git_last_checked_at", { precision: 3 }),
  backendApiLastCheckedAt: customTimestamptz("backend_api_last_checked_at", { precision: 3 }),
  stagingLastCheckedAt: customTimestamptz("staging_last_checked_at", { precision: 3 }),
  productionLastCheckedAt: customTimestamptz("production_last_checked_at", { precision: 3 }),
  serverLastCheckedAt: customTimestamptz("server_last_checked_at", { precision: 3 }),
  docsDir: varchar("docs_dir", { length: 255 }).default('docs'),
  chatbaseEnabled: boolean("chatbase_enabled").default(false),
  algoliaEnabled: boolean("algolia_enabled").default(false),
  feishuSyncEnabled: boolean("feishu_sync_enabled").default(true),
  defaultLanguage: varchar("default_language", { length: 10 }).default('zh-CN'),
  enabledLanguages: text("enabled_languages").array().default(sql`ARRAY['zh-CN'::text, 'en'::text]`),
  zhLangCode: varchar("zh_lang_code", { length: 10 }).default('zh-CN'),
  enLangCode: varchar("en_lang_code", { length: 10 }).default('en'),
  defaultDocsDir: varchar("default_docs_dir", { length: 255 }).default('docs'),
  enI18nDocsDir: varchar("en_i18n_docs_dir", { length: 255 }).default('i18n/en/docusaurus-plugin-content-docs/current'),
  defaultPublishScope: varchar("default_publish_scope", { length: 20 }).default('all'),
  docusaurusProjectDir: varchar("docusaurus_project_dir", { length: 255 }).default('/home/gm/workspace/code'),
  buildOutputDir: varchar("build_output_dir", { length: 255 }).default('build'),
  stagingDeployMode: varchar("staging_deploy_mode", { length: 255 }).default('local_static_dir'),
  stagingDeployDir: varchar("staging_deploy_dir", { length: 255 }).default('/home/workspace/staging-deploy'),
  autoBuildBeforeDeploy: boolean("auto_build_before_deploy").default(true),
  requireBuildCheck: boolean("require_build_check").default(true),
  productionDeployMode: varchar("production_deploy_mode", { length: 255 }).default('local_static_dir'),
  productionDeployDir: varchar("production_deploy_dir", { length: 255 }).default('/home/workspace/production-deploy'),
  requireStagingSuccessBeforeProduction: boolean("require_staging_success_before_production").default(true),
  requireBuildCheckBeforeProduction: boolean("require_build_check_before_production").default(true),
  autoBuildBeforeProductionDeploy: boolean("auto_build_before_production_deploy").default(true),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const publishTasks = pgTable("publish_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskName: varchar("task_name", { length: 255 }).notNull(),
  taskType: varchar("task_type", { length: 255 }).notNull(),
  environment: varchar("environment", { length: 255 }),
  status: varchar("status", { length: 255 }).default('待执行'),
  operator: userProfile("operator"),
  relatedDocs: varchar("related_docs", { length: 255 }).array(),
  buildLog: text("build_log"),
  deployLog: text("deploy_log"),
  errorMessage: text("error_message"),
  finishedAt: customTimestamptz("finished_at", { precision: 6 }),
  publishScope: varchar("publish_scope", { length: 20 }).default('all'),
  prUrl: varchar("pr_url", { length: 500 }),
  prNumber: integer("pr_number"),
  prCreatedAt: customTimestamptz("pr_created_at", { precision: 3 }),
  mergeStatus: varchar("merge_status", { length: 50 }),
  prMergedAt: customTimestamptz("pr_merged_at", { precision: 3 }),
  mergeCommitSha: varchar("merge_commit_sha", { length: 100 }),
  deployStatus: varchar("deploy_status", { length: 50 }),
  workflowRunId: varchar("workflow_run_id", { length: 100 }),
  deployUrl: text("deploy_url"),
  deployedAt: customTimestamptz("deployed_at", { precision: 3 }),
  securityCheckResult: varchar("security_check_result", { length: 20 }),
  securityCheckErrors: text("security_check_errors"),
  deployErrorMessage: text("deploy_error_message"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_publish_tasks_status").on(table.status),
  index("idx_publish_tasks_task_type").on(table.taskType),
  // Complex index: CREATE INDEX idx_publish_tasks_operator ON publish_tasks USING btree (((operator).user_id)),
  index("idx_publish_tasks_deploy_status").on(table.deployStatus),
]);

export const importTasks = pgTable("import_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: varchar("source_type", { length: 255 }).default('feishu'),
  sourceUrl: text("source_url").notNull(),
  targetCategory: uuid("target_category"),
  targetDocId: uuid("target_doc_id"),
  status: varchar("status", { length: 255 }).default('待转换'),
  convertedMarkdown: text("converted_markdown"),
  errorMessage: text("error_message"),
  createdBy: userProfile("created_by"),
  finishedAt: customTimestamptz("finished_at", { precision: 6 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_import_tasks_status").on(table.status),
  index("idx_import_tasks_target_category").on(table.targetCategory),
  // Complex index: CREATE INDEX idx_import_tasks_created_by ON import_tasks USING btree (((created_by).user_id)),
]);

export const docs = pgTable("docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  summary: text("summary"),
  firstCategory: varchar("first_category", { length: 255 }),
  secondCategory: varchar("second_category", { length: 255 }),
  slug: varchar("slug", { length: 255 }),
  filePath: varchar("file_path", { length: 255 }),
  markdownContent: text("markdown_content"),
  contentStatus: varchar("content_status", { length: 255 }).default('无正文'),
  publishStatus: varchar("publish_status", { length: 255 }).default('草稿'),
  owner: userProfile("owner"),
  lastPublisher: userProfile("last_publisher"),
  wordCount: integer("word_count").default(0),
  sourceType: varchar("source_type", { length: 255 }).default('手动创建'),
  sourceUrl: text("source_url"),
  publishedAt: customTimestamptz("published_at", { precision: 6 }),
  helpCenterUrl: varchar("help_center_url", { length: 255 }),
  language: varchar("language", { length: 10 }).default('zh-CN'),
  translationGroupId: uuid("translation_group_id"),
  resourceStatus: varchar("resource_status", { length: 20 }).default('未扫描'),
  missingImagesCount: integer("missing_images_count").default(0),
  zeroByteAttachmentsCount: integer("zero_byte_attachments_count").default(0),
  lastResourceCheckedAt: customTimestamptz("last_resource_checked_at", { precision: 3 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_docs_first_category").on(table.firstCategory),
  index("idx_docs_publish_status").on(table.publishStatus),
  index("idx_docs_content_status").on(table.contentStatus),
  // Complex index: CREATE INDEX idx_docs_owner ON docs USING btree (((owner).user_id)),
  uniqueIndex("idx_docs_language_file_path").on(table.language, table.filePath),
  index("idx_docs_resource_status").on(table.resourceStatus),
]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id"),
  level: integer("level").notNull(),
  nameCn: varchar("name_cn", { length: 255 }).notNull(),
  slugEn: varchar("slug_en", { length: 255 }).notNull(),
  docusaurusPath: varchar("docusaurus_path", { length: 255 }),
  sortOrder: integer("sort_order").default(0),
  description: text("description"),
  enabled: boolean("enabled").default(true),
  nameEn: varchar("name_en", { length: 255 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_categories_parent_id").on(table.parentId),
  index("idx_categories_level").on(table.level),
  index("idx_categories_sort_order").on(table.sortOrder),
]);

// table aliases
export const categoriesTable = categories;
export const docsTable = docs;
export const feishuDocMappingsTable = feishuDocMappings;
export const feishuSyncTasksTable = feishuSyncTasks;
export const importTasksTable = importTasks;
export const pgAuditTable = pgAudit;
export const publishTasksTable = publishTasks;
export const systemConfigTable = systemConfig;
export const taskQueueTable = taskQueue;
