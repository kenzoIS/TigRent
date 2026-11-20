import { ConversationList } from '@/features/messages/ConversationList';

/** Borrower Messages tab: one conversation per rental (plan §4.1, Phase 9). */
export default function BorrowerMessages() {
  return <ConversationList role="borrower" />;
}
