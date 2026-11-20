import { router } from 'expo-router';
import { Compass } from 'lucide-react-native';
import { EmptyState, Screen } from '@/components/design-system';

export default function NotFound() {
  return (
    <Screen contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <EmptyState
        icon={Compass}
        title="Page not found"
        message="This link doesn’t lead anywhere in TigRent. It may be outdated."
        action={{ label: 'Go to start', onPress: () => router.replace('/') }}
      />
    </Screen>
  );
}
