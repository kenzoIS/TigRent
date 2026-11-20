import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { X } from 'lucide-react-native';
import { Icon } from '@/components/design-system/Icon';
import { Text } from '@/components/design-system/Text';
import { appConfig } from '@/config/app';
import { useMotion } from '@/lib/motion';
import { colors, elevation, radii, spacing } from '@/theme';

/** Supplied artwork with only the flat white background made transparent (decision D9). */
const TIGGY = require('@assets/mascot/tiggy.png');
const ASPECT = 484 / 475;

const SIZES = { sm: 72, md: 120, header: 132, lg: 188 } as const;

export type TiggyProps = {
  size?: keyof typeof SIZES;
  /**
   * State-driven hint (plan §5.4). Must reflect real app state; omit when there is nothing
   * truthful to say. Shown on tap/press (and hover on web).
   */
  message?: string;
  /** Show the message immediately instead of waiting for a tap. */
  initiallyOpen?: boolean;
  onDismiss?: () => void;
  /**
   * Periodic greeting wave: the whole illustration gently rocks from his feet (the artwork itself
   * is never altered). Skipped under reduced motion; pass false when the screen isn't visible.
   */
  wave?: boolean;
  /** Parent renders the tip itself (e.g. beside a greeting) instead of the bubble above Tiggy. */
  external?: { open: boolean; onToggle: () => void };
  testID?: string;
};

export function Tiggy({ size = 'md', message, initiallyOpen = false, onDismiss, wave = false, external, testID = 'tiggy' }: TiggyProps) {
  const { reduceMotion } = useMotion();
  const [openState, setOpen] = useState(initiallyOpen);
  // A tip can only be open while there is a truthful message to show.
  const open = external ? external.open && Boolean(message) : openState && Boolean(message);
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const sway = useSharedValue(0);
  const h = SIZES[size];
  const w = h * ASPECT;

  useEffect(() => {
    if (!wave || reduceMotion) {
      cancelAnimation(sway);
      sway.value = withTiming(0, { duration: 150 });
      return;
    }
    const ease = { easing: Easing.inOut(Easing.quad) };
    // A short "hello" (rock left-right-left), then rest for ~3 s, forever. Transform-only, UI thread.
    sway.value = withRepeat(
      withSequence(
        withDelay(1200, withTiming(-7, { duration: 220, ...ease })),
        withTiming(6, { duration: 260, ...ease }),
        withTiming(-5, { duration: 240, ...ease }),
        withTiming(3, { duration: 220, ...ease }),
        withTiming(0, { duration: 200, ...ease }),
        withDelay(1800, withTiming(0, { duration: 1 })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(sway);
  }, [wave, reduceMotion, sway]);

  const react = () => {
    if (reduceMotion) return;
    scale.value = withSequence(withTiming(0.94, { duration: 90 }), withSpring(1, { damping: 7, stiffness: 220 }));
    rotate.value = withSequence(withTiming(-4, { duration: 110 }), withTiming(3, { duration: 140 }), withTiming(0, { duration: 120 }));
  };

  const body = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rotate.value + sway.value}deg` }],
  }));

  const toggle = () => {
    react();
    if (!message) return;
    if (external) external.onToggle();
    else setOpen((o) => !o);
  };

  const close = () => {
    setOpen(false);
    onDismiss?.();
  };

  const name = appConfig.mascot.name;
  const internalBubble = !external && Boolean(message);

  return (
    <View style={[styles.root, internalBubble ? { paddingTop: BUBBLE_SPACE } : null]} testID={testID}>
      {internalBubble && open ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(160)}
          exiting={reduceMotion ? undefined : FadeOut.duration(120)}
          style={[styles.bubble, elevation.mid]}
          accessibilityLiveRegion="polite"
          testID={`${testID}-bubble`}
        >
          <Text variant="subhead" style={styles.bubbleText}>{message}</Text>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={`Dismiss ${name}'s tip`} hitSlop={10} style={styles.bubbleClose}>
            <Icon as={X} size="sm" color={colors.textMuted} />
          </Pressable>
          <View style={styles.tail} />
        </Animated.View>
      ) : null}
      <Pressable
        onPress={toggle}
        onHoverIn={Platform.OS === 'web' ? () => { react(); if (message && !open) toggle(); } : undefined}
        accessibilityRole={message ? 'button' : 'image'}
        accessibilityLabel={message ? `${name}, the TigRent tiger. Tap for a tip.` : `${name}, the TigRent tiger`}
        accessibilityState={message ? { expanded: open } : undefined}
        style={{ width: w, height: h + 10 }}
      >
        <View style={[styles.halo, { width: w * 0.86, left: w * 0.07 }]}>
          <Svg width="100%" height="100%" viewBox="0 0 100 20" preserveAspectRatio="none">
            <Defs>
              <RadialGradient id="halo" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor="#5A4210" stopOpacity="0.22" />
                <Stop offset="0.6" stopColor="#5A4210" stopOpacity="0.08" />
                <Stop offset="1" stopColor="#5A4210" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Ellipse cx="50" cy="10" rx="50" ry="10" fill="url(#halo)" />
          </Svg>
        </View>
        {/* Pivot at the feet so the motion reads as a friendly rock/wave, not a spin. */}
        <Animated.View style={[{ width: w, height: h, transformOrigin: ['50%', '92%', 0] }, body]}>
          <Image source={TIGGY} style={{ width: w, height: h }} contentFit="contain" accessible={false} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const BUBBLE_SPACE = 76;

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  halo: { position: 'absolute', bottom: 0, height: 22 },
  bubble: {
    position: 'absolute',
    top: 0,
    maxWidth: 280,
    minHeight: BUBBLE_SPACE - 14,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm + 2,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.xxxl,
    justifyContent: 'center',
    zIndex: 2,
  },
  bubbleText: { color: colors.text },
  bubbleClose: { position: 'absolute', top: spacing.sm, right: spacing.sm, padding: 4 },
  tail: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    width: 14,
    height: 14,
    backgroundColor: colors.surface,
    transform: [{ rotate: '45deg' }],
  },
});
