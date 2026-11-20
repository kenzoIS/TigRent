/**
 * Money is integer centavos everywhere (plan §2.3, §10.1). Formatting only: pricing math lives in
 * the domain/server and is never computed in screens.
 */
export type Centavos = number;

export function assertCentavos(value: number): Centavos {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Money must be an integer number of centavos, got ${value}`);
  return value;
}

/** ₱1,234.50 — integer arithmetic only, no floating-point rounding. */
export function formatPeso(centavos: Centavos, opts: { showCentavos?: 'auto' | 'always' } = {}): string {
  assertCentavos(centavos);
  const negative = centavos < 0;
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const showCents = opts.showCentavos === 'always' || cents !== 0;
  return `${negative ? '−' : ''}₱${grouped}${showCents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

/** Parses user input like "1,250.5" into centavos. Returns null when invalid. */
export function parsePesoInput(input: string): Centavos | null {
  const clean = input.replace(/[₱,\s]/g, '');
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
