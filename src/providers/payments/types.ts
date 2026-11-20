/**
 * Payment provider boundary (plan §2.5, §6.1 layer 5). The prototype ships only the mock provider:
 * no card numbers, CVVs, e-wallet PINs or bank credentials are ever collected, and no money moves.
 * A future real gateway adapter implements this same interface; the server keeps `payments.provider`
 * constrained to 'mock' until then.
 */
import type { Result } from '@/lib/errors';
import type { Centavos } from '@/lib/money';

/** Deterministic demo outcomes so both paths can be exercised on purpose (plan §2.5). */
export type DemoScenario = 'success' | 'failure';

export type PaymentOutcome = 'success' | 'failure' | 'expired';

export type PaymentResult = {
  paymentId: string;
  outcome: PaymentOutcome;
  amount: Centavos;
  providerRef: string | null;
  failureReason: string | null;
  processedAt: string | null;
  /** True when the server returned an earlier result for the same attempt (double tap / retry). */
  replayed: boolean;
  bookingStatus: string;
};

export type BookingPaymentRequest = {
  bookingId: string;
  /** One key per checkout attempt: retries with the same key never charge twice. */
  idempotencyKey: string;
  scenario: DemoScenario;
};

export type ExtensionPaymentRequest = { extensionId: string; idempotencyKey: string; scenario: DemoScenario };

export interface PaymentProvider {
  readonly id: 'mock';
  /** Honest, user-facing label (plan §10.4). */
  readonly label: string;
  readonly isSimulated: true;
  payBooking(req: BookingPaymentRequest): Promise<Result<PaymentResult>>;
  /** Extra days (plan §2.8): the due date moves only when this succeeds. */
  payExtension(req: ExtensionPaymentRequest): Promise<Result<PaymentResult>>;
}
