import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImagePlus, Trash2 } from 'lucide-react-native';
import { Banner, Button, ErrorState, LoadingRows, SelectField, Text, TextField } from '@/components/design-system';
import { CONDITIONS, listingFormSchema, WIZARD_STEPS, type ListingFormInput, type ListingFormValues } from '@/domain/listings';
import { ok, type Result } from '@/lib/errors';
import { useAsync } from '@/lib/use-async';
import { listingManagementRepository, settingsRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

type Field = keyof ListingFormInput;
export type ListingDraftPhoto = { uri: string; mimeType: string };
const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Server `validation.<reason>` → form field (and therefore wizard step). */
const SERVER_FIELD: Record<string, Field> = {
  title: 'title',
  description: 'description',
  category: 'category',
  condition: 'condition',
  daily_rate: 'dailyRate',
  deposit: 'deposit',
  late_fee_per_day: 'lateFeePerDay',
  pickup_point_id: 'pickupPointId',
  notes: 'pickupNotes',
};

type Props = {
  initial: ListingFormInput;
  submitLabel: string;
  onSubmit: (values: ListingFormValues, photo?: ListingDraftPhoto) => Promise<Result<unknown>>;
  /** New listings need a cover photo before the draft can be saved. */
  requireCoverPhoto?: boolean;
};

/** Three-step create/edit flow with step-level validation (plan Phase 6). */
export function ListingWizard({ initial, submitLabel, onSubmit, requireCoverPhoto = false }: Props) {
  const options = useAsync(async () => {
    const [cats, points, settings] = await Promise.all([
      listingManagementRepository.categories(),
      listingManagementRepository.pickupPoints(),
      settingsRepository.listCurrent(),
    ]);
    if (!cats.ok) return cats;
    if (!points.ok) return points;
    const commission = settings.ok ? settings.data.find((x) => x.key === 'commission_bps') : undefined;
    return ok({
      categories: cats.data,
      pickupPoints: points.data,
      // Commission is an admin setting (plan §2.5); show the live value, never a hard-coded one.
      commissionPct: commission ? Number(commission.value) / 100 : null,
      commissionIsSample: commission?.isSample ?? true,
    });
  }, []);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<ListingFormInput>(initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coverPhoto, setCoverPhoto] = useState<ListingDraftPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [customPickup, setCustomPickup] = useState(initial.pickupPointId === null && Boolean(initial.pickupNotes));

  const applyPhotoAsset = useCallback((asset: ImagePicker.ImagePickerAsset | undefined) => {
    if (!asset) return;
    const mimeType = (asset.mimeType ?? 'image/jpeg').toLowerCase();
    if (!PHOTO_MIME_TYPES.includes(mimeType)) return setPhotoError('Use a JPG, PNG or WebP photo.');
    if (asset.fileSize && asset.fileSize > PHOTO_MAX_BYTES) return setPhotoError('Use a photo smaller than 5 MB.');
    setPhotoError(null);
    setCoverPhoto({ uri: asset.uri, mimeType });
  }, []);

  // Android can recreate the activity while the native picker is open. Restore a
  // completed selection so a valid required photo is never silently lost.
  useEffect(() => {
    if (Platform.OS !== 'android' || typeof ImagePicker.getPendingResultAsync !== 'function') return;
    void ImagePicker.getPendingResultAsync().then((result) => {
      if (result && 'canceled' in result && !result.canceled) applyPhotoAsset(result.assets[0]);
    });
  }, [applyPhotoAsset]);

  const set = <K extends Field>(k: K) => (v: ListingFormInput[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const errorsFor = (fields: readonly string[]) => {
    const r = listingFormSchema.safeParse(values);
    if (r.success) return {};
    const out: Partial<Record<Field, string>> = {};
    for (const i of r.error.issues) {
      const k = String(i.path[0]) as Field;
      if (fields.includes(k) && !out[k]) out[k] = i.message;
    }
    return out;
  };

  const next = () => {
    const e = errorsFor(WIZARD_STEPS[step]!.fields);
    setErrors(e);
    if (step === 0 && requireCoverPhoto && !coverPhoto) setPhotoError('Add at least one clear photo of the item.');
    if (Object.keys(e).length === 0 && !(step === 0 && requireCoverPhoto && !coverPhoto)) setStep((s) => s + 1);
  };

  const choosePhoto = async (source: 'camera' | 'library') => {
    setPhotoError(null);
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return setPhotoError('Camera access is off. Allow it in Settings, or choose from photos.');
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return setPhotoError('Photo library access is off. Allow it in Settings, or take a photo.');
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 0.8 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled) applyPhotoAsset(result.assets[0]);
  };

  const submit = async () => {
    const parsed = listingFormSchema.safeParse(values);
    if (!parsed.success) {
      const all = errorsFor(WIZARD_STEPS.flatMap((s) => [...s.fields]));
      setErrors(all);
      const firstBad = WIZARD_STEPS.findIndex((s) => s.fields.some((f) => all[f as Field]));
      if (firstBad >= 0) setStep(firstBad);
      return;
    }
    setBusy(true);
    setFormError(null);
    const r = await onSubmit(parsed.data, coverPhoto ?? undefined);
    setBusy(false);
    if (r.ok) return;
    const field = r.error.code ? SERVER_FIELD[r.error.code] : undefined;
    if (field) {
      setErrors({ [field]: r.error.message });
      setStep(WIZARD_STEPS.findIndex((s) => (s.fields as readonly string[]).includes(field)));
    } else {
      setFormError(r.error.message);
    }
  };

  if (options.error) return <ErrorState offline={options.error.kind === 'network'} message={options.error.message} onRetry={options.reload} />;
  if (!options.data) return <LoadingRows rows={4} label="Loading form" />;
  const s = WIZARD_STEPS[step]!;
  const last = step === WIZARD_STEPS.length - 1;

  return (
    <View style={styles.root}>
      <View style={styles.progress} accessibilityRole="progressbar" accessibilityLabel={`Step ${step + 1} of ${WIZARD_STEPS.length}: ${s.title}`}>
        <Text variant="overline" tone="muted" uppercase>Step {step + 1} of {WIZARD_STEPS.length}</Text>
        <Text variant="title2">{s.title}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${((step + 1) / WIZARD_STEPS.length) * 100}%` }]} />
        </View>
      </View>
      {formError ? <Banner tone="danger" title="Couldn’t save" message={formError} onDismiss={() => setFormError(null)} /> : null}

      {s.key === 'basics' ? (
        <>
          <TextField label="Title" value={values.title} onChangeText={set('title')} error={errors.title} placeholder="e.g. Casio fx-991EX scientific calculator" maxLength={80} required />
          <SelectField label="Category" value={values.category || null} onChange={(v) => set('category')(v)} options={options.data.categories} error={errors.category} required />
          <SelectField label="Condition" value={values.condition ?? null} onChange={(v) => set('condition')(v)} options={CONDITIONS} error={errors.condition} required />
          <TextField label="Description" value={values.description} onChangeText={set('description')} error={errors.description} multiline placeholder="What’s included, what it’s good for, any limits." maxLength={2000} />
          <TextField label="Equipment notes" value={values.equipmentNotes} onChangeText={set('equipmentNotes')} error={errors.equipmentNotes} multiline helper="Optional: scratches, missing parts, accessories." maxLength={500} />
          {requireCoverPhoto ? (
            <View style={styles.photoField}>
              <Text variant="headline">Cover photo</Text>
              <Text variant="footnote" tone="muted">Required. Add a clear JPG, PNG or WebP photo (up to 5 MB). It is uploaded privately when the draft is saved.</Text>
              {coverPhoto ? <Image source={{ uri: coverPhoto.uri }} style={styles.photoPreview} contentFit="cover" accessibilityLabel="Selected cover photo" /> : null}
              <View style={styles.photoActions}>
                <Button label={coverPhoto ? 'Replace photo' : 'Choose photo'} variant="secondary" size="sm" icon={ImagePlus} onPress={() => void choosePhoto('library')} testID="listing-photo-library" />
                <Button label="Take photo" variant="secondary" size="sm" icon={Camera} onPress={() => void choosePhoto('camera')} testID="listing-photo-camera" />
                {coverPhoto ? <Button label="Remove photo" variant="ghost" size="sm" icon={Trash2} onPress={() => setCoverPhoto(null)} /> : null}
              </View>
              {photoError ? <Text variant="footnote" style={styles.photoError}>{photoError}</Text> : null}
            </View>
          ) : null}
        </>
      ) : s.key === 'pricing' ? (
        <>
          <TextField label="Daily rate (₱)" value={values.dailyRate} onChangeText={set('dailyRate')} error={errors.dailyRate} keyboardType="decimal-pad" placeholder="e.g. 120" helper="Borrowers pay this for every rental day, pickup and return days included." required />
          <TextField label="Refundable deposit (₱)" value={values.deposit} onChangeText={set('deposit')} error={errors.deposit} keyboardType="decimal-pad" placeholder="e.g. 500 (0 for none)" helper="Held during the rental and returned after a clean return. Never counted as earnings." required />
          <TextField label="Late fee per day (₱)" value={values.lateFeePerDay} onChangeText={set('lateFeePerDay')} error={errors.lateFeePerDay} keyboardType="decimal-pad" placeholder="e.g. 50 (0 for none)" helper="Charged only after the due time on the return date." required />
          <Banner
            tone="info"
            title="Platform commission"
            message={`TigRent keeps ${options.data.commissionPct !== null ? `a ${options.data.commissionPct}%` : 'a'} commission${options.data.commissionIsSample ? ' (sample setting)' : ''} from the rent of each rental. Deposits are never commissioned. Payments in this prototype are simulated.`}
          />
        </>
      ) : (
        <>
          <SelectField
            label="Pickup point"
            value={values.pickupPointId ?? (customPickup ? '__other__' : null)}
            onChange={(v) => {
              const other = v === '__other__';
              setCustomPickup(other);
              set('pickupPointId')(other ? null : v);
            }}
            options={[...options.data.pickupPoints.map((p) => ({ value: p.value, label: p.label, description: p.description })), { value: '__other__', label: 'Others', description: 'Enter a safe public pickup and return point.' }]}
            error={errors.pickupPointId}
            helper="Approved public campus areas."
          />
          <TextField
            label={customPickup ? 'Specify the other pickup & return point' : 'Pickup instructions'}
            value={values.pickupNotes}
            onChangeText={set('pickupNotes')}
            error={errors.pickupNotes}
            multiline
            helper={customPickup ? 'Required for Others. Use a safe public campus location; don’t include phone numbers or home addresses.' : 'When you’re usually available. Don’t include phone numbers or home addresses: coordinate in TigRent messages.'}
            placeholder={customPickup ? 'e.g. Meet at the Quadricentennial Square gate; return at the same point.' : undefined}
            maxLength={500}
          />
        </>
      )}

      <View style={styles.nav}>
        {step > 0 ? <Button label="Back" variant="secondary" onPress={() => setStep((x) => x - 1)} style={styles.flex} disabled={busy} /> : null}
        {last ? (
          <Button label={submitLabel} onPress={submit} loading={busy} style={styles.flex} testID="wizard-submit" />
        ) : (
          <Button label="Next" onPress={next} style={styles.flex} testID="wizard-next" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  progress: { gap: spacing.xs },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceSunken, overflow: 'hidden', marginTop: spacing.xs },
  fill: { height: 4, backgroundColor: colors.primary, borderRadius: radii.pill },
  photoField: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surfaceSunken },
  photoPreview: { width: '100%', aspectRatio: 4 / 3, borderRadius: radii.md, backgroundColor: colors.surface },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  photoError: { color: colors.danger, fontWeight: '600' },
  nav: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex: { flex: 1 },
});
