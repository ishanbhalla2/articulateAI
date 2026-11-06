import { MAX_MEDIA_BYTES, UPLOAD_CHUNK_BYTES } from '../../../shared/domain';
import { api } from './api';

export interface UploadResult {
  mediaPath: string;
  partCount: number;
}

const MAX_ATTEMPTS = 3;

// The Apps proxy cuts requests off at 120s, so large media goes up as numbered parts that prepare_media joins.
export async function uploadMedia(
  blob: Blob,
  sessionId: string,
  mediaId: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  if (blob.size === 0) throw new Error('The recording is empty.');
  if (blob.size > MAX_MEDIA_BYTES) throw new Error('Files over 2 GB are not supported. Trim or compress the recording first.');

  const mediaPath = `raw/${sessionId}/${mediaId}`;
  const partCount = Math.ceil(blob.size / UPLOAD_CHUNK_BYTES);
  for (let i = 0; i < partCount; i++) {
    const chunk = blob.slice(i * UPLOAD_CHUNK_BYTES, (i + 1) * UPLOAD_CHUNK_BYTES);
    const partPath = `${mediaPath}/part-${String(i + 1).padStart(5, '0')}`;
    for (let attempt = 1; ; attempt++) {
      try {
        await api(`/api/files/files/upload?path=${encodeURIComponent(partPath)}`, { method: 'POST', body: chunk, signal });
        break;
      } catch (err) {
        if (signal?.aborted || attempt >= MAX_ATTEMPTS) throw err;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    onProgress((i + 1) / partCount);
  }
  return { mediaPath, partCount };
}

export function mediaTypeOf(mime: string): 'audio' | 'video' | null {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

export function probeDuration(blob: Blob, kind: 'audio' | 'video'): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(blob);
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}
