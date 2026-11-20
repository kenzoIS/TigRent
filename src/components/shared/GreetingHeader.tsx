import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Sparkles, X } from 'lucide-react-native';
import { Icon } from '@/components/design-system/Icon';
import { Text } from '@/components/design-system/Text';
import { Tiggy } from '@/components/mascot/Tiggy';
import { appConfig } from '@/config/app';
import { useSession } from '@/features/auth/session';
import { useMotion } from '@/lib/motion';
import { colors, elevation, radii, spacing } from '@/theme';

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** State-driven tip (features/mascot/dialogue). Null when there is nothing truthful to say. */
  tip: string | null;
  /** Small control on the eyebrow line, e.g. the notification bell. */
  right?: ReactNode;
};

const CAMPUS_TIPS = [
  'Need gear for finals? Book up to 90 days in advance!',
  'Take clear photos during handover to protect your security deposit.',
  'Return items before 11:59 PM Manila time to keep your clean return record.',
  'Trusted Lenders have completed 5+ rentals with a 4.5★ average rating.',
  'Need more time with an item? Request an extension from the rental screen!',
  'Your student ID and verification docs are strictly private.',
];

/**
 * Modern UST Campus Greeting Header.
 * Features a rich personalized student top bar, Tiggy mascot with raised waving hand,
 * and a perfectly bounded speech dialogue cloud that never clips on top.
 */
export function GreetingHeader({ eyebrow, title, subtitle, tip, right }: Props) {
  const { context } = useSession();
  const focused = useIsFocused();
  const { reduceMotion } = useMotion();
  const [open, setOpen] = useState(false);
  const [activeTip, setActiveTip] = useState(tip || CAMPUS_TIPS[0]);
  const tipIdx = useRef(0);
  const name = appConfig.mascot.name;

  const fullName = context?.fullName || title.replace(/^Hi,\s*/, '');
  const initials = fullName
    ? fullName
        .split(' ')
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'UST';

  // Sync situational tip if one arrives
  useEffect(() => {
    if (tip) setActiveTip(tip);
  }, [tip]);

  // Automated popout every 30 seconds
  useEffect(() => {
    if (!focused) {
      setOpen(false);
      return;
    }

    // Initial pop-out after 1.8 seconds on screen enter
    const initialTimer = setTimeout(() => {
      setOpen(true);
      const autoClose = setTimeout(() => setOpen(false), 8500);
      return () => clearTimeout(autoClose);
    }, 1800);

    // Recurring pop-out every 30 seconds
    const interval = setInterval(() => {
      if (tip) {
        setActiveTip(tip);
      } else {
        tipIdx.current = (tipIdx.current + 1) % CAMPUS_TIPS.length;
        setActiveTip(CAMPUS_TIPS[tipIdx.current]);
      }
      setOpen(true);

      setTimeout(() => {
        setOpen(false);
      }, 8500);
    }, 30000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [focused, tip]);

  return (
    <View style={styles.root}>
      {/* ── Top Bar: Personalized Student Identity & Notifications (Rich & Balanced) ── */}
      <View style={styles.topBar}>
        <View style={styles.studentInfoRow}>
          <View style={styles.avatarPill}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.studentDetails}>
            <Text style={styles.studentGreeting} numberOfLines={1}>
              {title} 👋
            </Text>
            <Text style={styles.studentCampusTag} numberOfLines={1}>
              UST Manila · {eyebrow === 'Borrowing' ? 'Campus Borrower' : 'Equipment Lender'}
            </Text>
          </View>
        </View>
        <View style={styles.notificationSlot}>{right}</View>
      </View>

      {/* ── Mascot & Interactive Dialogue Row ── */}
      <View style={styles.heroRow}>
        {/* Left Column: Dialogue Cloud (when open) OR Campus Prompt Card (when closed) */}
        <View style={styles.dialogueColumn}>
          {open ? (
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(200)}
              exiting={reduceMotion ? undefined : FadeOut.duration(150)}
              style={[styles.dialogueCard, elevation.low]}
              accessibilityLiveRegion="polite"
              testID="tiggy-bubble"
            >
              <View style={styles.dialogueHeader}>
                <View style={styles.bubbleTag}>
                  <Icon as={Sparkles} size={11} color={colors.ink} />
                  <Text style={styles.bubbleTagText}>{name}'s tip</Text>
                </View>
                <Pressable
                  onPress={() => setOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={`Dismiss ${name}'s tip`}
                  hitSlop={8}
                  style={styles.closeBtn}
                >
                  <Icon as={X} size={14} color={colors.textMuted} />
                </Pressable>
              </View>
              <Text style={styles.dialogueText}>
                {activeTip}
              </Text>
              {/* Comic speech tail on right edge pointing directly to Tiggy's raised waving hand */}
              <View style={styles.tailRight} />
            </Animated.View>
          ) : (
            <Pressable
              onPress={() => setOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Ask ${name} for a tip`}
              style={({ pressed }) => [styles.promptCard, pressed && styles.promptCardPressed]}
            >
              <View style={styles.promptHeader}>
                <View style={styles.promptBadge}>
                  <Icon as={Sparkles} size={11} color={colors.ink} />
                  <Text style={styles.promptBadgeText}>
                    {eyebrow === 'Borrowing' ? 'Campus Gear' : 'Lender Hub'}
                  </Text>
                </View>
                <Text style={styles.promptHint}>Tap for tip 💬</Text>
              </View>
              <Text style={styles.promptTitle} numberOfLines={1}>
                {eyebrow === 'Borrowing' ? 'Need gear for your classes?' : 'Ready to lend on campus?'}
              </Text>
              <Text style={styles.promptSubtitle} numberOfLines={2}>
                {eyebrow === 'Borrowing'
                  ? 'Calculators, cameras & lab tools from students'
                  : 'Earn allowance safely with verified rentals'}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Right Column: Tiggy Mascot */}
        <Pressable
          onPress={() => setOpen((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={`${name}, the TigRent mascot. Tap for a tip.`}
          style={styles.tiggyAnchor}
        >
          <Tiggy size="header" wave={focused} testID="tiggy" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 2,
    minHeight: 42,
  },
  studentInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  avatarPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
  },
  studentDetails: {
    flex: 1,
    gap: 1,
  },
  studentGreeting: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  studentCampusTag: {
    fontSize: 11.5,
    fontWeight: '500',
    color: colors.textMuted,
  },
  notificationSlot: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 124,
    gap: spacing.xs,
  },
  dialogueColumn: {
    flex: 1,
    marginRight: 6,
    justifyContent: 'center',
  },
  dialogueCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.sm + 2,
    borderWidth: 1.5,
    borderColor: colors.primary,
    gap: 4,
    position: 'relative',
  },
  tailRight: {
    position: 'absolute',
    right: -6,
    top: 24,
    width: 12,
    height: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
  dialogueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bubbleTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  bubbleTagText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.ink,
  },
  closeBtn: {
    padding: 3,
  },
  dialogueText: {
    color: colors.text,
    lineHeight: 16,
    fontWeight: '500',
    fontSize: 12,
  },
  promptCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 3,
  },
  promptCardPressed: {
    opacity: 0.92,
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  promptBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  promptBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.ink,
  },
  promptHint: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.link,
  },
  promptTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  promptSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
  },
  tiggyAnchor: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
