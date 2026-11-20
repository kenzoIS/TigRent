import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { Icon } from '@/components/design-system/Icon';
import { Text } from '@/components/design-system/Text';
import { notificationInboxRepository } from '@/repositories';
import { colors, radii, touchTarget } from '@/theme';

/** Header bell with the real unread count (refreshed whenever the screen regains focus). */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      notificationInboxRepository.unreadCount().then((r) => active && r.ok && setUnread(r.data));
      return () => {
        active = false;
      };
    }, []),
  );
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <Pressable onPress={() => router.push('/notifications')} accessibilityRole="button" accessibilityLabel={label} style={styles.btn} hitSlop={4} testID="notification-bell">
      <Icon as={Bell} size="lg" color={colors.text} />
      {unread > 0 ? (
        <View style={styles.badge} importantForAccessibility="no" accessibilityElementsHidden>
          <Text variant="caption" style={styles.count}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, marginRight: -8 },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.accentSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  count: { color: '#FFFFFF', fontSize: 10, lineHeight: 12, fontWeight: '700' },
});
