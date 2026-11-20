import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Star } from 'lucide-react-native';
import { ListRow } from '@/components/design-system';
import { Group, Section } from '@/components/shared/Layout';
import { useAsync } from '@/lib/use-async';
import { trustRepository } from '@/repositories';

/** Post-completion review prompts (plan Phase 11) for one side of the marketplace. Hidden when empty. */
export function ReviewPrompts({ role }: { role: 'borrower' | 'lender' }) {
  const prompts = useAsync(() => trustRepository.prompts(), []);
  const { reload } = prompts;
  useFocusEffect(useCallback(() => void reload(), [reload]));
  const mine = (prompts.data ?? []).filter((p) => p.myRole === role);
  if (mine.length === 0) return null;
  return (
    <Section title={`Rate your recent rental${mine.length === 1 ? '' : 's'}`}>
      <Group>
        {mine.slice(0, 3).map((p) => (
          <ListRow
            key={p.bookingId}
            icon={Star}
            title={`Rate ${p.counterpartName.split(' ')[0]}`}
            subtitle={p.listingTitle}
            onPress={() => router.push({ pathname: '/booking/[id]', params: { id: p.bookingId } })}
            showChevron
            testID={`review-prompt-${p.bookingId}`}
          />
        ))}
      </Group>
    </Section>
  );
}
