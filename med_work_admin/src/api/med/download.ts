/**
 * 文件下载（GET 流式响应 → 浏览器下载）。
 * 手动附加 Bearer 令牌；文件名优先取 Content-Disposition，失败用 fallbackName。
 */
import { useAccessStore } from '@vben/stores';

import { ElMessage } from 'element-plus';

export async function downloadFile(
  path: string,
  fallbackName = 'download.bin',
): Promise<void> {
  const token = useAccessStore().accessToken;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(path, { headers });
  } catch {
    ElMessage.error('无法连接服务器，请确认后端服务已启动');
    throw new Error('下载失败');
  }

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as {
        detail?: string;
        message?: string;
      };
      message = payload.message || payload.detail || message;
    } catch {
      /* 响应体非 JSON，沿用默认文案 */
    }
    ElMessage.error(message);
    throw new Error(message);
  }

  const blob = await response.blob();
  let filename = fallbackName;
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const star = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star) {
    filename = decodeURIComponent(star[1] as string);
  } else {
    const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
    if (plain) filename = plain[1] as string;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
