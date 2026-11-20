import type { Tone } from '@/components/design-system';
import type { ListingStatus } from '@/domain/entities';

/** Lender-facing wording for each listing status (plan §2.3). */
export const LISTING_STATUS: Record<ListingStatus, { label: string; tone: Tone; help: string }> = {
  draft: { label: 'Draft', tone: 'neutral', help: 'Only you can see drafts.' },
  active: { label: 'Active', tone: 'success', help: 'Verified students can find and request this item.' },
  paused: { label: 'Paused', tone: 'warning', help: 'Hidden from search. Existing bookings continue as agreed.' },
  unavailable: { label: 'Unavailable', tone: 'warning', help: 'Hidden from search until you reactivate it. Existing bookings continue.' },
  removed: { label: 'Removed', tone: 'neutral', help: 'Removed listings can’t be changed or published again.' },
};

