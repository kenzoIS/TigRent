import { useState, type ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { ArrowLeftRight, Camera, Mail, Package, Search, Store, User } from 'lucide-react-native';
import {
  Banner,
  Button,
  Chip,
  DateField,
  Dialog,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingRows,
  PasswordField,
  Screen,
  ScreenHeader,
  SegmentedControl,
  SelectField,
  Sheet,
  StatusPill,
  Text,
  TextField,
  useToast,
} from '@/components/design-system';
import { Tiggy } from '@/components/mascot/Tiggy';
import { addDays, todayInBusinessTz, type DateOnly } from '@/lib/dates';
import { useMotion } from '@/lib/motion';
import { colors, radii, spacing } from '@/theme';

const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like new' },
  { value: 'good', label: 'Good', description: 'Light signs of use, fully working' },
  { value: 'fair', label: 'Fair' },
] as const;

export default function ComponentGallery() {
  const toast = useToast();
  const motion = useMotion();
  const today = todayInBusinessTz();
  const [role, setRole] = useState<'borrower' | 'lender'>('borrower');
  const [email, setEmail] = useState('');
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]['value'] | null>(null);
  const [date, setDate] = useState<DateOnly | null>(null);
  const [chips, setChips] = useState<string[]>(['Calculators']);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [loading, setLoading] = useState(false);

  const emailError = email.length > 0 && !/^\S+@\S+\.\S+$/.test(email) ? 'Enter a valid email address.' : null;

  return (
    <Screen>
      <ScreenHeader title="Components" eyebrow="Developer only" back />

      <Section title="Motion">
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text variant="body">Reduce motion</Text>
            <Text variant="footnote" tone="muted">Overrides the system setting for testing. Turns off the ambient drift and nonessential animation.</Text>
          </View>
          <Switch
            accessibilityLabel="Reduce motion"
            value={motion.reduceMotion}
            onValueChange={(v) => motion.setReduceMotionOverride(v)}
            trackColor={{ true: colors.primary, false: colors.borderStrong }}
          />
        </View>
      </Section>

      <Section title="Buttons">
        <Button label="Primary action" onPress={() => toast.show({ title: 'Pressed', tone: 'success' })} />
        <Button label="Secondary" variant="secondary" icon={Search} onPress={() => toast.show({ title: 'Secondary pressed' })} />
        <Button label="Tonal" variant="tonal" onPress={() => toast.show({ title: 'Tonal pressed' })} />
        <Button label="Ghost link" variant="ghost" onPress={() => toast.show({ title: 'Ghost pressed' })} />
        <Button label="Danger" variant="danger" onPress={() => setDialog(true)} />
        <Button
          label={loading ? 'Saving' : 'Simulate loading'}
          loading={loading}
          onPress={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1500);
          }}
        />
        <Button label="Publish listing" disabled disabledReason="Complete student verification before publishing listings." />
      </Section>

      <Section title="Role switcher">
        <SegmentedControl
          accessibilityLabel="Active role"
          value={role}
          onChange={setRole}
          segments={[
            { value: 'borrower', label: 'Borrower', icon: User },
            { value: 'lender', label: 'Lender', icon: Store },
          ]}
        />
      </Section>

      <Section title="Fields">
        <TextField label="UST email" required leadingIcon={Mail} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} error={emailError} helper="Use your university email." placeholder="name@example.edu" />
        <PasswordField label="Password" helper="At least 8 characters." />
        <TextField label="Read-only field" value="Disabled example" disabled />
        <TextField label="Notes" multiline placeholder="Pickup instructions…" />
        <SelectField label="Condition" value={condition} onChange={setCondition} options={CONDITIONS} required />
        <DateField label="Pickup date" value={date} onChange={setDate} minDate={today} maxDate={addDays(today, 90)} helper="Dates are in Philippine time." unavailableReason={(d) => (d === addDays(today, 3) ? 'Already booked' : null)} />
      </Section>

      <Section title="Chips & status">
        <View style={styles.wrap}>
          {['Calculators', 'Cameras', 'Laptops', 'Drafting'].map((c) => (
            <Chip key={c} label={c} selected={chips.includes(c)} onPress={() => setChips((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))} />
          ))}
        </View>
        <View style={styles.wrap}>
          <StatusPill label="Pending review" tone="warning" />
          <StatusPill label="Verified student" tone="success" />
          <StatusPill label="Demo payment" tone="info" />
          <StatusPill label="Overdue" tone="danger" />
          <StatusPill label="Draft" />
        </View>
      </Section>

      <Section title="Rows, sheet, toast">
        <View style={styles.card}>
          <ListRow title="Open bottom sheet" icon={ArrowLeftRight} onPress={() => setSheet(true)} />
          <ListRow title="Show toast" icon={Package} onPress={() => toast.show({ title: 'Listing saved', message: 'Saved as draft.', tone: 'success' })} />
          <ListRow title="Static row" subtitle="Non-interactive" value="₱120/day" />
        </View>
      </Section>

      <Section title="Banners">
        <Banner tone="info" title="Demo payment" message="Checkout is simulated. No real money moves." />
        <Banner tone="warning" title="Verification pending" message="An administrator is reviewing your documents." action={{ label: 'View status', onPress: () => toast.show({ title: 'Banner action works' }) }} />
        <Banner tone="danger" title="Upload failed" message="The file is larger than the allowed size." onDismiss={() => toast.show({ title: 'Dismissed' })} />
      </Section>

      <Section title="States">
        <LoadingRows rows={2} />
        <EmptyState icon={Camera} title="No equipment yet" message="List an item you aren’t using and set your own daily rate." action={{ label: 'Show toast', onPress: () => toast.show({ title: 'Empty-state action works' }) }} />
        <ErrorState offline message="Check your connection and try again." onRetry={() => toast.show({ title: 'Retry pressed' })} />
      </Section>

      <Section title="Tiggy">
        <Tiggy size="md" message="Tap the close button to dismiss my tips." />
        <Tiggy size="sm" />
      </Section>

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Bottom sheet" description="Focused task surface." footer={<Button label="Done" onPress={() => setSheet(false)} fullWidth />}>
        <Text variant="body">Sheets close via the backdrop, the close button, Android back, or a completing action.</Text>
        <TextField label="Field inside a sheet" placeholder="Keyboard stays clear of this" />
      </Sheet>
      <Dialog
        visible={dialog}
        title="Remove listing?"
        message="It will disappear from search. Existing bookings keep their agreed terms."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          setDialog(false);
          toast.show({ title: 'Confirmed', tone: 'danger' });
        }}
        onCancel={() => setDialog(false)}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" tone="muted" uppercase>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md, marginTop: spacing.xxl },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
});
