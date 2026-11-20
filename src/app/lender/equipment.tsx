import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { CheckSquare, ChevronRight, ImageOff, PackagePlus, Plus, Search } from 'lucide-react-native';
import { Button, Chip, EmptyState, ErrorState, Icon, LoadingRows, Screen, ScreenHeader, SelectField, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import type { ListingStatus } from '@/domain/entities';
import { filterAndSortListings, type ListingSort } from '@/domain/listings';
import { useSession } from '@/features/auth/session';
import { LISTING_STATUS } from '@/features/listings/status';
import { useListingPhotos } from '@/features/listings/useListingPhotos';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { listingManagementRepository, premiumRepository } from '@/repositories';
import { colors, radii, spacing, touchTarget } from '@/theme';

const FILTERS: (ListingStatus | 'all')[] = ['all', 'active', 'draft', 'paused', 'unavailable'];
const SORTS: { value: ListingSort; label: string }[] = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'price_asc', label: 'Daily rate: low to high' },
  { value: 'price_desc', label: 'Daily rate: high to low' },
  { value: 'title', label: 'Name: A–Z' },
];

/** My Equipment (plan §4.3): every listing with status, search, filter and sort. */
export default function MyEquipment() {
  const { context } = useSession();
  const toast = useToast();
  const userId = context?.userId ?? '';
  const list = useAsync(() => listingManagementRepository.listMine(userId), [userId]);
  const premium = useAsync(() => premiumRepository.mine(), []);
  const { reload } = list;
  useFocusEffect(useCallback(() => void reload(), [reload]));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ListingStatus | 'all'>('all');
  const [sort, setSort] = useState<ListingSort>('updated');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const rows = useMemo(() => filterAndSortListings(list.data ?? [], { query, status, sort }), [list.data, query, status, sort]);
  const photos = useListingPhotos((list.data ?? []).map((r) => r.coverPath));
  const count = (s: ListingStatus | 'all') => (list.data ?? []).filter((r) => (s === 'all' ? r.status !== 'removed' : r.status === s)).length;
  const canCreate = Boolean(context && context.verificationStatus === 'verified' && context.accountStatus === 'active');
  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  const runBulk = async (nextStatus: 'paused' | 'unavailable') => {
    if (selected.length === 0) return;
    setBulkBusy(true);
    const result = await premiumRepository.bulkSetListingStatus(selected, nextStatus);
    setBulkBusy(false);
    if (!result.ok) return toast.show({ title: 'Bulk update unavailable', message: result.error.message, tone: 'danger' });
    toast.show({ title: `${result.data} listing${result.data === 1 ? '' : 's'} updated`, message: `Marked ${nextStatus}. Featured placement was removed where applicable.`, tone: 'success' });
    setSelected([]); setSelecting(false); void reload();
  };

  const newButton = (
    <Button
      label="New listing"
      icon={Plus}
      size="sm"
      onPress={() => router.push('/manage/listings/new')}
      disabled={!canCreate}
      testID="equipment-new"
    />
  );

  return (
    <Screen withTabBar refreshing={list.loading && Boolean(list.data)} onRefresh={reload}>
      <ScreenHeader title="My Equipment" eyebrow="Lending" right={newButton} />
      {!canCreate ? <Text variant="footnote" tone="muted">New listings are paused while your account is under review or unverified.</Text> : null}
      {list.error ? (
        <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={reload} />
      ) : !list.data ? (
        <LoadingRows rows={3} label="Loading your equipment" />
      ) : count('all') === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title="List your first item"
          message="Calculators, cameras, lab gear, drafting tools: set your own daily rate and refundable deposit."
          action={canCreate ? { label: 'Create a listing', onPress: () => router.push('/manage/listings/new') } : undefined}
        />
      ) : (
        <View style={styles.body}>
          <TextField label="Search your equipment" leadingIcon={Search} value={query} onChangeText={setQuery} placeholder="Title" returnKeyType="search" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {FILTERS.map((f) => (
              <Chip key={f} label={`${f === 'all' ? 'All' : LISTING_STATUS[f].label} ${count(f)}`} selected={status === f} onPress={() => setStatus(f)} testID={`equipment-filter-${f}`} />
            ))}
          </ScrollView>
          <SelectField label="Sort by" value={sort} onChange={setSort} options={SORTS} />
          <View style={styles.bulkCard}>
            <Text variant="bodyStrong">Bulk equipment management</Text>
            <Text variant="footnote" tone="muted">Pause or mark up to 50 listings unavailable at once. Premium demo feature.</Text>
            {premium.data?.isActive ? (
              selecting ? <View style={styles.bulkActions}><Text variant="footnote">{selected.length} selected</Text><Button label="Pause selected" size="sm" variant="secondary" disabled={selected.length === 0} loading={bulkBusy} onPress={() => void runBulk('paused')} /><Button label="Unavailable" size="sm" variant="secondary" disabled={selected.length === 0} loading={bulkBusy} onPress={() => void runBulk('unavailable')} /><Button label="Done" size="sm" variant="ghost" disabled={bulkBusy} onPress={() => { setSelecting(false); setSelected([]); }} /></View> : <Button label="Select listings" size="sm" variant="secondary" icon={CheckSquare} onPress={() => setSelecting(true)} testID="bulk-select-listings" />
            ) : <Button label="Unlock with Premium" size="sm" variant="secondary" icon={CheckSquare} onPress={() => router.push('/premium')} testID="bulk-unlock-premium" />}
          </View>
          {rows.length === 0 ? (
            <EmptyState icon={Search} title="No matches" message="Try another search or filter." action={{ label: 'Clear filters', onPress: () => { setQuery(''); setStatus('all'); } }} />
          ) : (
            <View style={styles.list}>
              {rows.map((r) => {
                const url = r.coverPath ? photos.data?.[r.coverPath] : undefined;
                const st = LISTING_STATUS[r.status];
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => selecting ? toggleSelected(r.id) : router.push(`/manage/listings/${r.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.title}, ${formatPeso(r.dailyRate)} per day, ${st.label}${r.moderationStatus === 'hidden' ? ', hidden by a moderator' : ''}`}
                    accessibilityState={{ selected: selecting ? selected.includes(r.id) : undefined }}
                    style={({ pressed }) => [styles.row, selecting && selected.includes(r.id) && styles.selected, pressed && styles.pressed]}
                    testID={`equipment-${r.id}`}
                  >
                    {url ? (
                      <Image source={{ uri: url }} style={styles.thumb} contentFit="cover" accessible={false} />
                    ) : (
                      <View style={[styles.thumb, styles.noThumb]}><Icon as={ImageOff} color={colors.textFaint} /></View>
                    )}
                    <View style={styles.text}>
                      <Text variant="bodyStrong" numberOfLines={2}>{r.title}</Text>
                      <Text variant="subhead" tone="muted">{formatPeso(r.dailyRate)}/day · {r.photoCount} photo{r.photoCount === 1 ? '' : 's'}</Text>
                      <View style={styles.pills}>
                        <StatusPill label={st.label} tone={st.tone} />
                        {r.moderationStatus === 'hidden' ? <StatusPill label="Hidden by moderator" tone="danger" /> : r.moderationStatus === 'reported' ? <StatusPill label="Under review" tone="warning" /> : null}
                      </View>
                    </View>
                    <Icon as={ChevronRight} size="sm" color={colors.textFaint} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  chips: { gap: spacing.sm },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.94, transform: [{ scale: 0.995 }] },
  selected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  thumb: { width: 68, height: 68, borderRadius: radii.md, backgroundColor: colors.surfaceSunken },
  noThumb: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 4 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
  bulkCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bulkActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
});
