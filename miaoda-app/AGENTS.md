# ODPM 帮助中心管理系统

## 应用概览

企业级帮助中心管理系统，用于管理文档内容、目录结构、飞书文档同步和发布流程。妙搭仅作为管理界面和流程入口，Git/npm/服务器部署等操作由后端 API 完成。

## 技术架构

- 前端：React 19 + TypeScript + Tailwind CSS + shadcn/ui
- 后端：NestJS + Drizzle ORM + PostgreSQL
- 路由：React Router DOM v6
- 表格：@lark-apaas/client-toolkit/antd-table
- 图标：lucide-react

## 页面路由

| 路径 | 页面 | 组件目录 | 可见角色 |
|------|------|---------|----------|
| / | 运营工作台 | client/src/pages/Dashboard/ | 全部 |
| /documents | 内容管理 | client/src/pages/DocumentManage/ | 全部 |
| /categories | 目录设置 | client/src/pages/CategoryManage/ | super_admin, publish_admin |
| /import/feishu | 导入工具 | client/src/pages/FeishuSync/ | super_admin, publish_admin |
| /publish-center | 发布中心 | client/src/pages/PublishCenter/ | super_admin, publish_admin, content_editor |
| /system-config | 系统配置 | client/src/pages/SystemConfig/ | super_admin, publish_admin |

## 服务端模块

| 模块 | 目录 | Controller 前缀 |
|------|------|----------------|
| DashboardModule | server/modules/dashboard/ | api/dashboard |
| DocumentsModule | server/modules/documents/ | api/documents |
| CategoriesModule | server/modules/categories/ | api/categories |
| ImportModule | server/modules/import/ | api/import, api/feishu-doc-mappings |
| PublishModule | server/modules/publish/ | api/publish-tasks, api/docusaurus, api/deploy (含 draft-preview/running-tasks), api/tasks, api/git, api/help-center, api/preview/help-center |
| SystemConfigModule | server/modules/system-config/ | api/system-config |
| TaskQueueModule | server/modules/task-queue/ | api/task-queue |

## 数据模型

8 张业务表：docs、categories、import_tasks、publish_tasks、system_config、feishu_doc_mappings、feishu_sync_tasks、task_queue

类型定义位于 `shared/api.interface.ts`，schema 定义位于 `server/database/schema.ts`

### docs 表关键字段
id, title, summary, first_category, second_category, slug, file_path, help_center_url, markdown_content, content_status, publish_status, owner, last_publisher, word_count, source_type, source_url, published_at, language, translation_group_id, resource_status, missing_images_count, zero_byte_attachments_count, last_resource_checked_at

- **translation_group_id**：翻译组关联 UUID，新建文档时自动生成，编辑时不修改
- **resource_status**：资源扫描状态（未扫描/正常/异常），构建产物包时由资源完整性扫描更新
- **missing_images_count / zero_byte_attachments_count**：缺失图片和0字节附件数量，构建产物包时更新
- **last_resource_checked_at**：最近一次资源扫描时间
- **translationStatus 筛选**：后端支持 `translationStatus` 查询参数，仅中文/仅英文用 SQL NOT EXISTS 子查询，中英文完整/英文待更新用内存过滤+手动分页
- **翻译状态**（后端计算）：同组下有 zh-CN + en 且英文更新 → 中英文完整；中文更新晚于英文 → 英文待更新；仅 zh-CN → 仅中文；仅 en → 仅英文
- **详情接口** `GET /api/documents/:id`：返回关联中文/英文文档信息
- **服务启动时**自动为存量无 groupId 文档回填独立 UUID

### feishu_doc_mappings 表
飞书文档与帮助中心文档的同步映射关系，支持手动/定时/事件触发三种同步方式

- **translation_group_id**：翻译组关联 UUID，创建时自动生成或复用已有文档的翻译组
- **target_document_id**：关联的帮助中心文档 ID（可选，用于复用已有翻译组）
- **translationStatus 计算**：后端根据同组语言分布计算（仅中文/仅英文/中英文完整/英文待更新）
- **约束**：同一 translationGroupId 下最多一个中文映射和一个英文映射
- **服务启动时**自动为存量无 groupId 映射回填独立 UUID

### feishu_sync_tasks 表
同步任务执行记录，包含转换结果、构建检查状态等

### task_queue 表
统一任务调度队列，为批量同步、定时同步、发布和回滚提供异步任务基础设施

- **task_type 枚举**：feishu_sync、feishu_batch_sync、auto_sync、publish_staging、publish_production、rollback、import
- **status 状态**：pending → running → success/failed/cancelled
- **handler 注册模式**：`TaskQueueService.registerHandler(taskType, handlerFn)` 注册执行器，未注册则标记 failed
- **fire-and-forget**：入队后立即异步执行，不阻塞请求
- **重试机制**：支持手动重试（retry API）和自动重试（maxRetries > 0 时指数退避）
- **关联业务表**：通过 refType + refId 轻量关联现有 publish_tasks / feishu_sync_tasks 等表，不迁移现有表

### system_config 表
系统全局配置，包含仓库配置、服务地址、连接状态、第三方能力开关、测试环境部署配置等。repoUrl 仅存储 clean URL（不含凭证），GitHub Token 通过环境变量 `GITHUB_TOKEN` 读取，禁止写入数据库或 URL

