import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, ArrowRight, Camera, ImagePlus, Images, Trash2 } from 'lucide-react-native';
import { Banner, Button, Dialog, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, Sheet, StatusPill, Text, useToast } from '@/components/design-system';
import { useListingPhotos } from '@/features/listings/useListingPhotos';
import { formatBytes } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { buildObjectPath, uploadPrivateFile } from '@/providers/storage/private-upload';
import { listingManagementRepository, type ListingImage } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const MAX_PHOTOS = 8;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Listing photos: upload (private bucket), reorder (first = cover), remove (plan Phase 6). */
export default function ListingPhotos() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const listing = useAsync(() => listingManagementRepository.get(id), [id]);
  const images = listing.data?.images ?? [];
  const urls = useListingPhotos(images.map((i) => i.path));
  const [sheet, setSheet] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ListingImage | null>(null);

  const add = async (source: 'camera' | 'library') => {
    setSheet(false);
    setError(null);
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError('Camera access is off. Allow it in Settings, or choose from photos.');
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [4, 3] };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = res.canceled ? null : res.assets[0];
    if (!a) return;
    const mime = (a.mimeType ?? 'image/jpeg').toLowerCase();
    if (!TYPES.includes(mime)) return setError('Use a JPG, PNG or WebP photo.');
    if (a.fileSize && a.fileSize > MAX_BYTES) return setError(`That photo is ${formatBytes(a.fileSize)}. The limit is 5 MB.`);
    setProgress(0);
    const up = await uploadPrivateFile({ bucket: 'listing-images', path: buildObjectPath(id, mime), uri: a.uri, mimeType: mime, onProgress: setProgress }).promise;
    if (!up.ok) {
      setProgress(null);
      return setError(up.error.message);
    }
    const r = await listingManagementRepository.addImage(id, up.data.path);
    setProgress(null);
    if (!r.ok) return setError(r.error.message);
    toast.show({ title: 'Photo added', tone: 'success' });
    void listing.reload();
  };

  const move = async (index: number, delta: -1 | 1) => {
    const ids = images.map((i) => i.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    setBusy(true);
    const r = await listingManagementRepository.reorderImages(id, ids);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    void listing.reload();
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const r = await listingManagementRepository.removeImage(removing.id);
    setBusy(false);
    setRemoving(null);
    if (!r.ok) return setError(r.error.message);
    void listing.reload();
  };

  const full = images.length >= MAX_PHOTOS;

  return (
    <Screen
      footer={
        <Button
          label={progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : 'Add photo'}
          icon={ImagePlus}
          onPress={() => setSheet(true)}
          loading={progress !== null}
          disabled={full || listing.data?.status === 'removed'}
          disabledReason={full ? `A listing can have up to ${MAX_PHOTOS} photos.` : undefined}
          fullWidth
          testID="photos-add"
        />
      }
    >
      <ScreenHeader title="Photos" size="compact" back />
      {error ? <Banner tone="danger" title="Something went wrong" message={error} onDismiss={() => setError(null)} /> : null}
      {listing.error ? (
        <ErrorState offline={listing.error.kind === 'network'} message={listing.error.message} onRetry={listing.reload} />
      ) : !listing.data ? (
        <LoadingRows rows={2} />
      ) : (
        <View style={styles.body}>
          <Text variant="callout" tone="muted">Clear, well-lit photos help students trust your listing. The first photo is the cover. Photos are stored privately and shown only to verified students.</Text>
          {images.length === 0 ? <Banner tone="warning" title="Add at least one photo to publish." /> : null}
          <View style={styles.grid}>
            {images.map((img, i) => (
              <View key={img.id} style={styles.cell} testID={`photo-${i}`}>
                {urls.data?.[img.path] ? (
                  <Image source={{ uri: urls.data[img.path] }} style={styles.photo} contentFit="cover" accessibilityLabel={`Photo ${i + 1}${i === 0 ? ', cover' : ''}`} />
                ) : (
                  <View style={styles.photo} />
                )}
                <View style={styles.cellBar}>
                  {i === 0 ? <StatusPill label="Cover" tone="info" /> : <Text variant="caption" tone="muted">#{i + 1}</Text>}
                  <View style={styles.cellActions}>
                    <Button label="Move earlier" variant="ghost" size="sm" icon={ArrowLeft} onPress={() => void move(i, -1)} disabled={i === 0 || busy} />
                    <Button label="Move later" variant="ghost" size="sm" icon={ArrowRight} onPress={() => void move(i, 1)} disabled={i === images.length - 1 || busy} />
                    <Button label="Remove" variant="ghost" size="sm" icon={Trash2} onPress={() => setRemoving(img)} disabled={busy} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Add a photo" description="JPG, PNG or WebP, up to 5 MB.">
        <ListRow title="Take a photo" icon={Camera} onPress={() => void add('camera')} />
        <ListRow title="Choose from photos" icon={Images} onPress={() => void add('library')} />
      </Sheet>
      <Dialog
        visible={removing !== null}
        title="Remove this photo?"
        message="It will be deleted from this listing."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  grid: { gap: spacing.md },
  cell: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surfaceSunken },
  cellBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.sm, gap: spacing.sm },
  cellActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1 },
});
