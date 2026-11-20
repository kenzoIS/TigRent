import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT, TAB_BAR_MARGIN } from '@/components/design-system/Screen';
import { Text } from '@/components/design-system/Text';
import { colors, elevation, gutter, maxFontScale, radii } from '@/theme';

/**
 * Floating glass tab bar (plan §5.2: glass used selectively). A high-opacity tint keeps
 * label contrast reliable on top of the blur; Android uses the tint without blur.
 */
export function TabBar({ state, descriptors, navigateToTab, insets }: BottomTabBarProps) {
  const safe = useSafeAreaInsets();
  const bottom = Math.max(insets?.bottom ?? safe.bottom, TAB_BAR_MARGIN);
  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom }]}>
      <View style={[styles.bar, elevation.mid]} accessibilityRole="tablist">
        {Platform.OS === 'ios' ? <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, styles.tint]} />
        {state.routes.map((route, i) => {
          const descriptor = descriptors[route.key];
          if (!descriptor) return null;
          const { options } = descriptor;
          const focused = state.index === i;
          const label = options.title ?? route.name;
          const color = focused ? colors.text : colors.textMuted;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              accessibilityState={{ selected: focused }}
              testID={options.tabBarButtonTestID}
              onPress={() => {
                if (!focused) navigateToTab(route.key);
              }}
              style={styles.item}
            >
              <View style={[styles.iconPill, focused && styles.iconPillActive]}>
                {options.tabBarIcon?.({ focused, color, size: 22 })}
              </View>
              <Text
                variant="caption"
                maxFontSizeMultiplier={maxFontScale.dense}
                numberOfLines={1}
                style={{ color, fontWeight: focused ? '600' : '500' }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: gutter, right: gutter },
  bar: {
    height: TAB_BAR_HEIGHT,
    borderRadius: radii.xl,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(23,21,15,0.08)',
  },
  tint: { backgroundColor: Platform.OS === 'ios' ? 'rgba(255,253,248,0.82)' : 'rgba(255,253,248,0.97)' },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  iconPill: { width: 44, height: 28, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  iconPillActive: { backgroundColor: colors.primarySoft },
});
