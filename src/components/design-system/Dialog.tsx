import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors, elevation, radii, spacing } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

type DialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Confirm button gets `${testID}-confirm`. */
  testID?: string;
};

/** Centered confirmation modal for consequential actions. */
export function Dialog({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', destructive, loading, onConfirm, onCancel, testID }: DialogProps) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={loading ? undefined : onCancel} accessibilityLabel="Dismiss dialog" />
        <View style={[styles.card, elevation.high]} accessibilityViewIsModal accessibilityRole="alert">
          <Text variant="title2">{title}</Text>
          <Text variant="callout" tone="muted">{message}</Text>
          <View style={styles.actions}>
            <Button label={confirmLabel} variant={destructive ? 'danger' : 'primary'} loading={loading} onPress={onConfirm} fullWidth testID={testID ? `${testID}-confirm` : undefined} />
            <Button label={cancelLabel} variant="ghost" onPress={onCancel} disabled={loading} fullWidth />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xxl, gap: spacing.md },
  actions: { gap: spacing.xs, marginTop: spacing.sm },
});
