import { request } from '@client/src/api';
import type {
  DocItem,
  DocDetailResponse,
  DocStatistics,
  DocListResponse,
  DocListParams,
  CreateDocRequest,
  UpdateDocRequest,
  MoveDocRequest,
  BatchActionRequest,
  BatchActionResponse,
  SuccessResponse,
  CreateResponse,
  PreviewPathParams,
  PreviewPathResponse,
} from '@shared/api.interface';

export async function getStatistics(): Promise<DocStatistics> {
  return request<DocStatistics>({ url: '/api/documents/statistics', method: 'GET' });
}

export async function getDocList(params?: DocListParams): Promise<DocListResponse> {
  return request<DocListResponse>({ url: '/api/documents', method: 'GET', params });
}

export async function createDoc(body: CreateDocRequest): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/documents', method: 'POST', data: body });
}

export async function updateDoc(id: string, body: UpdateDocRequest): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/documents/${id}`, method: 'PUT', data: body });
}

export async function submitReview(id: string): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/documents/${id}/submit-review`, method: 'PATCH' });
}

export async function deleteDoc(id: string): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/documents/${id}`, method: 'DELETE' });
}

export async function moveDoc(id: string, body: MoveDocRequest): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/documents/${id}/move`, method: 'PATCH', data: body });
}

export async function batchSubmitReview(body: BatchActionRequest): Promise<BatchActionResponse> {
  return request<BatchActionResponse>({ url: '/api/documents/batch-submit-review', method: 'POST', data: body });
}

export async function batchMove(body: BatchActionRequest): Promise<BatchActionResponse> {
  return request<BatchActionResponse>({ url: '/api/documents/batch-move', method: 'POST', data: body });
}

export async function batchDelete(body: BatchActionRequest): Promise<BatchActionResponse> {
  return request<BatchActionResponse>({ url: '/api/documents/batch-delete', method: 'POST', data: body });
}

export async function approveDoc(id: string): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/documents/${id}/approve`, method: 'POST' });
}

export async function rejectDoc(id: string): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/documents/${id}/reject`, method: 'POST' });
}

export async function batchApprove(body: BatchActionRequest): Promise<BatchActionResponse> {
  return request<BatchActionResponse>({ url: '/api/documents/batch-approve', method: 'POST', data: body });
}

export async function batchReject(body: BatchActionRequest): Promise<BatchActionResponse> {
  return request<BatchActionResponse>({ url: '/api/documents/batch-reject', method: 'POST', data: body });
}

export async function previewPath(params: PreviewPathParams): Promise<PreviewPathResponse> {
  return request<PreviewPathResponse>({ url: '/api/documents/preview-path', method: 'GET', params });
}

export async function archiveDoc(id: string): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/documents/${id}/archive`, method: 'POST' });
}

export async function getDocumentDetail(id: string): Promise<DocDetailResponse> {
  return request<DocDetailResponse>({ url: `/api/documents/${id}`, method: 'GET' });
}

export async function scanPptxPollution(): Promise<import('@shared/api.interface').PptxPollutionScanResult> {
  return request<import('@shared/api.interface').PptxPollutionScanResult>({ url: '/api/documents/scan-pptx-pollution', method: 'GET' });
}
