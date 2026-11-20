import type { BookingStatus } from '@/domain/entities';
import type { DateOnly } from '@/lib/dates';
import { getSupabase } from '@/lib/supabase';
import { run, runMaybe } from './base';

export type ConversationSummary = {
  conversationId: string;
  bookingId: string;
  bookingStatus: BookingStatus;
  listingTitle: string;
  myRole: 'borrower' | 'lender';
  counterpartName: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastSenderIsMe: boolean;
  unreadCount: number;
};

export type ChatMessage = { id: string; body: string; senderIsMe: boolean; createdAt: string };

export type ConversationDetail = {
  id: string;
  bookingId: string;
  bookingStatus: BookingStatus;
  listingTitle: string;
  pickupDate: DateOnly;
  returnDate: DateOnly;
  myRole: 'borrower' | 'lender' | 'staff';
  counterpart: { id: string; fullName: string };
  /** Why sending is closed (declined/cancelled/expired booking), or null when open. */
  closedReason: string | null;
  otherLastReadAt: string | null;
  messages: ChatMessage[];
};

export function toConversationDetail(json: unknown): ConversationDetail {
  const r = (json ?? {}) as Record<string, unknown>;
  const c = (r.counterpart ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    bookingId: String(r.booking_id),
    bookingStatus: r.booking_status as BookingStatus,
    listingTitle: String(r.listing_title ?? ''),
    pickupDate: String(r.pickup_date ?? ''),
    returnDate: String(r.return_date ?? ''),
    myRole: r.my_role === 'lender' ? 'lender' : r.my_role === 'staff' ? 'staff' : 'borrower',
    counterpart: { id: String(c.id ?? ''), fullName: typeof c.full_name === 'string' ? c.full_name : 'TigRent member' },
    closedReason: typeof r.closed_reason === 'string' ? r.closed_reason : null,
    otherLastReadAt: typeof r.other_last_read_at === 'string' ? r.other_last_read_at : null,
    messages: ((r.messages as Record<string, unknown>[]) ?? []).map((m) => ({
      id: String(m.id),
      body: String(m.body ?? ''),
      senderIsMe: m.sender_is_me === true,
      createdAt: String(m.created_at),
    })),
  };
}

/** Booking-linked messages (plan §4.1, Phase 9). Every write is an RPC; reads are participant-only. */
export const messagesRepository = {
  list: (role: 'borrower' | 'lender') =>
    run(getSupabase().rpc('list_my_conversations', { p_role: role }), (rows) =>
      rows.map(
        (r): ConversationSummary => ({
          conversationId: r.conversation_id ?? '',
          bookingId: r.booking_id ?? '',
          bookingStatus: (r.booking_status ?? 'pending_lender_approval') as BookingStatus,
          listingTitle: r.listing_title ?? '',
          myRole: r.my_role === 'lender' ? 'lender' : 'borrower',
          counterpartName: r.counterpart_name ?? 'TigRent member',
          lastMessage: r.last_message,
          lastMessageAt: r.last_message_at,
          lastSenderIsMe: r.last_sender_is_me ?? false,
          unreadCount: r.unread_count ?? 0,
        }),
      ),
    ),
  get: (conversationId: string) => run(getSupabase().rpc('get_conversation', { p_conversation_id: conversationId }), toConversationDetail),
  send: (conversationId: string, body: string) =>
    run(getSupabase().rpc('send_message', { p_conversation_id: conversationId, p_body: body.trim() }), (id) => id as string),
  markRead: (conversationId: string) => runMaybe(getSupabase().rpc('mark_conversation_read', { p_conversation_id: conversationId }), () => true),
};
