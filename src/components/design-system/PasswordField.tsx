import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { colors, touchTarget } from '@/theme';
import { Icon } from './Icon';
import { TextField, type TextFieldProps } from './TextField';

export function PasswordField({ ref, ...props }: Omit<TextFieldProps, 'secureTextEntry' | 'trailing'>) {
    const [visible, setVisible] = useState(false);
    return (
      <TextField
        ref={ref}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        autoComplete="password"
        {...props}
        secureTextEntry={!visible}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            onPress={() => setVisible((v) => !v)}
            disabled={props.disabled}
            style={styles.toggle}
            hitSlop={4}
          >
            <Icon as={visible ? EyeOff : Eye} color={colors.textMuted} />
          </Pressable>
        }
      />
    );
}

const styles = StyleSheet.create({
  toggle: { width: touchTarget - 8, height: touchTarget - 8, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
});
