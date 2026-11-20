import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { palette, motion } from '@/theme';
import { useMotion } from '@/lib/motion';

/**
 * Subtle ambient canvas: warm cream gradient with slow-drifting gold curves (plan §5.3).
 * Static when reduced motion / low-end mode is on. Never intercepts touches.
 */
export function AmbientBackground({ intensity = 1 }: { intensity?: number }) {
  const { ambientMotion } = useMotion();
  const drift = useSharedValue(0);

  useEffect(() => {
    if (!ambientMotion) {
      cancelAnimation(drift);
      drift.value = 0;
      return;
    }
    drift.value = withRepeat(withTiming(1, { duration: motion.ambientCycle, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(drift);
  }, [ambientMotion, drift]);

  const upper = useAnimatedStyle(() => ({ transform: [{ translateX: -24 + drift.value * 48 }, { translateY: drift.value * 14 }] }));
  const lower = useAnimatedStyle(() => ({ transform: [{ translateX: 20 - drift.value * 40 }, { translateY: -drift.value * 12 }] }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="ambient-background" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LinearGradient colors={[palette.cream, '#F8F1E1', palette.cream]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.layer, styles.top, upper]}>
        <Svg width="140%" height={260} viewBox="0 0 560 260" preserveAspectRatio="none">
          <Path d="M-20 170 C 110 40, 260 40, 360 120 S 540 210, 600 80" stroke={palette.gold} strokeOpacity={0.16 * intensity} strokeWidth={34} fill="none" strokeLinecap="round" />
          <Path d="M-20 215 C 120 110, 250 120, 370 175 S 520 230, 600 150" stroke={palette.tigerAmber} strokeOpacity={0.07 * intensity} strokeWidth={16} fill="none" strokeLinecap="round" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.layer, styles.bottom, lower]}>
        <Svg width="140%" height={240} viewBox="0 0 560 240" preserveAspectRatio="none">
          <Path d="M-30 90 C 90 190, 230 210, 330 140 S 500 40, 600 120" stroke={palette.gold} strokeOpacity={0.12 * intensity} strokeWidth={28} fill="none" strokeLinecap="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: '-20%' },
  top: { top: -40 },
  bottom: { bottom: -30 },
});
