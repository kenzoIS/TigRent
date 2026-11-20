import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowUpDown,
  Award,
  Calculator,
  Camera,
  ChevronDown,
  FlaskConical,
  Laptop,
  Package,
  Plug,
  Ruler,
  Search,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  Tv,
  X,
} from 'lucide-react-native';
import {
  Banner,
  Button,
  Chip,
  DateField,
  EmptyState,
  ErrorState,
  Icon,
  ListRow,
  LoadingRows,
  Screen,
  ScreenHeader,
  SelectField,
  Sheet,
  Text,
  TextField,
  type IconComponent,
} from '@/components/design-system';
import type { ItemCondition } from '@/domain/entities';
import { CONDITIONS } from '@/domain/listings';
import { activeFilterCount, clearFilters, EMPTY_FILTERS, priceRange, SORT_OPTIONS, type SearchFilters } from '@/domain/search';
import { ResultRow } from '@/features/discovery/ResultRow';
import { useListingPhotos } from '@/features/listings/useListingPhotos';
import { addDays, todayInBusinessTz } from '@/lib/dates';
import { useAsync } from '@/lib/use-async';
import { discoveryRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const RATINGS = [{ value: 4.5, label: '4.5★ & up' }, { value: 4, label: '4★ & up' }, { value: 3, label: '3★ & up' }];

const CATEGORY_ICONS: Record<string, IconComponent> = {
  calculators: Calculator,
  'photo-video': Camera,
  'laptop-accessories': Laptop,
  presentation: Tv,
  drafting: Ruler,
  'lab-gear': FlaskConical,
  'power-cables': Plug,
  other: Package,
};

/** Borrower search with filters and sorting (plan Phase 7, Journey C.2–C.3). */
export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string; category?: string }>();
  const [filters, setFilters] = useState<SearchFilters>({ ...EMPTY_FILTERS, query: params.q ?? '', category: params.category || null }); // empty param = no category
  const [typed, setTyped] = useState(filters.query);
  const [sheet, setSheet] = useState(false);
  const [sortSheet, setSortSheet] = useState(false);
  const [draft, setDraft] = useState<SearchFilters>(filters);
  const today = todayInBusinessTz();

  // Debounce keyword typing.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.query === typed ? f : { ...f, query: typed })), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const results = useAsync(() => discoveryRepository.search(filters), [filters]);
  const categories = useAsync(() => discoveryRepository.categories(), []);
  const photos = useListingPhotos((results.data?.rows ?? []).map((r) => r.coverPath));
  const count = activeFilterCount(filters);
  const datesChosen = filters.pickup !== null && filters.ret !== null;
  const draftPrice = priceRange(draft);
  const categoryLabel = useMemo(() => categories.data?.find((c) => c.value === filters.category)?.label, [categories.data, filters.category]);
  const activeSort = useMemo(() => SORT_OPTIONS.find((s) => s.value === filters.sort), [filters.sort]);

  const applyDraft = () => {
    if (draftPrice.problem) return;
    if ((draft.pickup === null) !== (draft.ret === null)) return;
    setFilters({ ...draft, query: typed });
    setSheet(false);
  };
  const clearAll = () => {
    const cleared = clearFilters(filters);
    setFilters(cleared);
    setDraft(cleared);
  };
  const toggleCondition = (c: ItemCondition) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.includes(c) ? d.conditions.filter((x) => x !== c) : [...d.conditions, c] }));

  return (
    <Screen refreshing={results.loading && Boolean(results.data)} onRefresh={results.reload}>
      <ScreenHeader title="Find equipment" size="compact" back />
      <TextField
        label="Search equipment"
        hideLabel
        leadingIcon={Search}
        value={typed}
        onChangeText={setTyped}
        placeholder="Calculator, camera, projector…"
        returnKeyType="search"
        autoFocus={!params.category}
        trailing={typed ? <Button label="Clear" variant="ghost" size="sm" icon={X} onPress={() => setTyped('')} /> : undefined}
      />

      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          <Button
            label={count ? `Filters (${count})` : 'Filters'}
            variant={count ? 'tonal' : 'secondary'}
            size="sm"
            icon={SlidersHorizontal}
            onPress={() => { setDraft(filters); setSheet(true); }}
            testID="open-filters"
          />
          {count ? <Button label="Clear all" variant="ghost" size="sm" onPress={clearAll} testID="clear-filters" /> : null}
        </View>

        <Pressable
          onPress={() => setSortSheet(true)}
          accessibilityRole="button"
          accessibilityLabel={`Sort by: ${activeSort?.label ?? 'Featured first'}`}
          style={({ pressed }) => [
            styles.sortTrigger,
            pressed && styles.sortTriggerPressed,
          ]}
          testID="open-sort"
        >
          <Icon as={ArrowUpDown} size={15} color={colors.primaryPressed} />
          <Text variant="subhead" style={styles.sortLabel} numberOfLines={1}>
            {activeSort?.label ?? 'Featured first'}
          </Text>
          <Icon as={ChevronDown} size={15} color={colors.textMuted} />
        </Pressable>
      </View>

      {categories.data ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip
            label="All"
            icon={Sparkles}
            selected={filters.category === null}
            onPress={() => setFilters((f) => ({ ...f, category: null }))}
          />
          {categories.data.map((c) => (
            <Chip
              key={c.value}
              label={c.label}
              icon={CATEGORY_ICONS[c.value] ?? Package}
              selected={filters.category === c.value}
              onPress={() => setFilters((f) => ({ ...f, category: f.category === c.value ? null : c.value }))}
              testID={`category-${c.value}`}
            />
          ))}
        </ScrollView>
      ) : null}

      {results.error ? (
        <ErrorState offline={results.error.kind === 'network'} message={results.error.message} onRetry={results.reload} />
      ) : !results.data ? (
        <LoadingRows rows={4} label="Searching" />
      ) : results.data.rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No matching equipment"
          message={datesChosen ? 'Nothing matches those dates and filters. Try other dates or fewer filters.' : 'Try another word, category or fewer filters.'}
          action={count || filters.query ? { label: 'Clear search and filters', onPress: () => { setTyped(''); setFilters({ ...EMPTY_FILTERS, sort: filters.sort }); } } : undefined}
        />
      ) : (
        <View style={styles.results}>
          <View style={styles.resultsHeader}>
            <View style={styles.resultsCountBadge}>
              <Icon as={Sparkles} size={13} color={colors.primaryPressed} />
              <Text variant="footnote" style={styles.resultsCountText} accessibilityLiveRegion="polite">
                {results.data.total} {results.data.total === 1 ? 'item' : 'items'}
                {categoryLabel ? ` in ${categoryLabel}` : ''}
              </Text>
            </View>
            {datesChosen ? (
              <View style={styles.datePill}>
                <Text variant="caption" style={styles.datePillText}>Free on your dates</Text>
              </View>
            ) : null}
          </View>
          {results.data.rows.map((r) => (
            <ResultRow
              key={r.id}
              r={r}
              photoUrl={r.coverPath ? photos.data?.[r.coverPath] : undefined}
              datesChosen={datesChosen}
              onPress={() => router.push({ pathname: '/explore/listing/[id]', params: { id: r.id, ...(datesChosen ? { pickup: filters.pickup!, ret: filters.ret! } : {}) } })}
            />
          ))}
        </View>
      )}

      {/* Sort Sheet */}
      <Sheet
        visible={sortSheet}
        onClose={() => setSortSheet(false)}
        title="Sort equipment"
      >
        <View style={styles.sheetBody}>
          {SORT_OPTIONS.map((o) => (
            <ListRow
              key={o.value}
              title={o.label}
              selected={o.value === filters.sort}
              onPress={() => {
                setFilters((f) => ({ ...f, sort: o.value }));
                setSortSheet(false);
              }}
            />
          ))}
        </View>
      </Sheet>

      {/* Filter Sheet */}
      <Sheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="Filters"
        footer={
          <View style={styles.sheetActions}>
            <Button label="Reset" variant="secondary" onPress={() => setDraft(clearFilters(draft))} style={styles.flex} />
            <Button label="Show results" onPress={applyDraft} style={styles.flex} testID="apply-filters" disabled={Boolean(draftPrice.problem) || (draft.pickup === null) !== (draft.ret === null)} disabledReason={draftPrice.problem ? 'Fix the price range.' : (draft.pickup === null) !== (draft.ret === null) ? 'Choose both dates or neither.' : undefined} />
          </View>
        }
      >
        <View style={styles.sheetBody}>
          <SelectField label="Category" value={draft.category} onChange={(category) => setDraft((d) => ({ ...d, category }))} options={categories.data ?? []} placeholder="Any category" />
          <Text variant="headline">Dates</Text>
          <Text variant="footnote" tone="muted">Only show items free for every day from pickup to return (both days included).</Text>
          <DateField label="Pickup" value={draft.pickup} onChange={(pickup) => setDraft((d) => ({ ...d, pickup, ret: d.ret && d.ret < pickup ? null : d.ret }))} minDate={today} maxDate={addDays(today, 90)} />
          <DateField label="Return" value={draft.ret} onChange={(ret) => setDraft((d) => ({ ...d, ret }))} minDate={draft.pickup ?? today} maxDate={addDays(today, 120)} />
          {draft.pickup || draft.ret ? <Button label="Clear dates" variant="ghost" size="sm" onPress={() => setDraft((d) => ({ ...d, pickup: null, ret: null }))} /> : null}
          <Text variant="headline">Daily rate (₱)</Text>
          <View style={styles.row}>
            <View style={styles.flex}><TextField label="Min" value={draft.minPrice} onChangeText={(minPrice) => setDraft((d) => ({ ...d, minPrice }))} keyboardType="decimal-pad" placeholder="0" error={draftPrice.problem === 'min_invalid' ? 'Enter pesos' : null} /></View>
            <View style={styles.flex}><TextField label="Max" value={draft.maxPrice} onChangeText={(maxPrice) => setDraft((d) => ({ ...d, maxPrice }))} keyboardType="decimal-pad" placeholder="Any" error={draftPrice.problem === 'max_invalid' ? 'Enter pesos' : draftPrice.problem === 'min_above_max' ? 'Below min' : null} /></View>
          </View>
          <Text variant="headline">Condition</Text>
          <View style={styles.wrap}>
            {CONDITIONS.map((c) => <Chip key={c.value} label={c.label} selected={draft.conditions.includes(c.value)} onPress={() => toggleCondition(c.value)} />)}
          </View>
          <Text variant="headline">Trust</Text>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text variant="body">Verified Trusted Lenders only</Text>
              <Text variant="footnote" tone="muted">Lenders meeting TigRent’s sample trust criteria (not a UST endorsement).</Text>
            </View>
            <Switch accessibilityLabel="Verified Trusted Lenders only" value={draft.trustedOnly} onValueChange={(trustedOnly) => setDraft((d) => ({ ...d, trustedOnly }))} trackColor={{ true: colors.primary, false: colors.borderStrong }} />
          </View>
          <View style={styles.wrap}>
            {RATINGS.map((r) => <Chip key={r.value} label={r.label} icon={Award} selected={draft.minRating === r.value} onPress={() => setDraft((d) => ({ ...d, minRating: d.minRating === r.value ? null : r.value }))} />)}
          </View>
          {draftPrice.problem === 'min_above_max' ? <Banner tone="warning" title="The minimum is above the maximum." /> : null}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  sortTrigger: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  sortTriggerPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  sortLabel: {
    fontWeight: '600',
    color: colors.text,
  },
  chips: { gap: spacing.sm, paddingVertical: spacing.md },
  results: { gap: spacing.md },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  resultsCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  resultsCountText: {
    fontWeight: '600',
    color: colors.textMuted,
  },
  datePill: {
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  datePillText: {
    color: colors.success,
    fontWeight: '600',
  },
  sheetBody: { gap: spacing.md },
  sheetActions: { flexDirection: 'row', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
});
