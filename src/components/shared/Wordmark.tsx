import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/design-system/Text';
import { appConfig } from '@/config/app';
import { colors, palette } from '@/theme';

/** Text-only TigRent wordmark (plan Phase 1: no invented logo). */
export function Wordmark({ size = 'md', onInk = false }: { size?: 'md' | 'lg'; onInk?: boolean }) {
  const fontSize = size === 'lg' ? 40 : 26;
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={appConfig.productName}>
      <Text style={[styles.word, { fontSize, lineHeight: fontSize * 1.12, color: onInk ? colors.textOnInk : colors.text }]}>Tig</Text>
      <Text style={[styles.word, { fontSize, lineHeight: fontSize * 1.12, color: onInk ? palette.gold : palette.goldDeep }]}>Rent</Text>
      <View style={[styles.dot, { width: fontSize * 0.2, height: fontSize * 0.2, marginBottom: fontSize * 0.16 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  word: { fontWeight: '800', letterSpacing: -1.2 },
  dot: { borderRadius: 99, backgroundColor: palette.tigerAmber, marginLeft: 2 },
});
