import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { CalendarRange, Check, Eye, ImagePlus, PauseCircle, Pencil, PlayCircle, Rocket, Sparkles, Trash2, X } from 'lucide-react-native';
import { Banner, Button, Dialog, ErrorState, Icon, ListRow, LoadingRows, Screen, ScreenHeader, StatusPill, Text, useToast } from '@/components/design-system';
import { LISTING_STATUS } from '@/features/listings/status';
import { Group, Section } from '@/components/shared/Layout';
import type { ListingStatus } from '@/domain/entities';
import { CONDITION_LABEL, publishChecklist } from '@/domain/listings';
import { useSession } from '@/features/auth/session';
import { useListingPhotos } from '@/features/listings/useListingPhotos';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { listingManagementRepository, premiumRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';


type Action = { status: ListingStatus; title: string; message: string; confirm: string; destructive?: boolean };

/** Listing overview: status, publish checklist, management actions (plan Phase 6, Journey B). */
export default function ListingOverview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { context } = useSession();
  const toast = useToast();
  const listing = useAsync(() => listingManagementRepository.get(id), [id]);
  const premium = useAsync(() => premiumRepository.mine(), []);
  const { reload } = listing;
  useFocusEffect(useCallback(() => void reload(), [reload]));
  const l = listing.data;
  const cover = useListingPhotos([l?.images[0]?.path]);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (listing.error) {
    return (
      <Screen>
        <ScreenHeader title="Listing" size="compact" back />
        <ErrorState offline={listing.error.kind === 'network'} message={listing.error.message} onRetry={reload} />
      </Screen>
    );
  }
  if (!l) {
    return (
      <Screen>
        <ScreenHeader title="Listing" size="compact" back />
        {listing.loading ? <LoadingRows rows={4} /> : <Banner tone="warning" title="This listing no longer exists." />}
      </Screen>
    );
  }

  const lenderReady = Boolean(context && context.verificationStatus === 'verified' && context.accountStatus === 'active' && context.roles.includes('lender'));
  const checks = publishChecklist(l, l.images.length, lenderReady);
  const ready = checks.every((c) => c.done);
  const s = LISTING_STATUS[l.status];
  const coverUrl = l.images[0] ? cover.data?.[l.images[0].path] : undefined;
  const removed = l.status === 'removed';

  const run = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    const r = await listingManagementRepository.setStatus(l.id, action.status);
    setBusy(false);
    const a = action;
    setAction(null);
    if (!r.ok) return setError(r.error.message);
    toast.show({ title: a.status === 'active' ? 'Listing is live' : `Listing ${LISTING_STATUS[a.status].label.toLowerCase()}`, tone: 'success' });
    if (a.status === 'removed') router.back();
    else void reload();
  };
  const feature = async () => {
    const r = await premiumRepository.markFeatured(l.id, !l.isFeatured);
    if (!r.ok) return setError(r.error.message);
    toast.show({ title: l.isFeatured ? 'Featured placement removed' : 'Listing featured', message: 'Premium placement is simulated.', tone: 'success' });
    void reload();
  };

  const publish: Action = {
    status: 'active',
    title: l.status === 'draft' ? 'Publish this listing?' : 'Reactivate this listing?',
    message: 'Verified students will be able to find it and send booking requests at the current price and terms.',
    confirm: l.status === 'draft' ? 'Publish' : 'Reactivate',
  };

  return (
    <Screen
      footer={
        removed ? undefined : l.status === 'active' ? (
          <View style={styles.row}>
            <Button label="Pause" variant="secondary" icon={PauseCircle} style={styles.flex} onPress={() => setAction({ status: 'paused', title: 'Pause this listing?', message: 'It will be hidden from search. Existing bookings continue as agreed.', confirm: 'Pause' })} testID="listing-pause" />
            <Button label="Unavailable" variant="secondary" style={styles.flex} onPress={() => setAction({ status: 'unavailable', title: 'Mark as unavailable?', message: 'Use this if the item is broken or lent elsewhere. It will be hidden from search; existing bookings continue.', confirm: 'Mark unavailable' })} />
          </View>
        ) : (
          <Button
            label={l.status === 'draft' ? 'Publish' : 'Reactivate'}
            icon={l.status === 'draft' ? Rocket : PlayCircle}
            onPress={() => setAction(publish)}
            disabled={!ready}
            disabledReason={!ready ? 'Complete the checklist above first.' : undefined}
            fullWidth
            testID="listing-publish"
          />
        )
      }
    >
      <ScreenHeader title="Listing" size="compact" back />
      <View style={styles.body}>
        {error ? <Banner tone="danger" title="Couldn’t update the listing" message={error} onDismiss={() => setError(null)} /> : null}
        {l.moderationStatus === 'hidden' ? (
          <Banner tone="danger" title="Hidden by a moderator" message="Students can’t see this listing. Check your notifications for the reason. It can’t be republished until a moderator restores it." />
        ) : l.moderationStatus === 'reported' ? (
          <Banner tone="warning" title="Reported for review" message="A student reported this listing. It stays visible while a moderator reviews it." />
        ) : null}

        <View style={styles.hero}>
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.cover} contentFit="cover" accessibilityLabel="Cover photo" />
          ) : (
            <View style={[styles.cover, styles.noCover]}><Icon as={ImagePlus} size="lg" color={colors.textFaint} /></View>
          )}
          <View style={styles.heroText}>
            <StatusPill label={s.label} tone={s.tone} />
            <Text variant="title2" numberOfLines={3}>{l.title}</Text>
            <Text variant="callout" tone="muted">{formatPeso(l.dailyRate)}/day · {CONDITION_LABEL[l.condition]}</Text>
          </View>
        </View>
        <Text variant="footnote" tone="muted">{s.help}</Text>

        {l.status !== 'active' && !removed ? (
          <Section title="Ready to publish?">
            <Group>
              {checks.map((c) => (
                <View key={c.key} style={styles.check} accessible accessibilityLabel={`${c.done ? 'Done' : 'To do'}: ${c.label}`}>
                  <Icon as={c.done ? Check : X} size="sm" color={c.done ? colors.success : colors.danger} />
                  <Text variant="callout" style={styles.flex}>{c.label}</Text>
                </View>
              ))}
            </Group>
          </Section>
        ) : null}

        {!removed ? (
          <Section title="Manage">
            <Group>
              <ListRow icon={Pencil} title="Edit details" subtitle="Title, price, deposit, late fee, pickup" onPress={() => router.push(`/manage/listings/${l.id}/edit`)} testID="listing-edit" />
              <ListRow icon={ImagePlus} title="Photos" value={`${l.images.length}/8`} onPress={() => router.push(`/manage/listings/${l.id}/photos`)} testID="listing-photos" />
              <ListRow icon={CalendarRange} title="Availability" value={l.blocks.length ? `${l.blocks.length} blocked` : undefined} onPress={() => router.push(`/manage/listings/${l.id}/availability`)} testID="listing-availability" />
              <ListRow icon={Sparkles} title={l.isFeatured ? 'Remove featured placement' : 'Feature this listing'} subtitle={premium.data?.isActive ? 'Premium · simulated placement' : 'Premium required · demo subscription'} onPress={premium.data?.isActive ? feature : () => router.push('/premium')} testID="listing-feature" />
              <ListRow icon={Eye} title="Preview as borrowers see it" onPress={() => router.push(`/manage/listings/${l.id}/preview`)} />
              <ListRow
                icon={Trash2}
                title="Remove listing"
                destructive
                onPress={() => setAction({ status: 'removed', title: 'Remove this listing?', message: 'It will be removed permanently. You can’t remove it while requests or rentals are open.', confirm: 'Remove', destructive: true })}
                testID="listing-remove"
              />
            </Group>
          </Section>
        ) : null}
        <Text variant="footnote" tone="muted">Edits apply to new requests only. Accepted bookings keep the price and terms that were agreed.</Text>
      </View>
      <Dialog
        visible={action !== null}
        title={action?.title ?? ''}
        message={action?.message ?? ''}
        confirmLabel={action?.confirm ?? 'Confirm'}
        destructive={action?.destructive}
        loading={busy}
        onConfirm={run}
        onCancel={() => setAction(null)}
        testID="listing-action"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  hero: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  cover: { width: 104, height: 104, borderRadius: radii.md, backgroundColor: colors.surfaceSunken },
  noCover: { alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, gap: spacing.xs },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
