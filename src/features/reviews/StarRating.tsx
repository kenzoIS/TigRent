import { Pressable, StyleSheet, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { Text } from '@/components/design-system';
import { RATING_LABEL } from '@/domain/trust';
import { colors, iconStroke, spacing } from '@/theme';

/** 1–5 stars. Interactive when `onChange` is given (each star is a labelled button). */
export function StarRating({ value, onChange, size = 28, testID }: { value: number | null; onChange?: (v: number) => void; size?: number; testID?: string }) {
  return (
    <View style={styles.row} accessibilityRole={onChange ? undefined : 'image'} accessibilityLabel={onChange ? undefined : `${value ?? 0} out of 5 stars`} testID={testID}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = (value ?? 0) >= n;
        const star = <Star size={size} strokeWidth={iconStroke} color={filled ? colors.primary : colors.borderStrong} fill={filled ? colors.primary : 'transparent'} />;
        return onChange ? (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n === 1 ? '' : 's'}: ${RATING_LABEL[n]}`}
            accessibilityState={{ selected: value === n }}
            hitSlop={6}
            testID={testID ? `${testID}-${n}` : undefined}
            style={styles.hit}
          >
            {star}
          </Pressable>
        ) : (
          <View key={n}>{star}</View>
        );
      })}
      {onChange && value ? <Text variant="footnote" tone="muted">{RATING_LABEL[value]}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  hit: { padding: 4 },
});
