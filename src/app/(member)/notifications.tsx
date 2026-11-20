import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { BellOff, CheckCheck } from 'lucide-react-native';
import { Button, EmptyState, ErrorState, LoadingRows, Screen, ScreenHeader, Text, useToast } from '@/components/design-system';
import type { AppNotification } from '@/domain/entities';
import { useSession } from '@/features/auth/session';
import { targetFor } from '@/features/notifications/targets';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { notificationInboxRepository, notificationsRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/** Notification inbox with read state and deep links (plan §4.1, Phase 5). */
export default function Notifications() {
  const { context } = useSession();
  const toast = useToast();
  const list = useAsync(() => notificationsRepository.listMine(100), [context?.userId]);
  const [markingAll, setMarkingAll] = useState(false);
  const { reload } = list;
  useFocusEffect(useCallback(() => void reload(), [reload]));

  const unread = (list.data ?? []).filter((n) => !n.readAt).length;

  const open = (n: AppNotification) => {
    if (!n.readAt) void notificationsRepository.markRead(n.id).then(() => reload());
    const t = targetFor(n);
    if (t.kind === 'route') router.push(t.href as never);
  };

  const markAll = async () => {
    setMarkingAll(true);
    const r = await notificationInboxRepository.markAllRead();
    setMarkingAll(false);
    if (r.ok) {
      toast.show({ title: 'All caught up', tone: 'success' });
      void reload();
    } else {
      toast.show({ title: 'Couldn’t update notifications', message: r.error.message, tone: 'danger' });
    }
  };

  return (
    <Screen refreshing={list.loading && Boolean(list.data)} onRefresh={reload}>
      <ScreenHeader
        title="Notifications"
        size="compact"
        back
        right={
          unread > 0 ? (
            <Button label="Mark all read" variant="ghost" size="sm" icon={CheckCheck} onPress={markAll} loading={markingAll} testID="mark-all-read" />
          ) : undefined
        }
      />
      {list.error ? (
        <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={reload} />
      ) : !list.data ? (
        <LoadingRows rows={4} label="Loading notifications" />
      ) : list.data.length === 0 ? (
        <EmptyState icon={BellOff} title="You’re all caught up" message="Booking, verification and reminder updates will appear here." action={{ label: 'Go home', onPress: () => router.replace('/') }} />
      ) : (
        <View style={styles.list}>
          {list.data.map((n) => {
            const isUnread = !n.readAt;
            return (
              <Pressable
                key={n.id}
                onPress={() => void open(n)}
                accessibilityRole="button"
                accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${n.title}. ${n.body}`}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
                testID={`notification-${n.id}`}
              >
                <View style={[styles.dot, { backgroundColor: isUnread ? colors.accentSecondary : 'transparent' }]} />
                <View style={styles.text}>
                  <Text variant={isUnread ? 'bodyStrong' : 'body'}>{n.title}</Text>
                  {n.body ? <Text variant="subhead" tone="muted">{n.body}</Text> : null}
                  <Text variant="caption" tone="faint">{formatDateTimeManila(n.createdAt)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  item: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.surfaceSunken },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
  text: { flex: 1, gap: 2 },
});
