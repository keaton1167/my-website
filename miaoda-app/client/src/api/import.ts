import { request } from '@client/src/api';
import type { ImportFeishuRequest, ImportFeishuResponse } from '@shared/api.interface';

export async function importFeishuDoc(body: ImportFeishuRequest): Promise<ImportFeishuResponse> {
  return request<ImportFeishuResponse>({ url: '/api/import/feishu-doc', method: 'POST', data: body });
}
