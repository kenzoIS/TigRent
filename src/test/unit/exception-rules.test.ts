import { canOfferCancel, checkClaimAmount, checkDescription, decisionPreview, lateFeeSettlement } from '@/domain/exceptions';
import { targetFor } from '@/features/notifications/targets';
import { toCancellationQuote } from '@/repositories/bookings';
import { toDisputeDetail } from '@/repositories/disputes';

describe('who may cancel (plan §2.6)', () => {
  it('borrowers cancel requests and pre-pickup bookings; lenders decline instead of cancelling requests; nobody cancels after pickup', () => {
    expect(canOfferCancel('borrower', 'pending_lender_approval')).toBe(true);
    expect(canOfferCancel('lender', 'pending_lender_approval')).toBe(false);
    expect(canOfferCancel('lender', 'confirmed')).toBe(true);
    expect(canOfferCancel('borrower', 'awaiting_payment')).toBe(true);
    for (const s of ['active', 'overdue', 'return_requested', 'disputed', 'completed', 'cancelled'] as const) {
      expect(canOfferCancel('borrower', s)).toBe(false);
      expect(canOfferCancel('lender', s)).toBe(false);
    }
  });
});

describe('late fee settlement', () => {
  it('uses the agreed fee per late day, withheld from the deposit and capped at it', () => {
    expect(lateFeeSettlement(0, 2000, 30000)).toEqual({ fee: 0, withheld: 0, uncollected: 0, released: 30000 });
    expect(lateFeeSettlement(2, 2000, 30000)).toEqual({ fee: 4000, withheld: 4000, uncollected: 0, released: 26000 });
    expect(lateFeeSettlement(20, 2000, 30000)).toEqual({ fee: 40000, withheld: 30000, uncollected: 10000, released: 0 });
  });
});

describe('claims and decisions', () => {
  it('claims stay within what TigRent holds', () => {
    expect(checkClaimAmount(5000, 30000)).toBeNull();
    expect(checkClaimAmount(30001, 30000)).toMatch(/more than TigRent holds/);
    expect(checkClaimAmount(null, 30000)).toMatch(/Enter an amount/);
    expect(checkDescription('short')).toMatch(/at least 10/);
  });
  it('a decision preview shows who receives what', () => {
    expect(decisionPreview({ deposit: 30000, rentPaid: 12000, depositToLender: 5000, rentRefund: 0 })).toEqual({ borrowerGets: 25000, lenderGets: 5000, problems: [] });
    expect(decisionPreview({ deposit: 30000, rentPaid: 12000, depositToLender: 0, rentRefund: 2000 }).borrowerGets).toBe(32000);
    expect(decisionPreview({ deposit: 30000, rentPaid: 12000, depositToLender: 40000, rentRefund: 0 }).problems.length).toBe(1);
  });
});

describe('mapping', () => {
  it('reads the server cancellation quote and dispute case', () => {
    const q = toCancellationQuote({ allowed: true, rule: 'borrower_cancel_before_pickup', rent_refund_pct: 50, rent_refund: 6000, deposit_refund: 30000, refund_total: 36000, explanation: 'x' });
    expect([q.allowed, q.rentRefundPct, q.refundTotal, q.policyIsSample]).toEqual([true, 50, 36000, true]);
    expect(toCancellationQuote({ allowed: false, reason: 'Decline instead.' })).toMatchObject({ allowed: false, reason: 'Decline instead.', rentRefundPct: null });
    const d = toDisputeDetail({ id: 'd1', booking_id: 'b1', my_role: 'staff', category: 'damage', status: 'under_review', opened_by: 'lender', booking: { deposit: 30000 }, messages: [{ id: 'm', body: 'hi', sender_role: 'borrower' }], evidence: [{ path: 'b1/u/x.jpg', by_role: 'lender' }] });
    expect([d.myRole, d.openedBy, d.booking.deposit, d.messages[0]!.senderRole, d.evidence[0]!.byRole]).toEqual(['staff', 'lender', 30000, 'borrower', 'lender']);
  });
  it('dispute notifications open the case', () => {
    expect(targetFor({ type: 'dispute.opened', entityType: 'dispute', entityId: 'd1' })).toEqual({ kind: 'route', href: '/dispute/d1' });
  });
});
