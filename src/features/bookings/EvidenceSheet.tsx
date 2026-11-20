import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImagePlus, X } from 'lucide-react-native';
import { Banner, Button, Icon, Sheet, Text, TextField } from '@/components/design-system';
import { formatBytes } from '@/lib/format';
import { buildObjectPath, uploadPrivateFile } from '@/providers/storage/private-upload';
import { colors, radii, spacing } from '@/theme';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS = 4;

type Photo = { uri: string; path: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  description: string;
  notesLabel: string;
  notesPlaceholder?: string;
  submitLabel: string;
  /** Private evidence folder: evidence/{bookingId}/{userId}/… (parties and staff only). */
  bookingId: string;
  userId: string;
  /** Returns an error message to show, or null on success. */
  onSubmit: (notes: string, photoPaths: string[]) => Promise<string | null>;
  /** Extra fields shown above the notes (e.g. outcome and claim amount for a problem report). */
  children?: ReactNode;
  /** Defaults to true. */
  allowPhotos?: boolean;
  submitVariant?: 'primary' | 'danger';
  testID?: string;
};

/**
 * Condition notes and optional photos for handover, return and inspection (plan Phase 9). Photos go to
 * the private `evidence` bucket and are only visible to the two parties and TigRent staff.
 */
export function EvidenceSheet(p: Props) {
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const add = async (source: 'camera' | 'library') => {
    setError(null);
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError('Camera access is off. Allow it in Settings, or choose from photos.');
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = res.canceled ? null : res.assets[0];
    if (!a) return;
    const mime = (a.mimeType ?? 'image/jpeg').toLowerCase();
    if (!TYPES.includes(mime)) return setError('Use a JPG, PNG or WebP photo.');
    if (a.fileSize && a.fileSize > MAX_BYTES) return setError(`That photo is ${formatBytes(a.fileSize)}. The limit is 10 MB.`);
    setProgress(0);
    const up = await uploadPrivateFile({ bucket: 'evidence', path: buildObjectPath(`${p.bookingId}/${p.userId}`, mime), uri: a.uri, mimeType: mime, onProgress: setProgress }).promise;
    setProgress(null);
    if (!up.ok) return setError(up.error.message);
    setPhotos((list) => [...list, { uri: a.uri, path: up.data.path }]);
  };

  const submit = async () => {
    if (submitting || progress !== null) return;
    if (notes.length > 1000) return setError('Keep notes under 1,000 characters.');
    setSubmitting(true);
    setError(null);
    const problem = await p.onSubmit(notes, photos.map((x) => x.path));
    setSubmitting(false);
    if (problem) return setError(problem);
    setNotes('');
    setPhotos([]);
  };

  return (
    <Sheet
      visible={p.visible}
      onClose={p.onClose}
      title={p.title}
      description={p.description}
      testID={p.testID}
      footer={<Button label={p.submitLabel} variant={p.submitVariant ?? 'primary'} fullWidth loading={submitting} disabled={progress !== null} disabledReason={progress !== null ? 'Wait for the photo to finish uploading.' : undefined} onPress={submit} testID={`${p.testID ?? 'evidence'}-submit`} />}
    >
      <View style={styles.body}>
        {p.children}
        <TextField label={p.notesLabel} value={notes} onChangeText={setNotes} multiline maxLength={1000} placeholder={p.notesPlaceholder} testID={`${p.testID ?? 'evidence'}-notes`} />
        {p.allowPhotos === false ? null : (<>
        <Text variant="headline">Photos (optional)</Text>
        <Text variant="footnote" tone="muted">Up to {MAX_PHOTOS}. Kept private: only you, the other party and TigRent staff can see them.</Text>
        <View style={styles.photos}>
          {photos.map((ph) => (
            <View key={ph.path} style={styles.thumb}>
              <Image source={{ uri: ph.uri }} style={styles.thumbImage} contentFit="cover" accessibilityLabel="Attached photo" />
              <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" hitSlop={8} onPress={() => setPhotos((l) => l.filter((x) => x.path !== ph.path))} style={styles.remove}>
                <Icon as={X} size="sm" color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
        </View>
        {photos.length < MAX_PHOTOS ? (
          <View style={styles.row}>
            <Button label="Take photo" variant="secondary" size="sm" icon={Camera} onPress={() => void add('camera')} disabled={progress !== null} style={styles.flex} />
            <Button label="Choose photo" variant="secondary" size="sm" icon={ImagePlus} onPress={() => void add('library')} disabled={progress !== null} style={styles.flex} />
          </View>
        ) : null}
        {progress !== null ? <Text variant="footnote" tone="muted" accessibilityLiveRegion="polite">Uploading… {Math.round(progress * 100)}%</Text> : null}
        </>)}
        {error ? <Banner tone="danger" title="Not saved" message={error} /> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surfaceSunken },
  thumbImage: { width: '100%', height: '100%' },
  remove: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radii.pill, padding: 2 },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
