import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react-native';
import { formatDateOnly, type DateOnly } from '@/lib/dates';
import { Calendar, type CalendarProps } from './Calendar';
import { FieldTrigger } from './FieldTrigger';
import { Sheet } from './Sheet';

type Props = Omit<CalendarProps, 'onChange' | 'value'> & {
  label: string;
  value: DateOnly | null;
  onChange: (value: DateOnly) => void;
  placeholder?: string;
  error?: string | null;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
  testID?: string;
};

export function DateField({ label, value, onChange, placeholder = 'Select a date', error, helper, required, disabled, testID, ...calendar }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FieldTrigger
        testID={testID}
        label={label}
        valueText={value ? formatDateOnly(value) : undefined}
        placeholder={placeholder}
        icon={CalendarIcon}
        onPress={() => setOpen(true)}
        error={error}
        helper={helper}
        required={required}
        disabled={disabled}
      />
      <Sheet visible={open} onClose={() => setOpen(false)} title={label} description={helper}>
        <Calendar
          {...calendar}
          value={value}
          onChange={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}
