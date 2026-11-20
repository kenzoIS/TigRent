import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { EmptyState, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, StatusPill, Text } from '@/components/design-system';
import { Group } from '@/components/shared/Layout';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { statusLabelFor } from '@/features/bookings/status';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { messagesRepository } from '@/repositories';
import { spacing } from '@/theme';

/** Messages tab for one side of the marketplace (plan §4.1): one conversation per booking. */
export function ConversationList({ role }: { role: 'borrower' | 'lender' }) {
  const list = useAsync(() => messagesRepository.list(role), [role]);
  const { reload } = list;
  useFocusEffect(useCallback(() => void reload(), [reload]));

  return (
    <Screen withTabBar refreshing={list.loading && Boolean(list.data)} onRefresh={reload}>
      <ScreenHeader title="Messages" eyebrow={role === 'lender' ? 'Lending' : 'Borrowing'} right={<NotificationBell />} />
      {list.error ? (
        <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={reload} />
      ) : !list.data ? (
        <LoadingRows rows={3} label="Loading messages" />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="No conversations yet"
          message={role === 'lender' ? 'Each booking request gets its own conversation with the borrower.' : 'Each rental gets its own conversation with the lender, to arrange pickup and return.'}
        />
      ) : (
        <View style={styles.body}>
          <Group>
            {list.data.map((c) => {
              const l = statusLabelFor(role, c.bookingStatus);
              return (
                <ListRow
                  key={c.conversationId}
                  icon={MessageCircle}
                  title={`${c.counterpartName}${c.unreadCount > 0 ? ` (${c.unreadCount} new)` : ''}`}
                  subtitle={`${c.listingTitle}\n${c.lastMessage ? `${c.lastSenderIsMe ? 'You: ' : ''}${c.lastMessage}` : 'No messages yet'}`}
                  trailing={<StatusPill label={l.label} tone={l.tone} />}
                  onPress={() => router.push({ pathname: '/messages/[id]', params: { id: c.conversationId } })}
                  testID={`conversation-${c.conversationId}`}
                />
              );
            })}
          </Group>
          <Text variant="footnote" tone="muted">
            {list.data[0]?.lastMessageAt ? `Latest message ${formatDateTimeManila(list.data[0].lastMessageAt)}. ` : ''}Messages are in-app only in this prototype.
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
});
