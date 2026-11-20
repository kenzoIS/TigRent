import { useState } from 'react';
import { ChevronDown } from 'lucide-react-native';
import { FieldTrigger } from './FieldTrigger';
import { ListRow } from './ListRow';
import { Sheet } from './Sheet';

export type SelectOption<T extends string> = { value: T; label: string; description?: string; disabled?: boolean };

type Props<T extends string> = {
  label: string;
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string | null;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
  testID?: string;
};

export function SelectField<T extends string>({ label, value, options, onChange, placeholder = 'Choose…', ...rest }: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <>
      <FieldTrigger label={label} valueText={selected?.label} placeholder={placeholder} icon={ChevronDown} onPress={() => setOpen(true)} {...rest} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        {options.map((o) => (
          <ListRow
            key={o.value}
            title={o.label}
            subtitle={o.description}
            selected={o.value === value}
            disabled={o.disabled}
            onPress={() => {
              onChange(o.value);
              setOpen(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}
