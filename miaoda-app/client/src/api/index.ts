import { toast } from 'sonner';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { AxiosRequestConfig } from 'axios';

interface AxiosErrorResponse {
  response?: {
    status?: number;
    data?: {
      error?: {
        code?: string;
        message?: string;
      };
    };
  };
  message?: string;
}

function extractBackendMessage(err: AxiosErrorResponse): string | undefined {
  const response = err.response;
  if (response?.data?.error?.message) {
    return response.data.error.message;
  }
  const msg = err.message ?? '';
  const match = msg.match(/"返回数据"\s*:\s*(\{[\s\S]*?\})\s*[,}]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed?.error?.message) return parsed.error.message;
    } catch { /* ignore */ }
  }
  const jsonMatch = msg.match(/\{"error":\{[^}]*"message"\s*:\s*"([^"]+)"/);
  if (jsonMatch?.[1]) return jsonMatch[1];
  return undefined;
}

export async function request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await axiosForBackend(config);
    return response.data as T;
  } catch (err: unknown) {
    const axiosErr = err as AxiosErrorResponse;
    const status = axiosErr.response?.status;
    if (status === 403) {
      toast.error('无操作权限，请联系管理员分配角色');
      throw new Error('FORBIDDEN');
    }
    const backendMsg = extractBackendMessage(axiosErr);
    if (backendMsg) {
      throw new Error(backendMsg);
    }
    throw err;
  }
}

export * as dashboardApi from './dashboard';
export * as documentsApi from './documents';
export * as categoriesApi from './categories';
export * as importApi from './import';
export * as feishuMappingsApi from './feishu-mappings';
export * as publishApi from './publish';
export * as systemConfigApi from './system-config';
