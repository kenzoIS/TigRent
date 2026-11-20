import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Camera, CircleExclamationPoint, FileText, Images, Lock, RefreshCw, Upload, X } from 'lucide-react-native';
import { Button, Icon, ListRow, Sheet, StatusPill, Text } from '@/components/design-system';
import { formatBytes } from '@/lib/format';
import { buildObjectPath, removePrivateFile, uploadPrivateFile, type UploadHandle } from '@/providers/storage/private-upload';
import type { VerificationRules } from '@/repositories';
import { colors, radii, spacing } from '@/theme';
import { checkFile } from './validation';

export type UploadedDocument = { path: string; name: string; mimeType: string; size: number | null; previewUri: string };
type PickedFile = { uri: string; name: string; mimeType: string; size: number | null };

type Props = {
  userId: string;
  rules: VerificationRules;
  value: UploadedDocument | null;
  onChange: (doc: UploadedDocument | null) => void;
  error?: string | null;
  disabled?: boolean;
};

/** Private registration-form upload with pre-checks, progress, cancel, retry, preview and removal. */
export function DocumentField({ userId, rules, value, onChange, error, disabled }: Props) {
  const [sheet, setSheet] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastPick, setLastPick] = useState<PickedFile | null>(null);
  const [removing, setRemoving] = useState(false);
  const handle = useRef<UploadHandle | null>(null);

  const upload = async (file: PickedFile) => {
    setUploadError(null);
    const problem = checkFile(file, rules);
    if (problem) {
      setUploadError(problem);
      return;
    }
    setLastPick(file);
    setProgress(0);
    const h = uploadPrivateFile({
      bucket: 'verification-docs',
      path: buildObjectPath(userId, file.mimeType),
      uri: file.uri,
      mimeType: file.mimeType,
      onProgress: setProgress,
    });
    handle.current = h;
    const r = await h.promise;
    handle.current = null;
    setProgress(null);
    if (!r.ok) {
      if (r.error.code !== 'cancelled') setUploadError(r.error.message);
      return;
    }
    const previous = value;
    onChange({ path: r.data.path, name: file.name, mimeType: file.mimeType, size: file.size, previewUri: file.uri });
    // A replaced, never-submitted file is deleted so drafts don't accumulate.
    if (previous) void removePrivateFile('verification-docs', previous.path);
  };

  const pickDocument = async () => {
    setSheet(false);
    const res = await DocumentPicker.getDocumentAsync({ type: rules.mimeTypes, copyToCacheDirectory: true, multiple: false });
    const a = res.canceled ? null : res.assets[0];
    if (a) await upload({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? '', size: a.size ?? null });
  };

  const pickImage = async (source: 'camera' | 'library') => {
    setSheet(false);
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setUploadError('Camera access is off. Allow it in Settings, or choose a file instead.');
        return;
      }
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, allowsEditing: false };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = res.canceled ? null : res.assets[0];
    if (a) await upload({ uri: a.uri, name: a.fileName ?? 'registration-form.jpg', mimeType: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? null });
  };

  const remove = async () => {
    if (!value) return;
    setRemoving(true);
    await removePrivateFile('verification-docs', value.path);
    setRemoving(false);
    onChange(null);
  };

  const shownError = uploadError ?? error ?? null;
  const uploading = progress !== null;

  return (
    <View style={styles.wrap}>
      <Text variant="subhead" style={styles.label}>
        Registration form<Text variant="subhead" tone="muted">{'  '}Required</Text>
      </Text>

      {uploading ? (
        <View style={styles.card} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round((progress ?? 0) * 100) }}>
          <Text variant="callout" numberOfLines={1}>Uploading {lastPick?.name ?? 'file'}…</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round((progress ?? 0) * 100)}%` }]} />
          </View>
          <Button label="Cancel upload" variant="ghost" size="sm" onPress={() => handle.current?.cancel()} />
        </View>
      ) : value ? (
        <View style={[styles.card, styles.row]} testID="document-preview">
          {value.mimeType.startsWith('image/') ? (
            <Image source={{ uri: value.previewUri }} style={styles.thumb} contentFit="cover" accessibilityLabel="Preview of your registration form" />
          ) : (
            <View style={[styles.thumb, styles.pdf]}>
              <Icon as={FileText} size="lg" color={colors.link} />
            </View>
          )}
          <View style={styles.meta}>
            <Text variant="callout" numberOfLines={2}>{value.name}</Text>
            <Text variant="footnote" tone="muted">{[value.mimeType === 'application/pdf' ? 'PDF' : 'Image', value.size ? formatBytes(value.size) : null].filter(Boolean).join(' · ')}</Text>
            <StatusPill label="Stored privately" tone="success" icon={Lock} />
          </View>
          <View style={styles.actions}>
            <Button label="Replace" variant="ghost" size="sm" onPress={() => setSheet(true)} disabled={disabled} />
            <Button label="Remove" variant="ghost" size="sm" icon={X} onPress={remove} loading={removing} disabled={disabled} />
          </View>
        </View>
      ) : (
        <Button label="Add registration form" variant="secondary" icon={Upload} onPress={() => setSheet(true)} disabled={disabled} testID="document-add" />
      )}

      {shownError ? (
        <View style={styles.error} accessibilityLiveRegion="polite" role="alert">
          <Icon as={CircleExclamationPoint} size="sm" color={colors.danger} />
          <Text variant="footnote" tone="danger" style={styles.flex}>{shownError}</Text>
          {uploadError && lastPick && !uploading ? (
            <Button label="Retry" variant="ghost" size="sm" icon={RefreshCw} onPress={() => void upload(lastPick)} />
          ) : null}
        </View>
      ) : (
        <Text variant="footnote" tone="muted">
          PDF, JPG, PNG or HEIC up to {formatBytes(rules.maxBytes)}. Only you and TigRent reviewers can see it.
        </Text>
      )}

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Add your registration form" description="Use your current-term registration form.">
        <ListRow title="Choose a file" subtitle="PDF or image from your files" icon={FileText} onPress={pickDocument} />
        <ListRow title="Take a photo" subtitle="Lay the form flat in good light" icon={Camera} onPress={() => void pickImage('camera')} />
        <ListRow title="Choose from photos" icon={Images} onPress={() => void pickImage('library')} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs + 2 },
  label: { fontWeight: '500' },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 56, height: 72, borderRadius: radii.xs, backgroundColor: colors.surfaceSunken },
  pdf: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  meta: { flex: 1, gap: 4 },
  actions: { alignItems: 'flex-end' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
  error: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  flex: { flex: 1 },
});
