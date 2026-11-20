import { Tabs } from 'expo-router/js-tabs';
import { Inbox, LayoutDashboard, MessageCircle, Package, User } from 'lucide-react-native';
import { TabBar } from '@/components/shared/TabBar';
import { AreaGuard } from '@/features/auth/guards';
import { iconStroke } from '@/theme';

export default function LenderTabs() {
  return (
    <AreaGuard area="lender">
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarButtonTestID: 'tab-dashboard', tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} strokeWidth={iconStroke} /> }} />
      <Tabs.Screen name="equipment" options={{ title: 'Equipment', tabBarButtonTestID: 'tab-equipment', tabBarIcon: ({ color, size }) => <Package color={color} size={size} strokeWidth={iconStroke} /> }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests', tabBarButtonTestID: 'tab-requests', tabBarIcon: ({ color, size }) => <Inbox color={color} size={size} strokeWidth={iconStroke} /> }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarButtonTestID: 'tab-messages', tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} strokeWidth={iconStroke} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarButtonTestID: 'tab-profile', tabBarIcon: ({ color, size }) => <User color={color} size={size} strokeWidth={iconStroke} /> }} />
    </Tabs>
    </AreaGuard>
  );
}
