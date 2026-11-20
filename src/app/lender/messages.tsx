import { ConversationList } from '@/features/messages/ConversationList';

/** Lender Messages tab: one conversation per booking request (plan §4.1, Phase 9). */
export default function LenderMessages() {
  return <ConversationList role="lender" />;
}
