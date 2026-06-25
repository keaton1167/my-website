import { request } from '@client/src/api';
import type { CreateResponse, PublishTaskListParams, PublishTaskListResponse, PublishStatsResponse, TaskLogsResponse, SuccessResponse, BuildCheckResponse, BuildCheckLogResponse, StagingPreCheckResponse, ProductionPreCheckResponse, GitCommitResponse, RollbackVersionsResponse, WebsitePublishResponse, PublishPipelineDetail, BuildArtifactResult, BuildScope, PublishScope, CreateRollbackRequest, PreviewStatusResponse } from '@shared/api.interface';

export async function getPublishStats(): Promise<PublishStatsResponse> {
  return request<PublishStatsResponse>({ url: '/api/publish-tasks/stats', method: 'GET' });
}

export async function getPublishTaskList(params?: PublishTaskListParams): Promise<PublishTaskListResponse> {
  return request<PublishTaskListResponse>({ url: '/api/publish-tasks', method: 'GET', params });
}

export async function triggerBuild(publishScope?: PublishScope): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/docusaurus/build', method: 'POST', data: { publishScope } });
}

export async function deployStaging(publishScope?: PublishScope): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/deploy/staging', method: 'POST', data: { publishScope } });
}

export async function precheckStaging(): Promise<StagingPreCheckResponse> {
  return request<StagingPreCheckResponse>({ url: '/api/deploy/staging/precheck', method: 'GET' });
}

export async function precheckProduction(): Promise<ProductionPreCheckResponse> {
  return request<ProductionPreCheckResponse>({ url: '/api/deploy/production/precheck', method: 'GET' });
}

export async function deployProduction(publishScope?: PublishScope): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/deploy/production', method: 'POST', data: { publishScope } });
}

export async function getTaskLogs(taskId: string): Promise<TaskLogsResponse> {
  return request<TaskLogsResponse>({ url: `/api/tasks/${taskId}/logs`, method: 'GET' });
}

export async function retryTask(taskId: string): Promise<CreateResponse> {
  return request<CreateResponse>({ url: `/api/publish-tasks/${taskId}/retry`, method: 'POST' });
}

export async function rollback(params: CreateRollbackRequest): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/deploy/rollback', method: 'POST', data: params });
}

export async function getRollbackVersions(): Promise<RollbackVersionsResponse> {
  return request<RollbackVersionsResponse>({ url: '/api/deploy/rollback/versions', method: 'GET' });
}

export async function triggerBuildCheck(scope?: PublishScope): Promise<BuildCheckResponse> {
  return request<BuildCheckResponse>({ url: '/api/help-center/build-check', method: 'POST', data: { scope } });
}

export async function getBuildCheckLogs(taskId: string): Promise<BuildCheckLogResponse> {
  return request<BuildCheckLogResponse>({ url: `/api/help-center/build-check/${taskId}/logs`, method: 'GET' });
}

export async function triggerGitCommit(scope?: PublishScope, mappingId?: string): Promise<GitCommitResponse> {
  return request<GitCommitResponse>({ url: '/api/git/commit-push', method: 'POST', data: { scope, mappingId } });
}

export async function getGitCommitLogs(taskId: string): Promise<BuildCheckLogResponse> {
  return request<BuildCheckLogResponse>({ url: `/api/git/${taskId}/logs`, method: 'GET' });
}

export async function triggerWebsitePublish(
  scope?: PublishScope,
  options?: {
    previewOnly?: boolean;
    buildScope?: 'publishedOnly' | 'releaseCandidate';
    forceConfig?: { url: string; baseUrl: string };
  },
): Promise<WebsitePublishResponse> {
  return request<WebsitePublishResponse>({
    url: '/api/git/publish-website',
    method: 'POST',
    data: { scope, ...options },
  });
}

export async function getPublishPipeline(taskId: string): Promise<PublishPipelineDetail> {
  return request<PublishPipelineDetail>({ url: `/api/git/${taskId}/pipeline`, method: 'GET' });
}

export async function getPreviewStatus(): Promise<PreviewStatusResponse> {
  return request<PreviewStatusResponse>({ url: '/api/preview/help-center/status', method: 'GET' });
}

export async function deployDraftPreview(): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/deploy/draft-preview', method: 'POST' });
}

export async function getRunningTasks(): Promise<string[]> {
  return request<string[]>({ url: '/api/deploy/running-tasks', method: 'GET' });
}

export async function triggerBuildArtifact(scope?: BuildScope): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/deploy/build-artifact', method: 'POST', data: { scope } });
}

export async function getBuildArtifactStorageUrl(taskId?: string): Promise<string> {
  const params = taskId ? { taskId } : undefined;
  const result = await request<{ downloadUrl: string }>({
    url: '/api/deploy/build-artifact/storage-url',
    method: 'GET',
    params,
  });
  return result.downloadUrl;
}

export async function downloadBuildArtifact(taskId?: string): Promise<void> {
  const storageUrl = await getBuildArtifactStorageUrl(taskId);
  const a = document.createElement('a');
  a.href = storageUrl;
  a.download = taskId ? `odpm-help-center-build-${taskId.slice(0, 8)}.zip` : 'odpm-help-center-build.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function getPreviewRenderedHtml(previewPath: string): Promise<string> {
  const cleanPath = previewPath.replace(/^\/api\/preview\/help-center\/?/, '').replace(/\/+$/, '');
  const url = cleanPath
    ? `/api/preview/help-center/render/${cleanPath}`
    : '/api/preview/help-center/render/index.html';
  const result = await request<{ html: string }>({ url, method: 'GET' });
  return result.html;
}
