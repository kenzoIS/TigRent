import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, elevation, maxFontScale, motion, radii, spacing } from '@/theme';
import { useMotion } from '@/lib/motion';
import { Icon, type IconComponent } from './Icon';
import { Text } from './Text';

export type Segment<T extends string> = { value: T; label: string; icon?: IconComponent };

type Props<T extends string> = {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  testID?: string;
};

/** iOS-style segmented control; used as the borrower/lender role switcher. */
export function SegmentedControl<T extends string>({ segments, value, onChange, accessibilityLabel, testID }: Props<T>) {
  const { reduceMotion } = useMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, segments.findIndex((s) => s.value === value));
  const segWidth = width > 0 ? (width - 4) / segments.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    x.value = reduceMotion ? index * segWidth : withTiming(index * segWidth, { duration: motion.base });
  }, [index, segWidth, reduceMotion, x]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={styles.track}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      {segWidth > 0 ? <Animated.View style={[styles.thumb, elevation.low, { width: segWidth }, thumb]} /> : null}
      {segments.map((s) => {
        const selected = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="tab"
            accessibilityLabel={s.label}
            accessibilityState={{ selected }}
            onPress={() => !selected && onChange(s.value)}
            style={styles.segment}
          >
            {s.icon ? <Icon as={s.icon} size="sm" color={selected ? colors.text : colors.textMuted} /> : null}
            <Text
              variant="subhead"
              maxFontSizeMultiplier={maxFontScale.control}
              numberOfLines={1}
              style={{ color: selected ? colors.text : colors.textMuted, fontWeight: selected ? '600' : '500' }}
            >
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: colors.surfaceSunken, borderRadius: radii.md, padding: 2, minHeight: 40 },
  thumb: { position: 'absolute', top: 2, bottom: 2, left: 2, borderRadius: radii.md - 2, backgroundColor: colors.surface },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, minHeight: 40, paddingHorizontal: spacing.sm },
});
