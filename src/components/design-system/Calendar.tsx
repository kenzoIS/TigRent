import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import {
  compareDateOnly,
  daysInMonth,
  formatDateOnly,
  monthLabel,
  parseDateOnly,
  toDateOnly,
  todayInBusinessTz,
  weekdayInitials,
  weekdayOf,
  type DateOnly,
} from '@/lib/dates';
import { colors, maxFontScale, radii, spacing, touchTarget } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

export type CalendarProps = {
  value: DateOnly | null;
  onChange: (value: DateOnly) => void;
  minDate?: DateOnly;
  maxDate?: DateOnly;
  /** Extra per-day rule, e.g. booked/blocked dates (Phase 6/7). Returns a reason when unavailable. */
  unavailableReason?: (date: DateOnly) => string | null;
  /** Optional highlighted range (e.g. pickup→return). */
  rangeStart?: DateOnly | null;
  rangeEnd?: DateOnly | null;
};

export function Calendar({ value, onChange, minDate, maxDate, unavailableReason, rangeStart, rangeEnd }: CalendarProps) {
  const today = todayInBusinessTz();
  const anchor = parseDateOnly(value ?? minDate ?? today);
  const [view, setView] = useState({ year: anchor.year, month: anchor.month });

  const cells = useMemo(() => {
    const first = toDateOnly(view.year, view.month, 1);
    const lead = weekdayOf(first);
    const count = daysInMonth(view.year, view.month);
    const out: (DateOnly | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) out.push(toDateOnly(view.year, view.month, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  const shift = (delta: number) =>
    setView(({ year, month }) => {
      const m = month + delta;
      return m < 1 ? { year: year - 1, month: 12 } : m > 12 ? { year: year + 1, month: 1 } : { year, month: m };
    });

  const prevDisabled = minDate ? compareDateOnly(toDateOnly(view.year, view.month, 1), minDate) <= 0 : false;
  const nextDisabled = maxDate ? compareDateOnly(toDateOnly(view.year, view.month, daysInMonth(view.year, view.month)), maxDate) >= 0 : false;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text variant="headline" accessibilityRole="header" accessibilityLiveRegion="polite">
          {monthLabel(view.year, view.month)}
        </Text>
        <View style={styles.nav}>
          <NavButton label="Previous month" icon={ChevronLeft} disabled={prevDisabled} onPress={() => shift(-1)} />
          <NavButton label="Next month" icon={ChevronRight} disabled={nextDisabled} onPress={() => shift(1)} />
        </View>
      </View>
      <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {weekdayInitials.map((w, i) => (
          <Text key={i} variant="caption" tone="muted" align="center" style={styles.cell}>{w}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((date, i) => {
          if (!date) return <View key={`e${i}`} style={styles.cell} />;
          const outOfBounds = (minDate && compareDateOnly(date, minDate) < 0) || (maxDate && compareDateOnly(date, maxDate) > 0);
          const reason = outOfBounds ? 'Outside the allowed dates' : (unavailableReason?.(date) ?? null);
          const selected = date === value || date === rangeStart || date === rangeEnd;
          const inRange = rangeStart && rangeEnd && compareDateOnly(date, rangeStart) > 0 && compareDateOnly(date, rangeEnd) < 0;
          const isToday = date === today;
          return (
            <Pressable
              key={date}
              onPress={() => onChange(date)}
              disabled={Boolean(reason)}
              accessibilityRole="button"
              accessibilityLabel={`${formatDateOnly(date)}${isToday ? ', today' : ''}${reason ? `, unavailable: ${reason}` : ''}`}
              accessibilityState={{ selected, disabled: Boolean(reason) }}
              style={[styles.cell, inRange && styles.inRange]}
            >
              <View style={[styles.day, selected && styles.daySelected, isToday && !selected && styles.dayToday]}>
                <Text
                  variant="callout"
                  maxFontSizeMultiplier={maxFontScale.dense}
                  style={{
                    color: selected ? colors.textOnGold : reason ? colors.textFaint : colors.text,
                    fontWeight: selected || isToday ? '600' : '400',
                    textDecorationLine: reason && !outOfBounds ? 'line-through' : 'none',
                  }}
                >
                  {parseDateOnly(date).day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function NavButton({ label, icon, disabled, onPress }: { label: string; icon: typeof ChevronLeft; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.navBtn, pressed && { backgroundColor: colors.surfaceSunken }]}
    >
      <Icon as={icon} color={disabled ? colors.textFaint : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nav: { flexDirection: 'row', gap: spacing.xs },
  navBtn: { width: touchTarget - 4, height: touchTarget - 4, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 46, alignItems: 'center', justifyContent: 'center' },
  inRange: { backgroundColor: colors.primarySoft },
  day: { width: 40, height: 40, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  daySelected: { backgroundColor: colors.primary },
  dayToday: { borderWidth: 1.5, borderColor: colors.link },
});
