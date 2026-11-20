import { Tabs } from 'expo-router/js-tabs';
import { CalendarClock, Compass, MessageCircle, User } from 'lucide-react-native';
import { TabBar } from '@/components/shared/TabBar';
import { AreaGuard } from '@/features/auth/guards';
import { iconStroke } from '@/theme';

export default function BorrowerTabs() {
  return (
    <AreaGuard area="borrower">
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Discover', tabBarButtonTestID: 'tab-discover', tabBarIcon: ({ color, size }) => <Compass color={color} size={size} strokeWidth={iconStroke} /> }} />
      <Tabs.Screen name="rentals" options={{ title: 'Rentals', tabBarButtonTestID: 'tab-rentals', tabBarIcon: ({ color, size }) => <CalendarClock color={color} size={size} strokeWidth={iconStroke} /> }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarButtonTestID: 'tab-messages', tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} strokeWidth={iconStroke} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarButtonTestID: 'tab-profile', tabBarIcon: ({ color, size }) => <User color={color} size={size} strokeWidth={iconStroke} /> }} />
    </Tabs>
    </AreaGuard>
  );
}
