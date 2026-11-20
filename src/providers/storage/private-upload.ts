/**
 * Private file upload with progress and cancel (plan Phase 4: "upload, preview, validation, progress,
 * retry, and removal"). supabase-js uploads expose no progress, so this posts to the same Storage
 * endpoint with XMLHttpRequest. Paths are generated: user-supplied filenames never reach storage.
 */
import { AppError, fail, ok, type Result } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import { validateEnv } from '@/lib/env';

export type PrivateBucket = 'verification-docs' | 'avatars' | 'listing-images' | 'evidence';

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

export function extensionFor(mime: string): string | null {
  return EXT[mime.toLowerCase()] ?? null;
}

/** e.g. "{folder}/1763452800000-k3j9x2.pdf". Only the folder (an id) and a random name. */
export function buildObjectPath(folder: string, mime: string, now: number = Date.now(), rand: string = Math.random().toString(36).slice(2, 8)): string {
  const ext = extensionFor(mime);
  if (!ext) throw new RangeError(`Unsupported file type: ${mime}`);
  if (!/^[0-9a-f-]{36}(\/[0-9a-f-]{36})?$/i.test(folder)) throw new RangeError('Storage folders must be ids.');
  return `${folder}/${now}-${rand.replace(/[^a-z0-9]/gi, '')}.${ext}`;
}

export type UploadHandle = { promise: Promise<Result<{ path: string }>>; cancel: () => void };

type UploadArgs = {
  bucket: PrivateBucket;
  path: string;
  uri: string;
  mimeType: string;
  onProgress?: (fraction: number) => void;
};

function storageError(status: number, body: string): AppError {
  let message = '';
  try {
    message = (JSON.parse(body) as { message?: string }).message ?? '';
  } catch {
    // non-JSON body
  }
  if (status === 413 || /exceeded the maximum allowed size/i.test(message)) return new AppError('validation', 'The file is too large.', 'file_too_large');
  if (/mime type/i.test(message)) return new AppError('validation', 'That file type isn’t allowed.', 'file_type');
  if (status === 409 || /already exists/i.test(message)) return new AppError('conflict', 'A file with this name already exists. Try again.', 'file_exists');
  if (status === 401) return new AppError('unauthenticated', 'Your session has expired. Please sign in again.');
  if (status === 403 || /row-level security/i.test(message)) return new AppError('forbidden', 'You can’t upload to this location.');
  return new AppError('unknown', 'The upload failed. Please try again.', String(status));
}

export function uploadPrivateFile({ bucket, path, uri, mimeType, onProgress }: UploadArgs): UploadHandle {
  const xhr = new XMLHttpRequest();
  let cancelled = false;

  const promise = (async (): Promise<Result<{ path: string }>> => {
    const env = validateEnv();
    if (!env.ok) return fail(new AppError('config', env.issues.join(' ')));
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return fail(new AppError('unauthenticated', 'Please sign in again to upload.'));

    let body: Blob;
    try {
      body = await (await fetch(uri)).blob();
    } catch {
      return fail(new AppError('validation', 'We couldn’t read that file. Choose it again.', 'file_unreadable'));
    }
    if (cancelled) return fail(new AppError('unknown', 'Upload cancelled.', 'cancelled'));

    return new Promise((resolve) => {
      xhr.open('POST', `${env.env.supabaseUrl}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', env.env.supabasePublishableKey);
      xhr.setRequestHeader('Content-Type', mimeType);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('cache-control', 'max-age=3600');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(1);
          resolve(ok({ path }));
        } else {
          resolve(fail(storageError(xhr.status, xhr.responseText)));
        }
      };
      xhr.onerror = () => resolve(fail(new AppError('network', 'The upload was interrupted. Check your connection and retry.')));
      xhr.onabort = () => resolve(fail(new AppError('unknown', 'Upload cancelled.', 'cancelled')));
      xhr.send(body);
    });
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      try {
        xhr.abort();
      } catch {
        // not started yet
      }
    },
  };
}

/** Removes an object the user still owns (e.g. a document replaced before submission). */
export async function removePrivateFile(bucket: PrivateBucket, path: string): Promise<Result<void>> {
  try {
    const { error } = await getSupabase().storage.from(bucket).remove([path]);
    return error ? fail(new AppError('unknown', 'The file couldn’t be removed.')) : ok(undefined);
  } catch {
    return fail(new AppError('network', 'You appear to be offline.'));
  }
}

/** Short-lived signed URL for authorized viewers (plan §6.5). */
export async function signedUrlFor(bucket: PrivateBucket, path: string, ttlSeconds = 300): Promise<Result<string>> {
  try {
    const { data, error } = await getSupabase().storage.from(bucket).createSignedUrl(path, ttlSeconds);
    if (error || !data?.signedUrl) return fail(new AppError('forbidden', 'This document isn’t available to you.'));
    return ok(data.signedUrl);
  } catch {
    return fail(new AppError('network', 'You appear to be offline.'));
  }
}
