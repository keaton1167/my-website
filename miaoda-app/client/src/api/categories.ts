import { request } from '@client/src/api';
import type { CategoryItem, CategoryOption, CategoryListResponse, CategoryListParams, CreateCategoryRequest, UpdateCategoryRequest, ToggleCategoryStatusRequest, UpdateCategoryOrderRequest, SuccessResponse, CreateResponse, CategoryDependenciesResponse } from '@shared/api.interface';

export async function getCategoryList(params?: CategoryListParams): Promise<CategoryListResponse> {
  return request<CategoryListResponse>({ url: '/api/categories', method: 'GET', params });
}

export async function getCategoryOptions(enabled?: boolean): Promise<{ items: CategoryOption[] }> {
  return request<{ items: CategoryOption[] }>({ url: '/api/categories/options', method: 'GET', params: enabled !== undefined ? { enabled } : undefined });
}

export async function createCategory(body: CreateCategoryRequest): Promise<CreateResponse> {
  return request<CreateResponse>({ url: '/api/categories', method: 'POST', data: body });
}

export async function updateCategory(id: string, body: UpdateCategoryRequest): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/categories/${id}`, method: 'PUT', data: body });
}

export async function toggleCategoryStatus(id: string, body: ToggleCategoryStatusRequest): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/categories/${id}/toggle-status`, method: 'PATCH', data: body });
}

export async function updateCategoryOrder(id: string, body: UpdateCategoryOrderRequest): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/categories/${id}/update-order`, method: 'PATCH', data: body });
}

export async function deleteCategory(id: string): Promise<SuccessResponse> {
  return request<SuccessResponse>({ url: `/api/categories/${id}`, method: 'DELETE' });
}

export async function checkCategoryDependencies(id: string): Promise<CategoryDependenciesResponse> {
  return request<CategoryDependenciesResponse>({ url: `/api/categories/${id}/dependencies`, method: 'GET' });
}
