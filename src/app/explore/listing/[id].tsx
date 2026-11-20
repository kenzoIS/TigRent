import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Award, ChevronRight, Flag, ShieldCheck } from 'lucide-react-native';
import { Banner, Button, Chip, DateField, ErrorState, Icon, LoadingRows, Screen, ScreenHeader, Sheet, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import { Section } from '@/components/shared/Layout';
import { checkRentalDates, DATE_PROBLEM_MESSAGE, quoteRental } from '@/domain/pricing';
import { useSession } from '@/features/auth/session';
import { PriceBreakdown } from '@/features/booking/PriceBreakdown';
import { ListingDetailView } from '@/features/listings/ListingDetailView';
import { useListingPhotos } from '@/features/listings/useListingPhotos';
import { addDays, compareDateOnly, todayInBusinessTz, type DateOnly } from '@/lib/dates';
import { ok } from '@/lib/errors';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { discoveryRepository, profileSummaryRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const REPORT_REASONS = ['Photos don’t match the item', 'Misleading description or price', 'Item seems unsafe or prohibited', 'Lender asked to pay outside TigRent', 'Something else'];

/** Listing detail with lender trust, availability and the full price preview (plan Phase 7, Journey C.4–C.6). */
export default function ListingScreen() {
  const params = useLocalSearchParams<{ id: string; pickup?: string; ret?: string }>();
  const { context } = useSession();
  const toast = useToast();
  const today = todayInBusinessTz();
  const [pickup, setPickup] = useState<DateOnly | null>(params.pickup ?? null);
  const [ret, setRet] = useState<DateOnly | null>(params.ret ?? null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const data = useAsync(async () => {
    const [listing, window] = await Promise.all([discoveryRepository.listing(params.id), discoveryRepository.requestWindow()]);
    if (!listing.ok) return listing;
    if (!window.ok) return window;
    const [lender, ranges] = await Promise.all([
      profileSummaryRepository.get(listing.data.lenderId),
      discoveryRepository.unavailableDates(params.id, today, addDays(today, window.data.maxAdvanceDays + window.data.maxRentalDays)),
    ]);
    return ok({ listing: listing.data, window: window.data, lender: lender.ok ? lender.data : null, ranges: ranges.ok ? ranges.data : [] });
  }, [params.id, today]);

  const d = data.data;
  const photos = useListingPhotos(d?.listing.images.map((i) => i.path) ?? []);
  const unavailable = useMemo(() => {
    if (!d) return undefined;
    return (day: DateOnly) => {
      const hit = d.ranges.find((r) => compareDateOnly(day, r.startDate) >= 0 && compareDateOnly(day, r.endDate) <= 0);
      return hit ? (hit.reason === 'booked' ? 'Booked' : 'Unavailable') : null;
    };
  }, [d]);

  const problem = d ? checkRentalDates(pickup, ret, { today, maxRentalDays: d.window.maxRentalDays, maxAdvanceDays: d.window.maxAdvanceDays, isUnavailable: (x) => Boolean(unavailable?.(x)) }) : 'missing';
  const estimate = d && !problem && pickup && ret
    ? quoteRental({ dailyRate: d.listing.dailyRate, deposit: d.listing.deposit, lateFeePerDay: d.listing.lateFeePerDay, commissionBps: d.window.commissionBps }, pickup, ret)
    : null;
  // Server confirmation of the same numbers (and live availability).
  const server = useAsync(() => (estimate && pickup && ret ? discoveryRepository.quote(params.id, pickup, ret) : Promise.resolve(ok(null))), [params.id, estimate ? pickup : null, estimate ? ret : null]);

  if (data.error) {
    return (
      <Screen>
        <ScreenHeader title="Listing" size="compact" back />
        <ErrorState offline={data.error.kind === 'network'} title="This item isn’t available" message={data.error.kind === 'not_found' ? 'It may have been paused or removed by the lender.' : data.error.message} onRetry={data.reload} />
      </Screen>
    );
  }
  if (!d) {
    return (
      <Screen>
        <ScreenHeader title="Listing" size="compact" back />
        <LoadingRows rows={5} label="Loading listing" />
      </Screen>
    );
  }

  const own = d.listing.lenderId === context?.userId;
  const active = d.listing.status === 'active';
  const restricted = context?.accountStatus !== 'active';
  const sq = server.data;
  const serverProblem = server.error?.message ?? (sq && !sq.available ? DATE_PROBLEM_MESSAGE.unavailable : null);
  const canContinue = Boolean(estimate && sq && sq.available && !own && active && !restricted);
  const blockReason = own
    ? 'This is your own listing.'
    : !active
      ? 'This item isn’t open for requests right now.'
      : restricted
        ? 'New requests are paused while your account is under review.'
        : problem
          ? DATE_PROBLEM_MESSAGE[problem]
          : serverProblem ?? (server.loading ? 'Checking availability…' : undefined);

  const submitReport = async () => {
    if (!reason) return setReportError('Choose a reason.');
    setReportBusy(true);
    const r = await discoveryRepository.report(params.id, reason, details);
    setReportBusy(false);
    if (!r.ok) return setReportError(r.error.message);
    setReporting(false);
    toast.show({ title: 'Report sent', message: 'A TigRent moderator will review this listing.', tone: 'success' });
  };

  return (
    <Screen
      footer={
        own ? undefined : (
          <Button
            label={estimate ? `Review request · ${formatPeso(sq?.total ?? estimate.total, { showCentavos: 'always' })}` : 'Choose dates to continue'}
            onPress={() => router.push({ pathname: '/explore/request/[id]', params: { id: params.id, pickup: pickup!, ret: ret! } })}
            disabled={!canContinue}
            disabledReason={!canContinue ? blockReason : undefined}
            fullWidth
            testID="listing-continue"
          />
        )
      }
    >
      <ScreenHeader
        title="Listing"
        size="compact"
        back
        right={!own ? <Button label="Report" variant="ghost" size="sm" icon={Flag} onPress={() => { setReason(null); setDetails(''); setReportError(null); setReporting(true); }} testID="report-listing" /> : undefined}
      />
      <View style={styles.body}>
        {own ? <Banner tone="info" title="This is your listing" message="Borrowers see it like this. You can’t request your own item." /> : null}
        {!active && !own ? <Banner tone="warning" title="Not open for requests" message="The lender paused this item. Check back later." /> : null}
        <ListingDetailView
          listing={{
            title: d.listing.title,
            categoryLabel: d.listing.categoryLabel,
            condition: d.listing.condition,
            description: d.listing.description,
            equipmentNotes: d.listing.equipmentNotes,
            dailyRate: d.listing.dailyRate,
            deposit: d.listing.deposit,
            lateFeePerDay: d.listing.lateFeePerDay,
            pickupPointLabel: d.listing.pickupPointLabel,
            pickupNotes: d.listing.pickupNotes,
            photoUrls: d.listing.images.map((i) => photos.data?.[i.path]).filter((u): u is string => Boolean(u)),
          }}
        />

        {d.lender ? (
          <Section title="Lender">
            <Pressable
              onPress={() => router.push({ pathname: '/explore/lender/[id]', params: { id: d.listing.lenderId } })}
              accessibilityRole="button"
              accessibilityLabel={`Lender ${d.lender.fullName}${d.lender.badges.some((b) => b.code === 'trusted_lender') ? ', Verified Trusted Lender' : ''}. View profile`}
              style={({ pressed }) => [styles.lender, pressed && styles.pressed]}
              testID="lender-card"
            >
              <View style={styles.avatar}><Text variant="title2" tone="onGold">{d.lender.fullName.slice(0, 1)}</Text></View>
              <View style={styles.flex}>
                <Text variant="bodyStrong">{d.lender.fullName}</Text>
                <Text variant="footnote" tone="muted">
                  {d.lender.lenderRating.count > 0 ? `★ ${d.lender.lenderRating.avg?.toFixed(1)} from ${d.lender.lenderRating.count} borrower review${d.lender.lenderRating.count === 1 ? '' : 's'}` : 'No lender reviews yet'} · {d.lender.completedLendings} completed
                </Text>
                <View style={styles.pills}>
                  {d.lender.isStudentVerified ? <StatusPill label="Student verified" tone="success" icon={ShieldCheck} /> : null}
                  {d.lender.badges.some((b) => b.code === 'trusted_lender') ? <StatusPill label="Verified Trusted Lender" tone="success" icon={Award} /> : null}
                </View>
              </View>
              <Icon as={ChevronRight} size="sm" color={colors.textFaint} />
            </Pressable>
          </Section>
        ) : null}

        {!own && active ? (
          <Section title="Choose your dates">
            <Text variant="footnote" tone="muted">Crossed-out dates are booked or unavailable. Up to {d.window.maxRentalDays} days per rental (sample setting).</Text>
            <DateField label="Pickup date" value={pickup} onChange={(v) => { setPickup(v); if (ret && compareDateOnly(ret, v) < 0) setRet(null); }} minDate={today} maxDate={addDays(today, d.window.maxAdvanceDays)} unavailableReason={unavailable} testID="pickup-date" />
            <DateField label="Return date" value={ret} onChange={setRet} minDate={pickup ?? today} maxDate={addDays(pickup ?? today, d.window.maxRentalDays - 1)} unavailableReason={unavailable} helper="Your return date is included in the rental." testID="return-date" />
            {pickup && ret && problem && problem !== 'missing' ? <Banner tone="warning" title={DATE_PROBLEM_MESSAGE[problem]} /> : null}
            {estimate && pickup && ret ? (
              <>
                {serverProblem ? <Banner tone="warning" title="Those dates can’t be requested" message={serverProblem} /> : null}
                <PriceBreakdown
                  rentalDays={sq?.rentalDays ?? estimate.rentalDays}
                  dailyRate={sq?.dailyRate ?? estimate.dailyRate}
                  subtotal={sq?.subtotal ?? estimate.subtotal}
                  deposit={sq?.deposit ?? estimate.deposit}
                  total={sq?.total ?? estimate.total}
                  lateFeePerDay={sq?.lateFeePerDay ?? estimate.lateFeePerDay}
                  pickupDate={pickup}
                  returnDate={ret}
                  dueTimeLocal={sq?.returnDueTimeLocal ?? d.window.returnDueTimeLocal}
                  confirmed={Boolean(sq && sq.available)}
                />
              </>
            ) : null}
          </Section>
        ) : null}
      </View>

      <Sheet
        visible={reporting}
        onClose={() => setReporting(false)}
        title="Report this listing"
        description="Reports are private. A moderator reviews them; the lender isn’t told who reported."
        footer={<Button label="Send report" onPress={submitReport} loading={reportBusy} fullWidth testID="report-send" />}
      >
        <View style={styles.reportBody}>
          {reportError ? <Banner tone="danger" title={reportError} /> : null}
          <View style={styles.pills}>
            {REPORT_REASONS.map((r) => <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}
          </View>
          <TextField label="Details (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  lender: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.lg },
  pressed: { backgroundColor: colors.surfaceSunken },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 },
  reportBody: { gap: spacing.md },
  flex: { flex: 1 },
});
