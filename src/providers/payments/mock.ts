import { getSupabase } from '@/lib/supabase';
import { run } from '@/repositories/base';
import type { PaymentOutcome, PaymentProvider, PaymentResult } from './types';

export function toPaymentResult(json: unknown): PaymentResult {
  const r = (json ?? {}) as Record<string, unknown>;
  const outcome: PaymentOutcome = r.outcome === 'success' || r.outcome === 'failure' ? r.outcome : 'expired';
  return {
    paymentId: String(r.payment_id ?? ''),
    outcome,
    amount: Number(r.amount ?? 0),
    providerRef: (r.provider_ref as string | null) ?? null,
    failureReason: (r.failure_reason as string | null) ?? null,
    processedAt: (r.processed_at as string | null) ?? null,
    replayed: r.replayed === true,
    bookingStatus: String(r.booking_status ?? ''),
  };
}

/**
 * Mock provider: the server's `pay_booking_demo` plays the gateway. It locks the booking, honours the
 * idempotency key, checks the hold on server time, and writes the payment, ledger and status change
 * in one transaction. The outcome is the scenario the borrower picks (sample setting
 * `payment_provider_mode = mock_user_choice`).
 */
export const mockPaymentProvider: PaymentProvider = {
  id: 'mock',
  label: 'Demo payment',
  isSimulated: true,
  payBooking: ({ bookingId, idempotencyKey, scenario }) =>
    run(getSupabase().rpc('pay_booking_demo', { p_booking_id: bookingId, p_idempotency_key: idempotencyKey, p_scenario: scenario }), toPaymentResult),
  payExtension: ({ extensionId, idempotencyKey, scenario }) =>
    run(getSupabase().rpc('pay_extension_demo', { p_extension_id: extensionId, p_idempotency_key: idempotencyKey, p_scenario: scenario }), toPaymentResult),
};

/** The provider in use. Swap here (behind configuration) when a real gateway is approved. */
export const paymentProvider: PaymentProvider = mockPaymentProvider;

/** A fresh key per checkout attempt (not a secret; uniqueness is all that matters). */
export function newIdempotencyKey(bookingId: string, now: number = Date.now(), rand: () => number = Math.random): string {
  return `checkout:${bookingId.slice(0, 8)}:${now.toString(36)}:${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0')}`;
}
