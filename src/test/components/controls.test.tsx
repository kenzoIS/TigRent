import { useState } from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { Store, User } from 'lucide-react-native';
import { Button, Chip, PasswordField, SegmentedControl, SelectField, TextField } from '@/components/design-system';
import { renderWithProviders } from '../render';

describe('Button', () => {
  it('fires onPress when enabled', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(<Button label="Send request" onPress={onPress} />);
    await user.press(screen.getByRole('button', { name: 'Send request' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is disabled with a visible explanation and never fires', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(<Button label="Publish" onPress={onPress} disabled disabledReason="Verify your student account first." />);
    const btn = screen.getByRole('button', { name: 'Publish' });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Verify your student account first.')).toBeOnTheScreen();
    await user.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows busy state while loading and blocks repeat presses', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(<Button label="Pay" onPress={onPress} loading />);
    const btn = screen.getByRole('button', { name: 'Pay' });
    expect(btn).toBeBusy();
    await user.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('exposes its label and shows a field-level error', async () => {
    await renderWithProviders(<TextField label="UST email" value="x" onChangeText={() => undefined} error="Enter a valid email address." />);
    expect(screen.getByLabelText('UST email')).toBeOnTheScreen();
    expect(screen.getByText('Enter a valid email address.')).toBeOnTheScreen();
  });

  it('accepts typing', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = useState('');
      return <TextField label="Student ID" value={v} onChangeText={setV} />;
    }
    await renderWithProviders(<Harness />);
    await user.type(screen.getByLabelText('Student ID'), '2026-001');
    expect(screen.getByLabelText('Student ID')).toHaveDisplayValue('2026-001');
  });

  it('is not editable when disabled', async () => {
    await renderWithProviders(<TextField label="Locked" value="v" disabled />);
    expect(screen.getByLabelText('Locked')).toHaveProp('editable', false);
  });
});

describe('PasswordField', () => {
  it('toggles visibility', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<PasswordField label="Password" value="secret" onChangeText={() => undefined} />);
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    await user.press(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', false);
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeOnTheScreen();
  });
});

describe('SegmentedControl (role switcher)', () => {
  it('selects a segment and reports the change', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = useState<'borrower' | 'lender'>('borrower');
      return (
        <SegmentedControl
          accessibilityLabel="Active role"
          value={v}
          onChange={setV}
          segments={[
            { value: 'borrower', label: 'Borrower', icon: User },
            { value: 'lender', label: 'Lender', icon: Store },
          ]}
        />
      );
    }
    await renderWithProviders(<Harness />);
    expect(screen.getByRole('tab', { name: 'Borrower' })).toBeSelected();
    await user.press(screen.getByRole('tab', { name: 'Lender' }));
    expect(screen.getByRole('tab', { name: 'Lender' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Borrower' })).not.toBeSelected();
  });
});

describe('Chip', () => {
  it('reflects selection state', async () => {
    await renderWithProviders(<Chip label="Cameras" selected onPress={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Cameras' })).toBeSelected();
  });
});

describe('SelectField', () => {
  it('opens a sheet and selects an option', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = useState<'good' | 'fair' | null>(null);
      return <SelectField label="Condition" value={v} onChange={setV} options={[{ value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }]} />;
    }
    await renderWithProviders(<Harness />, { reducedMotion: true });
    await user.press(screen.getByRole('button', { name: 'Condition: not set' }));
    await user.press(await screen.findByRole('button', { name: 'Fair' }));
    expect(await screen.findByRole('button', { name: 'Condition: Fair' })).toBeOnTheScreen();
  });
});