- **测试环境部署配置**：`build_output_dir`（构建产物目录）、`staging_deploy_mode`（部署方式：local_static_dir/server_static_dir/object_storage）、`staging_deploy_dir`（本地部署目录）、`auto_build_before_deploy`（发布前自动构建）、`require_build_check`（要求构建检查成功）
- **stagingDeployDir 安全校验**：必须是绝对路径，不能是系统目录或项目内部目录，清理前必须再次通过安全校验
- **数据库文档同步到 Docusaurus 目录**：`syncDocsToProject` 支持 `includeDraft` 参数和 `buildScope` 参数。includeDraft=false 时同步 publishStatus 为"待发布"或"已发布"的文档；includeDraft=true 时同步所有 contentStatus=有正文 的文档（含草稿）。buildScope 参数用于构建产物包：`publishedOnly` 仅包含已发布文档，`releaseCandidate` 包含已发布+待发布文档。buildScope 优先级高于 includeDraft，两种模式均排除草稿、待审核、已归档、无正文、filePath 为空、禁用目录、测试文档（标题含 `[API_TEST]`）。测试环境发布传入 includeDraft=true，正式发布/构建检查/发布到网站保持 includeDraft=false，构建产物包使用 buildScope。生成 .md 文件和 `_category_.json` 到 Docusaurus `docs/` 目录，同步前清理旧文档和旧分类文件（限定系统管理的一级分类目录范围）。路径安全校验：禁止 `..` 穿越，仅允许 `.md`/`.mdx` 扩展名，只写入 `docs/` 或 `i18n/` 目录内。支持 firstCategory/secondCategory 按 UUID 或中文名称查找分类
- **测试环境发布流程**：构建产物复制到 `{stagingDeployDir}/my-website/` 子目录（匹配 Docusaurus baseUrl `/my-website/`），然后自动启动静态服务（`http-server`）监听 3333 端口，stagingUrl 为 `http://localhost:3333/my-website/`。仅执行 1 次 Docusaurus build，不再附带预览构建
- **草稿预览（轻量入口）**：`POST /api/deploy/draft-preview` 独立于测试环境发布，仅做 1 次 Docusaurus build（baseUrl 临时改为 `/api/preview/help-center/`），产物复制到 `{stagingDeployDir}/api-preview/`。同步全部语言、全部 contentStatus=有正文 的文档（含草稿），不执行 git push、不创建 PR、不影响 GitHub Pages。content_editor 也可触发
- **构建产物包（正式 build.zip）**：`POST /api/deploy/build-artifact` 生成完整静态站产物包。支持 `buildScope` 参数：`releaseCandidate`（默认，包含已发布+待发布文档）和 `publishedOnly`（仅已发布文档）。排除草稿、待审核、已归档、无正文、filePath 为空、禁用目录、测试文档（标题含 `[API_TEST]`）。设置 url=https://support.oceanpayment.com、baseUrl=/，执行 Docusaurus build，验证附件预览文件完整性，压缩为 build.zip 存储到 `/tmp/build-artifact/{taskId}/`。构建结果 JSON 存储在 deployLog 字段。`GET /api/deploy/build-artifact/download?taskId=xxx` 支持下载。不修改文档 publishStatus、不 Git push、不部署到服务器。仅 super_admin/publish_admin 可触发
- **资源完整性扫描**：构建产物包前自动执行，解析 scope 内文档的图片和附件引用（覆盖 Markdown/HTML/MDX 格式），检查磁盘文件存在性和大小。缺失图片和 0 字节附件记录到 buildLog 并更新 docs 表的 resource_status/missing_images_count/zero_byte_attachments_count。扫描完成后清理不在当前 scope 引用范围内的孤立资源目录。BuildArtifactResult 包含 resourceAnomalyCount 字段，前端发布中心对异常任务展示黄色警告 badge
- **构建配置分离**：build-artifact 使用 `url=https://support.oceanpayment.com`、`baseUrl=/`（正式部署配置）；"发布到网站"使用原始 docusaurus.config.js（`url=https://keaton1167.github.io`、`baseUrl=/my-website/`，GitHub Pages 配置）；"GitHub Pages 预览发布"通过 `forceConfig` 临时覆盖临时工作区的 url/baseUrl，不修改系统配置，两者互不影响
- **GitHub Pages 预览发布**：`POST /api/git/publish-website` 支持 `previewOnly=true` 模式。预览模式下：使用独立互斥锁（`GitHub Pages预览`），跳过构建检查前置，覆盖临时工作区 docusaurus.config.js 的 url/baseUrl，传入 `buildScope=releaseCandidate`，PR 标题带 `[Preview]` 前缀，**不更新文档 publishStatus**（跳过"待发布→已发布"），不执行公司服务器部署。仅 `super_admin`/`publish_admin` 可见前端按钮
- **Pipeline 资源同步**：`executeWebsitePublishPipeline` 在 syncDocsToProject 后、Docusaurus build 前，从本地 projectRoot 复制 `static/img/help-center/`、`static/files/help-center/`、`static/js/` 到临时工作区，确保图片、附件、预览脚本等资源随 PR 推送到 GitHub。构建前校验扫描所有 MDX 中 `/img/help-center/` 和 `/files/help-center/` 引用，缺失资源时直接失败并输出缺失清单。git add 白名单包含 `docs/`、`i18n/`、`static/img/help-center/`、`static/files/help-center/`、`static/js/`
- **任务互斥**：`PublishService` 内存级互斥锁（`runningTaskTypes: Set<string>`），草稿预览、测试环境发布、正式发布、发布到网站、GitHub Pages预览、构建产物包不能同时运行（预览发布与正式发布使用不同锁，互不阻塞）。`GET /api/deploy/running-tasks` 返回当前运行中的任务类型列表
- **预览控制器**：`PreviewController`（`api/preview/help-center`）通过 `@NeedLogin()` + `@CanRole` 保护，从 `{stagingDeployDir}/api-preview/` 目录读取静态文件并返回，支持 SPA 路由 fallback 到 index.html，路径安全校验防止穿越访问
- **正式环境部署配置**：`production_deploy_mode`（部署方式）、`production_deploy_dir`（部署目录）、`require_staging_success_before_production`（要求测试环境发布成功）、`require_build_check_before_production`（要求构建检查成功）、`auto_build_before_production_deploy`（正式发布前自动构建）
- **正式环境发布流程**：precheck 校验 → 二次确认 → 异步执行（构建→备份旧产物→清理→复制到 `{productionDeployDir}/my-website/` →启动 `http-server` 静态服务监听 8888 端口）。备份目录为 `{productionDeployDir}.bak.{timestamp}`，保留最近 3 个
- **正式发布 precheck**：校验 productionUrl、productionDeployDir 安全、项目目录、package.json、node_modules、构建检查状态、测试环境发布状态、main 分支与 origin/main 一致性
- **回滚链路**：基于正式发布前生成的备份目录（`{productionDeployDir}.bak.{timestamp}`）执行真实回滚。回滚前会创建回滚前快照（`{productionDeployDir}.rollback-snap.{timestamp}`），然后清理部署目录、复制备份内容、重启静态服务、验证 HTTP 200。回滚版本列表来自成功正式发布任务的 deployLog 解析，仅展示备份目录实际存在的版本。回滚任务支持 retryTask 重新执行

