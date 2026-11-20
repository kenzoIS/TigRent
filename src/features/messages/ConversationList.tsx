import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ChevronRight, MessageCircle, Package, ShieldCheck, User } from 'lucide-react-native';
import {
  EmptyState,
  ErrorState,
  Icon,
  LoadingRows,
  Screen,
  ScreenHeader,
  StatusPill,
  Text,
} from '@/components/design-system';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { statusLabelFor } from '@/features/bookings/status';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { messagesRepository } from '@/repositories';
import { colors, elevation, radii, spacing } from '@/theme';

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
          {list.data.map((c) => {
            const l = statusLabelFor(role, c.bookingStatus);
            const initials = c.counterpartName
              ? c.counterpartName
                  .split(' ')
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()
              : '?';

            return (
              <Pressable
                key={c.conversationId}
                onPress={() => router.push({ pathname: '/messages/[id]', params: { id: c.conversationId } })}
                accessibilityRole="button"
                accessibilityLabel={`Chat with ${c.counterpartName} regarding ${c.listingTitle}`}
                style={({ pressed }) => [
                  styles.chatCard,
                  elevation.low,
                  pressed && styles.chatCardPressed,
                  c.unreadCount > 0 && styles.chatCardUnread,
                ]}
                testID={`conversation-${c.conversationId}`}
              >
                {/* Avatar with initials */}
                <View style={[styles.avatarCircle, c.unreadCount > 0 && styles.avatarCircleUnread]}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>

                {/* Main Content Area */}
                <View style={styles.chatInfo}>
                  <View style={styles.chatHeader}>
                    <Text style={styles.studentName} numberOfLines={1}>
                      {c.counterpartName}
                    </Text>
                    {c.lastMessageAt ? (
                      <Text style={styles.timeText}>
                        {formatDateTimeManila(c.lastMessageAt).split(', ')[1]}
                      </Text>
                    ) : null}
                  </View>

                  {/* Gear Reference & Status Pill */}
                  <View style={styles.metaRow}>
                    <View style={styles.gearPill}>
                      <Icon as={Package} size={11} color={colors.link} />
                      <Text style={styles.gearTitle} numberOfLines={1}>
                        {c.listingTitle}
                      </Text>
                    </View>
                    <StatusPill label={l.label} tone={l.tone} />
                  </View>

                  {/* Message Preview */}
                  <View style={styles.previewRow}>
                    <Text
                      style={[
                        styles.messagePreview,
                        c.unreadCount > 0 && styles.messagePreviewUnread,
                      ]}
                      numberOfLines={1}
                    >
                      {c.lastMessage ? `${c.lastSenderIsMe ? 'You: ' : ''}${c.lastMessage}` : 'No messages yet'}
                    </Text>

                    {c.unreadCount > 0 ? (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>+{c.unreadCount} new</Text>
                      </View>
                    ) : (
                      <Icon as={ChevronRight} size={15} color={colors.textFaint} />
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}

          <View style={styles.safetyNotice}>
            <Icon as={ShieldCheck} size={14} color={colors.textMuted} />
            <Text variant="footnote" tone="muted" style={styles.safetyText}>
              In-app chat protects your student privacy. Arrange campus pick-up points safely.
            </Text>
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm + 2,
    paddingBottom: spacing.lg,
  },
  chatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatCardPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.995 }],
  },
  chatCardUnread: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  avatarCircleUnread: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  avatarInitials: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  chatInfo: {
    flex: 1,
    gap: 4,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  studentName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  timeText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gearPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceSunken,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    maxWidth: 160,
  },
  gearTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.link,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingTop: 2,
  },
  messagePreview: {
    fontSize: 12.5,
    color: colors.textMuted,
    flex: 1,
  },
  messagePreviewUnread: {
    fontWeight: '600',
    color: colors.text,
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  unreadBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.ink,
  },
  safetyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  safetyText: {
    flex: 1,
    fontSize: 11.5,
  },
});
