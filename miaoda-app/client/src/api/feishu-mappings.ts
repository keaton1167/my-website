import { request } from '@client/src/api';
import type {
  ImportFeishuRequest,
  ImportFeishuResponse,
  FeishuMappingListParams,
  FeishuMappingListResponse,
  FeishuMappingStatistics,
  CreateFeishuMappingRequest,
  UpdateFeishuMappingRequest,
  BatchSyncRequest,
  BatchActionResponse,
  BatchCreateFeishuMappingRequest,
  BatchCreateFeishuMappingResponse,
  FeishuSyncLogListResponse,
  PreviewMarkdownResponse,
  DrivePermissionCheckResponse,
  RetryResourcesResponse,
  SuccessResponse,
  CreateResponse,
  WikiDiagnoseRequest,
  WikiDiagnoseResponse,
  WikiPreviewTreeRequest,
  WikiPreviewTreeResponse,
  WikiImportRequest,
  WikiImportResponse,
  WikiListSpacesResponse,
  ResourceRepairResult,
  RepairImagesRequest,
} from '@shared/api.interface';

export async function importFeishuDoc(body: ImportFeishuRequest): Promise<ImportFeishuResponse> {
  return request<ImportFeishuResponse>({ url: '/api/import/feishu-doc', method: 'POST', data: body });
}

export async function getMappingStatistics(): Promise<FeishuMappingStatistics> {
  return request<FeishuMappingStatistics>({ url: '/api/feishu-doc-mappings/statistics', method: 'GET' });
}

export async function getMappingList(params?: FeishuMappingListParams): Promise<FeishuMappingListResponse> {
  return request<FeishuMappingListResponse>({ url: '/api/feishu-doc-mappings', method: 'GET', params });
}

export async function createMapping(body: CreateFeishuMappingRequest): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/feishu-doc-mappings/create', method: 'POST', data: body });
}

export async function batchCreateMapping(body: BatchCreateFeishuMappingRequest): Promise<BatchCreateFeishuMappingResponse> {
  return request<BatchCreateFeishuMappingResponse>({ url: '/api/feishu-doc-mappings/batch-create', method: 'POST', data: body });
}

export async function updateMapping(body: UpdateFeishuMappingRequest & { id: string }): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: '/api/feishu-doc-mappings/update', method: 'POST', data: body });
}

export async function deleteMapping(id: string): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: '/api/feishu-doc-mappings/delete', method: 'POST', data: { id } });
}

export async function syncOne(id: string): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/feishu-doc-mappings/sync-one', method: 'POST', data: { id } });
}

export async function syncBatch(body: BatchSyncRequest): Promise<BatchActionResponse> {
  return request<BatchActionResponse>({ url: '/api/feishu-doc-mappings/sync-batch', method: 'POST', data: body });
}

export async function getSyncLogs(mappingId: string): Promise<FeishuSyncLogListResponse> {
  return request<FeishuSyncLogListResponse>({ url: `/api/feishu-doc-mappings/${mappingId}/logs`, method: 'GET' });
}

export async function previewMarkdown(id: string): Promise<PreviewMarkdownResponse> {
  return request<PreviewMarkdownResponse>({ url: '/api/feishu-doc-mappings/preview-markdown', method: 'POST', data: { id } });
}

export async function checkDrivePermission(id: string): Promise<DrivePermissionCheckResponse> {
  return request<DrivePermissionCheckResponse>({ url: '/api/feishu-doc-mappings/check-drive-permission', method: 'POST', data: { id } });
}

export async function retryResources(id: string): Promise<RetryResourcesResponse> {
  return request<RetryResourcesResponse>({ url: '/api/feishu-doc-mappings/retry-resources', method: 'POST', data: { id } });
}

export async function wikiListSpaces(): Promise<WikiListSpacesResponse> {
  return request<WikiListSpacesResponse>({ url: '/api/feishu-doc-mappings/wiki/list-spaces', method: 'GET' });
}

export async function wikiDiagnose(body: WikiDiagnoseRequest): Promise<WikiDiagnoseResponse> {
  return request<WikiDiagnoseResponse>({ url: '/api/feishu-doc-mappings/wiki/diagnose', method: 'POST', data: body });
}

export async function wikiPreviewTree(body: WikiPreviewTreeRequest): Promise<WikiPreviewTreeResponse> {
  return request<WikiPreviewTreeResponse>({ url: '/api/feishu-doc-mappings/wiki/preview-tree', method: 'POST', data: body });
}

export async function wikiImport(body: WikiImportRequest): Promise<WikiImportResponse> {
  return request<WikiImportResponse>({ url: '/api/feishu-doc-mappings/wiki/import', method: 'POST', data: body });
}

export async function repairMissingImages(ids: string[]): Promise<ResourceRepairResult[]> {
  const body: RepairImagesRequest = { ids };
  return request<ResourceRepairResult[]>({ url: '/api/feishu-doc-mappings/repair-images', method: 'POST', data: body });
}
