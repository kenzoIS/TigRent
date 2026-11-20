/**
 * Domain entities (plan §6.1 layer 2): camelCase, money in centavos, dates as YYYY-MM-DD strings.
 * Repositories map database rows into these; screens never handle raw rows.
 */
import type { Centavos } from '@/lib/money';
import type { DateOnly } from '@/lib/dates';
import type { Enums } from '@/types/database';

export type AppRole = Enums<'app_role'>;
export type MarketplaceRole = Enums<'marketplace_role'>;
export type AccountStatus = Enums<'account_status'>;
export type VerificationStatus = Enums<'verification_status'>;
export type ListingStatus = Enums<'listing_status'>;
export type ItemCondition = Enums<'item_condition'>;
export type BookingStatus = Enums<'booking_status'>;
export type TermsDocType = Enums<'terms_doc_type'>;

export type MyProfile = {
  id: string;
  fullName: string;
  avatarPath: string | null;
  accountStatus: AccountStatus;
  statusReason: string | null;
  activeRolePref: MarketplaceRole | null;
};

export type PublicProfile = {
  id: string;
  fullName: string;
  avatarPath: string | null;
  isStudentVerified: boolean;
  reviewCount: number;
  ratingAvg: number | null;
  completedLendings: number;
  completedBorrowings: number;
  memberSince: string;
};

export type AcademicYear = {
  id: string;
  label: string;
  startDate: DateOnly;
  endDate: DateOnly;
  isCurrent: boolean;
  isSample: boolean;
};

export type VerificationRecord = {
  id: string;
  academicYearId: string;
  status: VerificationStatus;
  requestedRoles: MarketplaceRole[];
  reviewReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  expiresAt: string | null;
  provider: string;
};

export type TermsDocument = {
  id: string;
  docType: TermsDocType;
  version: number;
  title: string;
  content: string;
  isSample: boolean;
};

export type ListingSummary = {
  id: string;
  lenderId: string;
  title: string;
  category: string;
  condition: ItemCondition;
  dailyRate: Centavos;
  deposit: Centavos;
  lateFeePerDay: Centavos;
  status: ListingStatus;
  isFeatured: boolean;
};

export type BookingSummary = {
  id: string;
  listingId: string;
  borrowerId: string;
  lenderId: string;
  listingTitle: string;
  pickupDate: DateOnly;
  returnDate: DateOnly;
  rentalDays: number;
  dueAt: string;
  status: BookingStatus;
  total: Centavos;
  deposit: Centavos;
  subtotal: Centavos;
  /** Lender's share after commission (simulated; not paid out). */
  lenderNet: Centavos;
  /** End of the payment hold while `awaiting_payment` (server time). */
  holdExpiresAt: string | null;
};

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};

/** A versioned platform setting; `isSample` marks demonstration values (plan §0.1.9). */
export type PlatformSetting = { key: string; value: unknown; version: number; isSample: boolean; description: string };

export type RatingSummary = { avg: number | null; count: number };
export type Badge = { code: 'student_verified' | 'trusted_lender'; label: string };

export type ProfileSummary = {
  userId: string;
  fullName: string;
  avatarPath: string | null;
  memberSince: string;
  isStudentVerified: boolean;
  completedLendings: number;
  completedBorrowings: number;
  lenderRating: RatingSummary;
  borrowerRating: RatingSummary;
  badges: Badge[];
  trustedLender: {
    earned: boolean;
    ruleIsSample: boolean;
    rule: { minCompletedLendings: number; minAvgRating: number; noUnresolvedSevereDisputes: boolean };
    progress: { studentVerified: boolean; accountInGoodStanding: boolean; completedLendings: number; avgRating: number | null; unresolvedSevereDisputes: number };
  };
};
