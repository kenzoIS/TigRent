import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientBackground } from '@/components/shared/AmbientBackground';
import { colors, gutter, spacing } from '@/theme';

/** Space reserved at the bottom of tab screens for the floating tab bar. */
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_MARGIN = spacing.md;

type ScreenProps = {
  children: ReactNode;
  /** Scrollable content (default) or fixed layout. */
  scroll?: boolean;
  background?: 'ambient' | 'plain' | 'surface';
  /** Inside a tab navigator: leave room for the floating tab bar. */
  withTabBar?: boolean;
  /** Sticky footer for the primary action; stays above the keyboard. */
  footer?: ReactNode;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pull-to-refresh for scrollable screens. */
  refreshing?: boolean;
  onRefresh?: () => void;
  testID?: string;
};

export function Screen({ children, scroll = true, background = 'plain', withTabBar, footer, padded = true, contentStyle, refreshing, onRefresh, testID }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const bottomSpace = withTabBar ? TAB_BAR_HEIGHT + TAB_BAR_MARGIN * 2 + insets.bottom : footer ? spacing.md : insets.bottom + spacing.xl;
  const bg = background === 'surface' ? colors.surface : colors.background;

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[padded && styles.padded, { paddingBottom: bottomSpace }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.link} colors={[colors.link]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.padded, { paddingBottom: bottomSpace }, contentStyle]}>{children}</View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: bg }]} testID={testID}>
      {background === 'ambient' ? <AmbientBackground /> : null}
      <View style={[styles.flex, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
          {footer ? (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>{footer}</View>
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { paddingHorizontal: gutter },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
