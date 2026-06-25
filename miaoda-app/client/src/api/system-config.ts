import { request } from '@client/src/api';
import type {
  SystemConfigResponse,
  UpdateSystemConfigRequest,
  CheckConnectionRequest,
  CheckConnectionResponse,
} from '@shared/api.interface';

export async function getSystemConfig(): Promise<SystemConfigResponse> {
  return request<SystemConfigResponse>({ url: '/api/system-config', method: 'GET' });
}

export async function updateSystemConfig(data: UpdateSystemConfigRequest): Promise<{ success: boolean; message: string }> {
  return request<{ success: boolean; message: string }>({ url: '/api/system-config', method: 'PATCH', data });
}

export async function checkConnection(data: CheckConnectionRequest): Promise<CheckConnectionResponse> {
  return request<CheckConnectionResponse>({ url: '/api/system-config/check-connection', method: 'POST', data });
}