## 前端 API 分组

| 命名空间 | 文件 | 对应后端 |
|---------|------|---------|
| dashboardApi | client/src/api/dashboard.ts | /api/dashboard/* |
| documentsApi | client/src/api/documents.ts | /api/documents/* |
| categoriesApi | client/src/api/categories.ts | /api/categories/* |
| importApi | client/src/api/import.ts | /api/import/* |
| feishuMappingsApi | client/src/api/feishu-mappings.ts | /api/feishu-doc-mappings/* |
| publishApi | client/src/api/publish.ts | /api/publish-tasks/*, /api/docusaurus/*, /api/deploy/*, /api/tasks/*, /api/git/*, /api/help-center/* |
| systemConfigApi | client/src/api/system-config.ts | /api/system-config/* |

## 飞书文档同步页面结构

FeishuSyncPage — 直接展示 SyncMappingTab（同步映射管理），含统计卡片、筛选、批量操作、映射 CRUD
- DrivePermissionDialog — 飞书权限诊断弹窗，检测凭证/文档读取/图片下载/附件下载权限，支持一键重试资源下载
- WikiImportDialog — 知识库导入弹窗，4 步向导（链接诊断→目录树勾选→导入确认表格→结果展示），Step 1 支持双模式入口（粘贴链接 / 选择知识库），选择知识库后自动诊断并直接进入文档选择
- WikiImportConfirmTable — 导入确认表格组件，支持批量填充默认值 + 逐行编辑 + 逐行校验，复用批量新增映射的表格交互模式
- WikiTreeSelector — 知识库目录树勾选组件，递归渲染（含 docx 节点子节点展开）、按节点类型标记、已映射跳过
- 后端新增 4 个接口：`GET wiki/list-spaces`、`POST wiki/diagnose`、`POST wiki/preview-tree`、`POST wiki/import`，均在 `FeishuMappingsController` 中，复用 `FeishuService` 的知识库 API 能力（`listSpaces`/`listWikiTree`/`diagnoseWikiAccess`/`parseWikiUrl`）

## 系统配置页面结构

- SystemConfigPage — 主页面，包含四个功能区块
- ConnectionCheckSection — 连接检测区块，5项状态展示与检测操作
- 区块：仓库配置、服务配置、连接状态、第三方能力
- 敏感密钥不在前端展示，仅显示"由后端或密钥管理服务维护"提示

## 文档管理页面结构

- DocumentFilters — 筛选区（目录/状态/语言/翻译状态/负责人/关键词 + 查询/重置/刷新）
- DocumentTable — 表格视图（含语言列、行选择、批量操作）
- DocumentGroupView — 分组视图（按一级目录分组）
- DocumentFormDialog — 新建/编辑弹窗（语言选择器、文件路径预览、帮助中心 URL 预览）
- DocumentDetailDialog — 文档详情查看弹窗（文档信息 + Streamdown Markdown 正文渲染，自动剥离 frontmatter，支持"预览当前文档"按钮跳转对应预览页面，预览未部署时弹窗内可一键生成草稿预览）
- 附件预览：Streamdown 组件自动拦截 `/files/help-center/` 路径的附件链接，根据文件类型渲染内嵌预览（PDF 用 pdfjs-dist、PPTX 用 pptx-preview、XLSX 用 xlsx），保留下载按钮，预览失败时降级显示"预览生成失败，请下载原文件查看"
- BatchActions — 批量操作栏（批量提交审核/审核通过/驳回/移动/删除/导出，按选中文档状态和角色动态显示按钮，混选时显示可操作数量）
- DocumentManagePage — 主页面，编排筛选/视图/批量操作/弹窗，含"生成/更新草稿预览"按钮 + 轮询任务状态 + 互斥禁用逻辑 + 驳回原因弹窗

### 文档审核流程

状态枚举：草稿 / 待审核 / 待发布 / 已发布 / 已归档
- 草稿 → 提交审核 → 待审核
- 待审核 → 审核通过 → 待发布（审核通过但未发布到公开网站）
- 待审核 → 驳回修改 → 草稿
- 待发布 → 发布中心"发布到网站"成功 → 已发布
- 待发布/已发布 → 归档 → 已归档
- 已发布/待发布文档编辑正文/标题/目录/路径等内容字段后，状态自动回退到草稿
- "已发布"仅用于已通过发布中心成功发布到公开网站的内容
- 提交审核：content_editor / publish_admin / super_admin 均可操作，仅草稿且有正文时可提交
- 审核通过/驳回/归档：仅 publish_admin / super_admin 可操作
- 驳回原因：前端弹窗可选填，本轮不持久化

## 多语言支持

文档、目录、飞书映射、系统配置均支持多语言（zh-CN / en）。

- **文件路径生成**：中文用 `docs/...` 前缀，英文用 `i18n/en/docusaurus-plugin-content-docs/current/...` 前缀（取自 system_config.en_i18n_docs_dir）
- **帮助中心 URL**：中文 `{productionUrl}/docs/...`；双语英文 `{productionUrl}/en/docs/...`；英文独享文档 `{productionUrl}/docs/...`（无 `/en/` 前缀）
- **英文独享文档**：同 translationGroupId 下无对应中文文档的英文文档，`syncDocsToProject` 将其写入 `docs/` 目录（而非 `i18n/en/`），因 Docusaurus i18n 机制要求 `i18n/` 目录文件必须有默认语言对应文件
- **唯一性约束**：同语言下 `(language, file_path)` 唯一，跨语言允许相同路径
- **编辑限制**：编辑模式下语言不可更改
- **存量数据**：现有文档默认 zh-CN
- **构建重试**：Docusaurus 构建遇到缓存损坏（JSON parse error / Module parse failed）时自动清理 `.docusaurus` 缓存并重试一次

## 权限体系

采用平台内置静态角色鉴权（RBAC），4 个标准角色：

| 角色标识 | 名称 | 职责 |
|---------|------|------|
| super_admin | 系统管理员 | 全功能权限 |
| publish_admin | 发布管理员 | 发布流程 + 系统配置 |
| content_editor | 内容运营 | 文档/目录/飞书同步管理 |
| viewer | 只读成员 | 仅查看 |

### 后端鉴权

所有写接口（POST/PUT/PATCH/DELETE）均使用 `@CanRole` 装饰器保护，放置在 `@NeedLogin()` 上方，无遗漏：

- publish_admin + super_admin：deploy/*、system-config（含 check-connection）、docusaurus/build、publish-tasks retry、task-queue 写操作（enqueue/retry/cancel）
- content_editor + super_admin + publish_admin：documents 写操作（CRUD + submit-review + batch-submit-review + move + batch-move + delete + batch-delete）
- super_admin + publish_admin：documents 审核操作（approve/reject/batch-approve/batch-reject）、categories 全部写操作（CRUD + toggle-status + update-order）、feishu-doc-mappings 全部写操作（create/batch-create/update/delete/sync-one/sync-batch）、import/feishu-doc
- task-queue 读操作（list/detail）：super_admin + publish_admin + content_editor（任务日志含敏感信息，禁止匿名访问）

### 前端权限控制

- **路由守卫**：`ProtectedRoute` 组件（app.tsx），/categories 和 /import/feishu 限 super_admin + publish_admin，/publish-center 限 super_admin + publish_admin + content_editor，/system-config 限 super_admin + publish_admin
- **导航菜单**：Layout.tsx 中 `CanRole` 包裹目录设置、导入工具、发布中心、系统配置菜单
- **按钮级**：各页面使用 `<CanRole>` 组件，无权限时隐藏按钮（fallback=null）
- **403 拦截**：api/index.ts 中 `request()` 封装统一检查 response.status === 403，弹出 toast 提示
- **无权限页**：/unauthorized 路由，提示联系管理员

## 关键约束

- 妙搭仅作管理界面，不执行 Git/npm/服务器操作
- 敏感密钥不在前端保存，由后端服务管理。GitHub Token 通过环境变量 `GITHUB_TOKEN` 或 `/tmp/github-token` 文件读取，Git push 时使用 GIT_ASKPASS 临时传入
- 删除和正式发布必须二次确认弹窗
- 文档管理默认展示表格视图，一级目录不拼接到标题前
- 页面展示文案使用"帮助中心"，减少 Docusaurus 等技术词
- 路径使用英文 slug，页面显示中文标题
- 预留后端接口配置，当前阶段不真正调用外部 API

## 运营内容维护闭环 V1（已冻结）

### 角色路径

**管理员（super_admin / publish_admin）**：
新建/编辑内容 → 保存草稿 → 内容检查/预览帮助中心 → 发布更新 → 查看发布结果

**运营人员（content_editor）**：
新建/编辑内容 → 保存草稿 → 查看发布状态 → 等待管理员检查和发布 → 查看发布结果

### content_editor 权限边界

- 可见：运营工作台/内容管理/发布中心三项菜单、运营工作台统计卡片、新建文档表单、文档列表、详情弹窗（业务字段）、发布中心待处理 Badge、任务列表（含操作人列）、引导文案
- 不可见：目录设置/导入工具/系统配置菜单、发布中心管理员统计卡片区、发布中心完整筛选区、发布中心管理员操作按钮（内容检查/保存到帮助中心/发布到预览环境/正式发布/恢复历史版本/发布更新）、详情弹窗技术字段（slug/翻译组ID/文件路径/最后发布人/来源）、表单技术字段（语言选择器/slug输入框/文件路径预览）
- 路由守卫：/categories、/import/feishu、/system-config 不可访问

### content_editor 保留能力

内容维护、保存草稿、去发布中心、查看待处理内容、查看任务列表、查看发布进度

### 验收结论

- 代码级审计：content_editor 33 项 + super_admin 24 项全部通过
- P1 修复：content_editor 不再看到"发布更新"按钮，避免触发 403
- 编译检查：客户端 Vite HMR + 服务端 NestJS 均通过
- 结论：条件通过并完成 P1 修复，已冻结

### 下一阶段建议

1. 真实 content_editor 账号浏览器端 E2E 验证（解决 MOCK 角色传递问题）
2. 确认"待处理内容"统计指标的语义映射是否符合业务预期
3. 正文编辑体验 V1 方案设计
4. 如业务明确要求，再评估 content_editor 开放发布链路（方案 A：后端 precheck + deploy 权限）

## 批量文档发布到帮助中心网站 V1（已冻结）

### 本阶段目标

实现数据库文档自动同步到 Docusaurus docs 目录，并通过测试环境和正式环境发布链路验证文档生成、构建、部署、访问的完整闭环。

### 核心链路

数据库文档（docs 表，contentStatus=有正文）→ syncDocsToProject 生成 .md + _category_.json → Docusaurus build → 构建产物复制到部署目录 → http-server 静态服务 → 网站可见

### 关键代码改动

- `syncDocsToProject`（publish.service.ts）：从 docs/categories 表读取文档和分类，生成 .md/.mdx 文件和 _category_.json 到 Docusaurus docs/ 目录，支持中文 docs/ 和英文 i18n/ 双目录，含路径安全校验
- `executeStagingDeploy`（publish.service.ts）：测试环境发布构建前调用 syncDocsToProject
- `executeProductionDeploy`（publish.service.ts）：正式环境发布构建前调用 syncDocsToProject

### 验证结果

- 测试环境：HTTP 200（localhost:3333/my-website/），208.7s 构建成功
- 正式环境：HTTP 200（localhost:8888/my-website/），280.4s 构建成功
- 文档生成：写入 6 篇文档，生成 9 个 _category_.json
- 页面访问：4 篇文档页面均 HTTP 200 + h1 标题 + 正文可见（ODPM帮助中心使用指南、如何创建收款通道、企业认证流程、商户信息如何更新）
- 侧边栏分类：产品介绍、功能说明、ODPM 账户后台操作指引、板块操作指引、Payment 收单常见 FAQ、信息更新专区、常见问题、合规与认证、企业认证常见问题

### 未完成事项

- 未接飞书真实同步（当前数据库文档为手动/导入创建）
- 未接 GitHub Token / Git push（正式发布仅本地构建+部署，无远程仓库同步）
- 未接真实公司服务器或公网域名（localhost:8888 为沙箱正式环境）
- 未配置 Nginx / CDN / HTTPS

### 结论

批量文档发布到帮助中心网站 V1 已完成并可冻结。

### 下一阶段建议

- P0：真实外部访问链路（公司服务器 / 域名 / Nginx / CDN）
- P1：GitHub Token + Git push 入库（GITHUB_TOKEN 环境变量已预留）
- P1：飞书真实同步批量导入
- P2：正文编辑体验优化

## 真实外部访问链路 V1（方案已设计，待服务器信息准备后执行）

### 背景

当前发布产物通过 http-server 在沙箱内部提供服务（localhost:8888），外部浏览器无法访问。本方案设计将构建产物接入真实可访问地址。

### 推荐方案：公司服务器 + Nginx

将构建产物通过 SSH/SCP 推送到公司服务器指定目录，Nginx 配置静态文件服务 + HTTPS + 域名。

### 前置条件（待用户提供）

- 服务器 IP/地址、SSH 登录方式
- 部署目录（Nginx 静态文件目录）
- 访问域名或内网地址
- 是否已有 Nginx、是否需要 HTTPS

### 后端调整方向

- 实现 `server_static_dir` 部署模式（构建→SCP推送→远程 reload Nginx→验证远程 URL）
- system_config 新增远程服务器配置字段（host/user/port/deploy_dir/ssh_key_path）
- 连接检测扩展：SSH 连通性测试

### 分阶段计划

1. 环境准备（用户侧）：服务器、Nginx、域名、SSH 免密
2. Nginx 配置（Agent 生成配置模板，用户应用）
3. 后端远程部署逻辑（Agent 实现）
4. 联调验证
5. 冻结与文档

### 结论

方案已设计，待用户提供服务器信息后执行。

## Git push 入库 V1（已完成）

### 本阶段目标

将数据库同步生成到 Docusaurus docs 目录的帮助文档变更，提交并推送到 Git 仓库，形成可追踪、可备份、可迁移的文档版本。

### 已有能力（无需新增）

- `executeGitCommit`（publish.service.ts）：完整 Git commit + push 流程，含工作分支创建、路径白名单、无变更检测、GIT_ASKPASS 安全传递
- `triggerGitCommit`（publish.service.ts）：创建 Git 提交任务，调用 executeGitCommit 异步执行
- `retryGitPush`（publish.service.ts）：失败任务重试推送，从日志解析分支名和 commit hash
- Git Controller API：`POST /api/git/commit-push`、`POST /api/git/:taskId/retry-push`、`GET /api/git/:taskId/logs`
- 前端 UI："保存到帮助中心"按钮、日志查看、任务筛选
- GITHUB_TOKEN 读取：环境变量 → `/tmp/github-token` 文件回退，不入库不入前端

### 前置修复（本轮完成）

- `executeGitCommit` 分支命名：从 `config.workBranchPrefix` 读取配置值，空值或旧默认值 `docs/` 时回退 `help-center-sync/`
- `retryGitPush` 分支正则：从 `(help-center-sync/\S+)` 放宽为 `(\S+)`，适配任意分支前缀

### 分支策略

- 推送到工作分支 `help-center-sync/{YYYYMMDD}-{taskId前8位}`，不直接推 main
- 用户可在 GitHub/GitLab 手动创建 PR 合入 main
- 与妙搭 sprint/default 流程兼容

### 端到端验证结果（2026-06-21）

| 验证项 | 结果 |
|--------|------|
| 分支名 | `help-center-sync/20260621-6f1864a2` |
| commit hash | `a1887397c71e5c4a7153661a0a5fdc586ff91bef` |
| push 成功 | PASS |
| 远程分支可见 | PASS（`git branch -r` 确认） |
| 实际提交文件数 | 68 个（全部在白名单路径内） |
| 白名单外文件数 | 0 个 |
| 无变更提交跳过 | PASS（第二次触发返回 success + 无变更可提交） |
| 日志安全审计 | PASS（无 token 明文、无带 token URL、无 Authorization header） |

- GITHUB_TOKEN 环境变量注入确认，GIT_ASKPASS 安全传递
- 远程工作分支 `help-center-sync/20260621-6f1864a2` 已保留在 GitHub，可手动创建 PR
- V1 不自动创建 PR、不自动合并、不删除远程分支
- 8 项验证全部 PASS

### 结论

Git push 入库 V1 已完成并通过端到端验证，阶段冻结。

## GitHub Pages 上线与 E2E 交付验证 V1（已完成）

### 本阶段目标

验证"系统创建文档 → 发布 → Git push → GitHub Pages 公开可见"全链路，以唯一验收标识文档作为端到端交付凭证。

### PR 与构建链路

| PR | 标题 | 合并时间 | merge_commit | 构建结果 |
|----|------|---------|--------------|----------|
| #3 | ODPM Help Center docs sync 20260621 | 2026-06-21T16:23:28Z | aeee5dd58e6b | Run #5 成功 |
| #4 | sync help center docs: E2E verification document 20260622-001 | 2026-06-21T17:21:46Z | ae73c3a38945 | Run #6 失败 |
| #5 | fix: resolve Docusaurus build failure - remove /my-website/ prefix | 2026-06-21T17:36:23Z | e97d1472a8bf | Run #7 成功 |

- PR #4 构建失败原因：MDX 中图片和 PDF 资源路径多余 `/my-website/` 前缀（Docusaurus 构建时自动拼接 baseUrl），编译时报 `couldn't be resolved to an existing local image file`
- PR #5 修复：`/my-website/img/...` → `/img/...`，`/my-website/files/...` → `/files/...`

### 公开网站验证结果（7 项全部 PASS）

| 验证项 | 结果 | 详情 |
|--------|------|------|
| 文档页面 | HTTP 200 | 17115 bytes |
| 唯一标识 E2E-PUBLIC-VERIFY-20260622-001 | 可见（2 处） | 标题 + 正文 |
| 图片资源 | HTTP 200 | content-type: image/png, 201 bytes |
| PDF 附件 | HTTP 200 | content-type: application/pdf, 805 bytes |
| 侧边栏一级分类 | 产品介绍 - 可见 | |
| 侧边栏二级分类 | 功能说明 - 可见 | |
| 页面标题 | 可见 | |

### 关键 URL

- 公开文档：`https://keaton1167.github.io/my-website/docs/product-intro/features/e2e-verify-20260622-001/`
- 图片资源：`https://keaton1167.github.io/my-website/img/help-center/e2e-verify-20260622/verify-screenshot.png`
- PDF 附件：`https://keaton1167.github.io/my-website/files/help-center/e2e-verify-20260622/e2e-verify-report-20260622.pdf`
- GitHub Pages 首页：`https://keaton1167.github.io/my-website/`

### 远程分支状态

交付冻结时保留以下远程分支，不删除：
- `main`（sha: e97d1472a8bf）
- `help-center-sync/20260616-e34a086d`
- `help-center-sync/20260621-6f1864a2`
- `help-center-sync/20260622-e2e-verify`
- `help-center-sync/20260622-e2e-fix`

### 结论

GitHub Pages 上线与 E2E 交付验证 V1 已完成，全链路验证通过，阶段冻结。

## 自动 PR 创建与安全自动合并 V2（已冻结）

### 本阶段目标

管理员点击"发布到网站"后，系统自动完成：文档同步 → Docusaurus 构建 → Git push → 创建 PR → 安全校验 → 自动合并 → GitHub Pages 部署轮询 → 回写公开 URL。全流程无需进入 GitHub。

### 核心实现

- `triggerWebsitePublish`（publish.service.ts）：创建 `发布到网站` 类型任务，异步启动 6 步管道
- `executeWebsitePublishPipeline`（publish.service.ts）：7 步管道（tempWorkspace → build → gitPush → prCreate → securityCheck → merge → deploy）。Step 0 创建临时 clone 工作区（`git clone --depth=1`），Step 1-2 在临时工作区执行，Step 3-6 使用 GitHub API，finally 清理临时目录。主工作区 Git 状态不受影响
- `createTemporaryWorkspace`（publish.service.ts）：从 `config.defaultBranch` 读取分支（不写死 main），构造 auth URL clone 到 `/tmp/publish-ws-{timestamp}`，日志中 token 自动脱敏
- `repairGitCorruption`（publish.service.ts）：异步方法，包含主动 index 诊断（`git status --porcelain` 验证）+ 修复（删除损坏 index + `git reset --mixed HEAD` 重建）。删除 index 前检查 `runningTaskTypes.size === 0` 确认无并发任务
- `runSecurityCheck`（publish.service.ts）：10 项安全校验（分支名前缀、文件白名单、禁止路径、MDX 路径、PR 冲突、权限等）
- `githubApi`（publish.service.ts）：GitHub REST API 封装（内置 https 模块，无新依赖）
- `getPublishDetail`（publish.service.ts）：查询管道进度
- Git Controller 路由：`POST /api/git/publish-website`、`GET /api/git/:taskId/pipeline`

### 数据库变更

publish_tasks 表新增 13 个字段：pr_url、pr_number、pr_created_at、merge_status、pr_merged_at、merge_commit_sha、deploy_status、workflow_run_id、deploy_url、deployed_at、security_check_result、security_check_errors、deploy_error_message

### 安全校验规则

分支名必须以 help-center-sync/ 开头；文件必须全部在白名单路径（docs/、i18n/、static/img/help-center/、static/files/help-center/）；禁止包含 src/、package.json、.github/、blog/；MDX 资源路径不得包含 /my-website/ 前缀；PR 必须无冲突；仅 super_admin/publish_admin 可触发

### 前端改造

- "发布到网站"按钮（管理员可见，primary 风格）
- PipelineDialog 组件：6 步进度条 + PR 链接 + Actions 链接 + 公开 URL
- 任务列表新增 PR 链接和"访问网站"快捷按钮
- PublishStats 新增"发布到网站"统计卡片（6 列网格）
- content_editor 不可见"发布到网站"按钮

### V2 端到端验收结果（2026-06-22）

| 验证项 | 结果 |
|--------|------|
| 6 步管道（build→gitPush→prCreate→securityCheck→merge→deploy） | 全部 success |
| PR 创建 | PR #8 (https://github.com/keaton1167/my-website/pull/8) |
| 安全校验 | passed |
| 自动合并 | merge_commit: 9f0448f4, merged_at: 2026-06-21T20:16:13Z |
| GitHub Pages 部署 | workflow_run: 27916227192 |
| 公开文档 HTTP 200 | 19669 bytes |
| 唯一标识 AUTO-PR-MERGE-V2-VERIFY-20260622-001 | 可见 |
| 匿名访问安全拦截 | 400 拒绝（平台中间件） |

### 本轮修复项

- `git config core.fileMode false`：消除沙箱文件权限差异导致的 41 个 mode-only 变更
- 移除 `HTTPS_PROXY: ''` / `HTTP_PROXY: ''`：恢复沙箱代理配置，使 git fetch/push 可通过代理访问 GitHub
- `.docusaurus` + webpack 缓存清理：构建前自动清理，避免旧缓存导致构建失败
- `git read-tree HEAD`：修复 stash pop 后 index 损坏问题
- `git fetch` 超时从 30s → 120s：适配网络波动场景

### 下一阶段建议

1. 飞书真实批量同步导入
2. 运营 UI 批量上传文档
3. 公司服务器 / Nginx / 正式域名部署
4. 清理已合并的远程工作分支
5. 合并方式升级为 Squash Merge

## 附件预览功能（V1）

### 功能概述

帮助中心文档中嵌入的 PDF / PPTX / XLSX 附件，在页面内直接渲染预览，无需跳转下载。所有附件保留原文件名和下载入口，预览失败时自动降级为下载卡片。

### 架构设计

双端方案：管理后台通过 Streamdown 的 `a` 组件拦截，Docusaurus 预览通过客户端脚本增强。后端同步流程不变（飞书附件已下载到 `static/files/help-center/{slug}/` 目录）。

**管理后台组件**（Miaoda 前端）：

| 组件 | 路径 | 职责 |
|------|------|------|
| useFileData | business-ui/attachment-preview/use-file-data.ts | 通用文件数据获取 Hook，通过 axiosForBackend 加载 ArrayBuffer |
| PdfPreview | business-ui/attachment-preview/pdf-preview.tsx | PDF 内嵌预览（pdfjs-dist v3），自适应宽度，最多预览 5 页 |
| PptxPreview | business-ui/attachment-preview/pptx-preview.tsx | PPTX 幻灯片预览（pptx-preview），list 模式展示所有幻灯片 |
| XlsxPreview | business-ui/attachment-preview/xlsx-preview.tsx | Excel 表格预览（xlsx），最多展示前 10 行，支持多 Sheet 切换 |
| AttachmentPreview | business-ui/attachment-preview/attachment-preview.tsx | 调度组件，根据文件扩展名分发到对应预览器，unknown 类型显示下载卡片 |

**Docusaurus 增强脚本**：`client/src/utils/attachment-preview.js` 是纯 JS 实现，放置在 Docusaurus 项目的 `static/js/` 目录，通过 `docusaurus.config.js` 的 `scripts` 配置加载。脚本通过 MutationObserver 监听页面变化，自动检测文件链接并渲染预览卡片。预览库（pdf.js / pptx-preview / xlsx）从本地 `static/js/vendor/` 加载，不依赖外部 CDN。

**集成点**：
- `streamdown.tsx` 的 `a` 组件检测附件链接，使用 `React.lazy` + `Suspense` 懒加载渲染预览
- Docusaurus `docusaurus.config.js` 中 `scripts: ['/js/attachment-preview.js']` 加载增强脚本（Docusaurus 自动拼接 baseUrl）

**类型定义**：`shared/api.interface.ts` 中新增 `AttachmentPreviewType`、`AttachmentPreviewInfo`、`getAttachmentPreviewType()`、`isAttachmentFileUrl()` 等公共类型和工具函数。`isAttachmentFileUrl` 同时支持原始路径 `/files/help-center/` 和 Docusaurus 哈希路径 `/assets/files/...hash.ext`。

### Build 静态包交付标准

build.zip 部署到公司服务器后必须离线可用，不依赖外部 CDN、妙搭 API 或飞书接口。

- **Vendor 本地化**：4 个文件从 ODPM node_modules 复制到 `static/js/vendor/`（pdf.min.js 320K + pdf.worker.min.js 1.1M + pptx-preview.umd.js 1.3M + xlsx.full.min.js 881K，总计 ~3.6MB）
- **baseUrl 自适应**：脚本通过 `document.currentScript.src` 自动提取 baseUrl 前缀，适配 `/`、`/odpm/`、`/my-website/` 等任意部署路径
- **双层保障**：`syncDocsToProject` 末尾自动复制（复制后校验 size > 0，0 字节自动重复制，源文件异常则明确报错） → `prepareDocusaurusBuildConfig` 中 `ensureAttachmentPreviewAssets` build 前校验（existsSync + statSync size > 0）并补齐
- **scripts 注入**：`prepareDocusaurusBuildConfig` 自动检测并注入 `scripts: ['/js/attachment-preview.js']`
- **build 后验证**：`verifyBuildAssets` 检查 5 个文件存在性 + size > 0 + 无 CDN 引用 + index.html 包含脚本引用，覆盖测试环境/正式环境/草稿预览/构建检查/网站发布 5 个 build 场景
- **PPTX 缩略图降级**：pptx-preview 加载失败时查找同步阶段生成的 `thumbnail.jpeg` 展示缩略图 + 下载按钮

### 设计要点

- **双层组件架构**（Wrapper + Renderer）：外层管 loading/error，内层只在数据就绪后挂载，避免容器不可见时尺寸为 0 导致渲染异常
- **降级策略**：每个预览组件内置 fallback UI，显示"预览生成失败，请下载原文件查看" + 下载按钮
- **依赖**：`pdfjs-dist@^3`（禁止 v5）、`pptx-preview`、`xlsx`（已有）
- **Worker 配置**：pdfjs 必须配置 `GlobalWorkerOptions.workerSrc`，指向 `pdf.worker.min.js`（非 .mjs）
- **Vendor 更新**：升级预览库版本后需重新 build，vendor 文件随 build 产物一起分发

## UI 设计指南

> 具体 HSL / 字体栈 / 圆角值 / 间距值 / 阴影 / 动效时长落在 `tailwind-theme.css`。

### 设计命题

企业级文档管理工作台，沉稳专业，数据优先、状态清晰、操作直接、层级分明、克制简洁。

### 色彩方向

沉稳靛蓝（HSL 221/68%/48%），浅色主题，低饱和度，状态标签色彩+边框双识别。

### 形态与表面

圆角 sharp（0.375rem），无阴影，标准间距，轻量细边框，线性图标。

### 布局策略

Sidebar 左侧固定导航 + 右侧滚动内容区。统计卡片三列网格，表格分隔行，大屏限制最大宽度。

### 组件语法

- Card：纯色背景+细边框，数值突出，标签弱化
- Button：primary 主操作，outline 次操作，destructive 危险操作
- 表格：分隔线区分行，状态标签圆角边框+语义颜色
- 弹窗：高风险操作确认弹窗，标题说明风险
