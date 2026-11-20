import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CalendarPlus } from 'lucide-react-native';
import {
  Banner,
  Button,
  DateField,
  Dialog,
  ErrorState,
  ListRow,
  LoadingRows,
  Screen,
  ScreenHeader,
  Sheet,
  StatusPill,
  TextField,
  useToast,
} from '@/components/design-system';
import { useAsync } from '@/lib/use-async';
import { academicYearAdminRepository } from '@/repositories';
import type { DateOnly } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme';

/** Academic-year configuration (plan §2.2: admin-configured, never hard-coded). */
export default function AcademicYears() {
  const toast = useToast();
  const years = useAsync(() => academicYearAdminRepository.listAll(), []);
  const [target, setTarget] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [start, setStart] = useState<DateOnly | null>(null);
  const [end, setEnd] = useState<DateOnly | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const makeCurrent = async () => {
    if (!target) return;
    setBusy(true);
    const r = await academicYearAdminRepository.setCurrent(target.id);
    setBusy(false);
    setTarget(null);
    if (!r.ok) return setError(r.error.message);
    toast.show({ title: `${r.data.label} is now current`, message: `${r.data.expiredVerifications} verification(s) expired; those students were asked to renew.`, tone: 'success' });
    void years.reload();
  };

  const add = async () => {
    if (!start || !end) return setAddError('Choose both dates.');
    setBusy(true);
    const r = await academicYearAdminRepository.create(label, start, end);
    setBusy(false);
    if (!r.ok) return setAddError(r.error.message);
    setAdding(false);
    setLabel('');
    setStart(null);
    setEnd(null);
    toast.show({ title: 'Academic year added', tone: 'success' });
    void years.reload();
  };

  return (
    <Screen footer={<Button label="Add academic year" icon={CalendarPlus} variant="secondary" onPress={() => setAdding(true)} fullWidth />}>
      <ScreenHeader title="Academic years" size="compact" back />
      <View style={styles.body}>
        <Banner tone="info" title="How this affects verification" message="Students must submit a registration form for the current year. Making another year current expires older verifications (sample policy), and those students are asked to renew." />
        {error ? <Banner tone="danger" title="Couldn’t change the year" message={error} onDismiss={() => setError(null)} /> : null}
        {years.error ? (
          <ErrorState message={years.error.message} onRetry={years.reload} />
        ) : !years.data ? (
          <LoadingRows rows={2} />
        ) : (
          <View style={styles.card}>
            {years.data.map((y) => (
              <ListRow
                key={y.id}
                title={y.label}
                subtitle={`${y.startDate} → ${y.endDate}${y.isSample ? ' · sample dates' : ''}`}
                trailing={
                  y.isCurrent ? (
                    <StatusPill label="Current" tone="success" />
                  ) : (
                    <Button label="Make current" size="sm" variant="ghost" onPress={() => setTarget({ id: y.id, label: y.label })} />
                  )
                }
              />
            ))}
          </View>
        )}
      </View>

      <Dialog
        visible={target !== null}
        title={`Make ${target?.label ?? ''} current?`}
        message="Verifications for other academic years will expire now and those students must renew before renting or lending. Existing rentals are not cancelled."
        confirmLabel="Make current"
        destructive
        loading={busy}
        onConfirm={makeCurrent}
        onCancel={() => setTarget(null)}
      />
      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add academic year" footer={<Button label="Add" onPress={add} loading={busy} fullWidth />}>
        <View style={styles.form}>
          {addError ? <Banner tone="danger" title={addError} /> : null}
          <TextField label="Label" value={label} onChangeText={setLabel} placeholder="AY 2027–2028" required />
          <DateField label="Start date" value={start} onChange={setStart} required />
          <DateField label="End date" value={end} onChange={setEnd} minDate={start ?? undefined} required />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  form: { gap: spacing.lg },
});
