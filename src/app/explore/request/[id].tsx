import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Banner, Button, Checkbox, ErrorState, LoadingRows, Screen, ScreenHeader, StatusPill, Text, TextField } from '@/components/design-system';
import { Section } from '@/components/shared/Layout';
import { CONDITION_LABEL, hasPhoneNumber } from '@/domain/listings';
import { PriceBreakdown } from '@/features/booking/PriceBreakdown';
import { ok } from '@/lib/errors';
import { useAsync } from '@/lib/use-async';
import { bookingFlowRepository, discoveryRepository, termsRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/**
 * Request review and send (Journey C.5–C.6): the server-confirmed price, the rental terms, then
 * `request_booking`, which snapshots the agreed price, policy version and accepted terms.
 */
export default function ReviewRequest() {
  const { id, pickup, ret } = useLocalSearchParams<{ id: string; pickup: string; ret: string }>();
  const [accepted, setAccepted] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<{ message: string; code?: string } | null>(null);
  const data = useAsync(async () => {
    const [listing, quote, terms] = await Promise.all([discoveryRepository.listing(id), discoveryRepository.quote(id, pickup, ret), termsRepository.listActive()]);
    if (!listing.ok) return listing;
    if (!quote.ok) return quote;
    return ok({ listing: listing.data, quote: quote.data, rentalTerms: terms.ok ? terms.data.find((t) => t.docType === 'rental_terms') ?? null : null });
  }, [id, pickup, ret]);
  const d = data.data;
  const noteProblem = note.length > 300 ? 'Keep the note under 300 characters.' : hasPhoneNumber(note) ? 'Don’t put phone numbers here. Use TigRent messages to coordinate.' : null;

  const blocker = !d
    ? 'Loading…'
    : !d.quote.available
      ? 'These dates aren’t available any more.'
      : !d.rentalTerms
        ? 'Rental terms couldn’t be loaded. Pull to refresh.'
        : !accepted
          ? 'Accept the rental terms first.'
          : noteProblem
            ? 'Fix the pickup note first.'
            : null;

  const send = async () => {
    if (!d || !d.rentalTerms || blocker || sending) return;
    setSending(true);
    setSendError(null);
    const r = await bookingFlowRepository.request({
      listingId: id,
      pickup,
      ret,
      termsVersionId: d.rentalTerms.id,
      expectedTotal: d.quote.total,
      pickupArrangement: note,
    });
    setSending(false);
    if (r.ok) {
      router.replace({ pathname: '/booking/[id]', params: { id: r.data, sent: '1' } });
    } else {
      setSendError({ message: r.error.message, code: r.error.code });
      // A changed price or new terms must be re-read before trying again.
      if (r.error.code === 'price_changed' || r.error.code === 'terms_changed' || r.error.code === 'dates_unavailable') {
        setAccepted(false);
        void data.reload();
      }
    }
  };

  return (
    <Screen
      refreshing={data.loading && Boolean(d)}
      onRefresh={data.reload}
      footer={
        <Button label="Send request" fullWidth onPress={send} loading={sending} disabled={Boolean(blocker)} disabledReason={blocker ?? undefined} testID="send-request" />
      }
    >
      <ScreenHeader title="Review request" size="compact" back />
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} title="These dates can’t be requested" message={data.error.message} onRetry={data.reload} />
      ) : !d ? (
        <LoadingRows rows={4} label="Checking price and availability" />
      ) : (
        <View style={styles.body}>
          <View style={styles.item}>
            <Text variant="overline" tone="muted" uppercase>{d.listing.categoryLabel}</Text>
            <Text variant="title2">{d.listing.title}</Text>
            <StatusPill label={CONDITION_LABEL[d.listing.condition]} />
          </View>
          {!d.quote.available ? <Banner tone="danger" title="No longer available" message="Someone booked these dates. Go back and choose others." /> : null}
          {sendError ? <Banner tone="danger" title="Request not sent" message={sendError.message} testID="send-error" /> : null}
          <PriceBreakdown
            rentalDays={d.quote.rentalDays}
            dailyRate={d.quote.dailyRate}
            subtotal={d.quote.subtotal}
            deposit={d.quote.deposit}
            total={d.quote.total}
            lateFeePerDay={d.quote.lateFeePerDay}
            pickupDate={pickup}
            returnDate={ret}
            dueTimeLocal={d.quote.returnDueTimeLocal}
            confirmed={d.quote.available}
          />
          <Text variant="footnote" tone="muted">Nothing is charged when you send a request. If the lender accepts, you’ll have a short window to complete the demo payment.</Text>
          <TextField
            label="Pickup note (optional)"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={300}
            placeholder="e.g. I can pick up after my 1 PM class"
            helper={`Pickup point: ${d.listing.pickupPointLabel ?? 'arranged in messages'}. No phone numbers: coordinate in TigRent messages.`}
            error={noteProblem}
            testID="pickup-note"
          />
          {d.rentalTerms ? (
            <Section title="Rental terms">
              <View style={styles.terms}>
                <Text variant="footnote" tone="muted">{d.rentalTerms.title} · version {d.rentalTerms.version}{d.rentalTerms.isSample ? ' · prototype text, not legally reviewed' : ''}</Text>
                <Text variant="callout">{d.rentalTerms.content}</Text>
              </View>
              <Checkbox label="I accept the rental terms, the price above and the return date." checked={accepted} onChange={setAccepted} />
            </Section>
          ) : (
            <Banner tone="warning" title="Rental terms unavailable" message="Pull down to refresh before sending a request." />
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  item: { gap: spacing.xs },
  terms: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
});
