import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen, ScreenHeader, SegmentedControl, Text } from '@/components/design-system';
import { Section } from '@/components/shared/Layout';
import { useSession } from '@/features/auth/session';
import { ReviewList } from '@/features/reviews/ReviewList';
import { ReviewPrompts } from '@/features/reviews/ReviewPrompts';
import { spacing } from '@/theme';

/** My reviews (plan §2.9): rentals waiting for my rating, and the ratings I received in each role. */
export default function MyReviews() {
  const { context } = useSession();
  const [side, setSide] = useState<'lender' | 'borrower'>(context?.roles.includes('lender') ? 'lender' : 'borrower');
  return (
    <Screen>
      <ScreenHeader title="My reviews" size="compact" back />
      <View style={styles.body}>
        <ReviewPrompts role="borrower" />
        <ReviewPrompts role="lender" />
        <SegmentedControl
          segments={[{ value: 'lender', label: 'As lender' }, { value: 'borrower', label: 'As borrower' }] as const}
          value={side}
          onChange={setSide}
          accessibilityLabel="Which reviews"
        />
        <Section title={side === 'lender' ? 'From borrowers' : 'From lenders'}>
          {context ? (
            <ReviewList userId={context.userId} direction={side === 'lender' ? 'borrower_to_lender' : 'lender_to_borrower'} emptyText="No reviews yet." />
          ) : null}
        </Section>
        <Text variant="footnote" tone="muted">
          Ratings are 1 to 5 stars, one per rental per side, and only after completion. You can report a review you think breaks the rules; a moderator decides. Hidden reviews don’t count towards ratings, badges or account health.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
});
