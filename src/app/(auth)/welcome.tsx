import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { BadgeCheck, CalendarCheck, ShieldCheck } from 'lucide-react-native';
import { Button, Icon, Screen, Text } from '@/components/design-system';
import { Tiggy } from '@/components/mascot/Tiggy';
import { Wordmark } from '@/components/shared/Wordmark';
import { appConfig } from '@/config/app';
import { colors, radii, spacing } from '@/theme';

const POINTS = [
  { icon: BadgeCheck, title: 'Students only', body: 'Every member goes through TigRent student verification before renting or lending.' },
  { icon: CalendarCheck, title: 'Clear daily rates', body: 'See the full price, deposit and return date before you send a request.' },
  { icon: ShieldCheck, title: 'Agreed terms', body: 'Deposits, returns and disputes follow the terms both sides accept.' },
] as const;

export default function Welcome() {
  return (
    <Screen
      background="ambient"
      footer={
        <>
          <Button label="Create account" onPress={() => router.push('/sign-up')} fullWidth testID="welcome-create" />
          <Button label="I already have an account" variant="ghost" onPress={() => router.push('/sign-in')} fullWidth testID="welcome-signin" />
        </>
      }
    >
      <View style={styles.hero}>
        <Wordmark size="lg" />
        <Text variant="title2" style={styles.tagline}>{appConfig.tagline}</Text>
        <Text variant="callout" tone="muted">{appConfig.communityLabel}. Borrow academic essentials for a few days, or earn from equipment you aren’t using.</Text>
      </View>
      <View style={styles.mascot}>
        <Tiggy size="lg" message="Hi! I’m Tiggy. Create an account to get started. Your student details are reviewed before you can rent or lend." />
      </View>
      <View style={styles.points}>
        {POINTS.map((p) => (
          <View key={p.title} style={styles.point}>
            <View style={styles.pointIcon}>
              <Icon as={p.icon} color={colors.link} />
            </View>
            <View style={styles.pointText}>
              <Text variant="bodyStrong">{p.title}</Text>
              <Text variant="subhead" tone="muted">{p.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text variant="footnote" tone="faint" style={styles.disclaimer}>
        TigRent is a student project prototype and is not an official University of Santo Tomas service.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.sm, paddingTop: spacing.xxl },
  tagline: { marginTop: spacing.xs },
  mascot: { alignItems: 'center', paddingVertical: spacing.lg },
  points: { gap: spacing.lg },
  point: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  pointIcon: { width: 40, height: 40, borderRadius: radii.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, gap: 2 },
  disclaimer: { marginTop: spacing.xxl },
});
