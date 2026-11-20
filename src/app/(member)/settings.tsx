import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { BookOpen, CircleQuestionMark, CreditCard, LifeBuoy, LogOut, Scale, ShieldCheck } from 'lucide-react-native';
import { Banner, Button, Dialog, ListRow, Screen, ScreenHeader, Sheet, Text } from '@/components/design-system';
import { Group, Section } from '@/components/shared/Layout';
import { appConfig } from '@/config/app';
import { useSession } from '@/features/auth/session';
import { useMotion } from '@/lib/motion';
import { colors, spacing } from '@/theme';

type HelpTopic = { id: string; title: string; icon: typeof ShieldCheck; body: string };

const HELP: HelpTopic[] = [
  {
    id: 'verification',
    title: 'How does student verification work?',
    icon: ShieldCheck,
    body: 'You submit your UST email, student ID, academic year and current registration form. A TigRent reviewer checks them manually. This prototype doesn’t connect to UST systems or an external verification service. Your student ID and documents are private: only you and reviewers can see them.',
  },
  {
    id: 'payments',
    title: 'Are payments real?',
    icon: CreditCard,
    body: 'No. Checkout, refunds and lender payouts in this prototype are simulated. TigRent never asks for card numbers, GCash or Maya PINs, or bank passwords. Amounts shown are what a real transaction would be, for demonstration only.',
  },
  {
    id: 'pricing',
    title: 'How is the rental price calculated?',
    icon: CircleQuestionMark,
    body: 'You pay the lender’s daily rate for every day from pickup to the return date, both days included (minimum one day), plus a refundable deposit. The full breakdown is shown before you send a request.',
  },
  {
    id: 'disputes',
    title: 'What if an item is late, damaged or missing?',
    icon: Scale,
    body: 'Late returns use the late fee shown on the listing. Damage or missing items go through the TigRent dispute process, where both sides can respond and a moderator decides. Deposits are never kept without a recorded reason.',
  },
];

/** Settings, help and policies (plan §4.1, Phase 5). */
export default function SettingsScreen() {
  const { signOut } = useSession();
  const motion = useMotion();
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen>
      <ScreenHeader title="Settings & help" size="compact" back />

      <Section title="Preferences">
        <Group>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text variant="body">Reduce motion</Text>
              <Text variant="footnote" tone="muted">Turns off the moving background and nonessential animation on this device.</Text>
            </View>
            <Switch
              accessibilityLabel="Reduce motion"
              value={motion.reduceMotion}
              onValueChange={(v) => motion.setReduceMotionOverride(v)}
              trackColor={{ true: colors.primary, false: colors.borderStrong }}
              testID="reduce-motion-switch"
            />
          </View>
        </Group>
      </Section>

      <Section title="Help">
        <Group>
          {HELP.map((h) => (
            <ListRow key={h.id} icon={h.icon} title={h.title} onPress={() => setTopic(h)} testID={`help-${h.id}`} />
          ))}
          <ListRow icon={LifeBuoy} title="Contact support" subtitle="In-app support messaging arrives in Phase 9." disabled />
        </Group>
      </Section>

      <Section title="Legal">
        <Group>
          <ListRow icon={BookOpen} title="Terms, Privacy and Rental Terms" onPress={() => router.push('/policies')} />
        </Group>
      </Section>

      <Section title="About">
        <Banner
          tone="neutral"
          title={`${appConfig.productName} prototype ${version}`}
          message="A student project prototype for the UST community. Not an official University of Santo Tomas service. Student verification is a manual demo review, and all payments are simulated."
        />
      </Section>

      <Button label="Sign out" variant="secondary" icon={LogOut} onPress={() => setConfirmOut(true)} style={styles.signOut} />

      <Sheet visible={topic !== null} onClose={() => setTopic(null)} title={topic?.title ?? ''}>
        <Text variant="body">{topic?.body}</Text>
      </Sheet>
      <Dialog
        visible={confirmOut}
        title="Sign out?"
        message="You’ll need your email and password to sign in again."
        confirmLabel="Sign out"
        onCancel={() => setConfirmOut(false)}
        onConfirm={async () => {
          setConfirmOut(false);
          await signOut();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  flex: { flex: 1, gap: 2 },
  signOut: { marginTop: spacing.xxl },
});
