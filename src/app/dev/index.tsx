import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Palette, Server } from 'lucide-react-native';
import { Banner, ListRow, Screen, ScreenHeader, Text, useToast } from '@/components/design-system';
import { termsRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const GROUPS: { title: string; routes: { label: string; href: Href; phase: number }[] }[] = [
  { title: 'Auth', routes: [
    { label: 'Welcome', href: '/welcome', phase: 1 },
    { label: 'Sign in', href: '/sign-in', phase: 3 },
    { label: 'Create account', href: '/sign-up', phase: 3 },
    { label: 'Reset password', href: '/forgot-password', phase: 3 },
    { label: 'Confirm email', href: '/check-email', phase: 3 },
  ] },
  { title: 'Onboarding', routes: [
    { label: 'Terms & Privacy', href: '/onboarding/terms', phase: 4 },
    { label: 'Student verification', href: '/onboarding/verification', phase: 4 },
    { label: 'Verification status', href: '/onboarding/status', phase: 4 },
  ] },
  { title: 'Role areas', routes: [
    { label: 'Borrower tabs', href: '/borrower', phase: 5 },
    { label: 'Lender tabs', href: '/lender', phase: 5 },
    { label: 'Search equipment', href: '/explore/search', phase: 7 },
    { label: 'New listing', href: '/manage/listings/new', phase: 6 },
    { label: 'Admin', href: '/admin', phase: 4 },
  ] },
  { title: 'Shared', routes: [
    { label: 'Notifications', href: '/notifications', phase: 5 },
    { label: 'Settings & help', href: '/settings', phase: 5 },
    { label: 'Terms & policies', href: '/policies', phase: 5 },
    { label: 'Account restricted', href: '/restricted', phase: 3 },
    { label: 'Loading / bootstrap', href: '/loading', phase: 1 },
    { label: 'Unknown link (404)', href: '/this-route-does-not-exist' as Href, phase: 1 },
  ] },
];

export default function DevRouteMap() {
  const toast = useToast();
  const [backend, setBackend] = useState<string | null>(null);

  const checkBackend = async () => {
    setBackend('Checking…');
    const r = await termsRepository.listActive();
    if (r.ok) {
      setBackend(`Connected · ${r.data.length} active policy documents (anonymous read through RLS)`);
      toast.show({ title: 'Backend reachable', message: 'Supabase responded through the app client.', tone: 'success' });
    } else {
      setBackend(`Failed · ${r.error.kind}: ${r.error.message}`);
      toast.show({ title: 'Backend check failed', message: r.error.message, tone: 'danger' });
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Route map" eyebrow="Developer only" back />
      <Banner tone="warning" title="Development build tool" message="Lists every route for navigation checks. It is not available in production builds." />
      <View style={styles.group}>
        <ListRow title="Component gallery" subtitle="Design-system primitives and their states" icon={Palette} iconTint={colors.primarySoft} onPress={() => router.push('/dev/components')} />
        <ListRow
          title="Backend connection"
          subtitle={backend ?? 'Reads the public Terms through the app’s Supabase client'}
          icon={Server}
          iconTint={colors.primarySoft}
          onPress={checkBackend}
          testID="dev-backend-check"
        />
      </View>
      {GROUPS.map((g) => (
        <View key={g.title} style={styles.group}>
          <Text variant="overline" tone="muted" uppercase style={styles.groupTitle}>{g.title}</Text>
          <View style={styles.card}>
            {g.routes.map((r) => (
              <ListRow key={r.label} title={r.label} value={`Phase ${r.phase}`} onPress={() => router.push(r.href)} />
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: spacing.xl, gap: spacing.sm },
  groupTitle: { marginLeft: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
