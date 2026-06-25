import { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

interface UseFileDataResult {
  data: ArrayBuffer | null;
  loading: boolean;
  error: string | null;
}

export function useFileData(url: string): UseFileDataResult {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    axiosForBackend({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      signal: controller.signal,
    })
      .then((res) => setData(res.data as ArrayBuffer))
      .catch((err: Error & { name?: string }) => {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
          setError(err.message || '文件加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [url]);

  return { data, loading, error };
}
