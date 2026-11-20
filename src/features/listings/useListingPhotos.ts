import { useAsync } from '@/lib/use-async';
import { ok } from '@/lib/errors';
import { signedListingImageUrls } from '@/repositories';

/** Signed URLs (1 h) for private listing photos, keyed by storage path. */
export function useListingPhotos(paths: (string | null | undefined)[]) {
  const clean = paths.filter((p): p is string => Boolean(p));
  return useAsync(() => (clean.length ? signedListingImageUrls(clean) : Promise.resolve(ok<Record<string, string>>({}))), [clean.join('|')]);
}
