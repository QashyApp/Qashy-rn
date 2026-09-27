import { formatMoney, formatMoneyParts, type MoneyParts } from '@/utils/money';
import type { CurrencyCode } from '@/domain/models';

/**
 * Reconstructs `formatMoney`'s output from `formatMoneyParts`'s fields. This is
 * the one true "display order" the parts are defined to reassemble into — see
 * the doc comment on `formatMoneyParts`.
 */
function reconstruct(parts: MoneyParts) {
  return (
    parts.literalBefore
    + parts.sign
    + (parts.currencyPosition === 'before' ? parts.currency : '')
    + parts.integer
    + parts.fraction
    + parts.literalAfter
    + (parts.currencyPosition === 'after' ? parts.currency : '')
  );
}

function expectRoundTrip(
  minor: number,
  currency: CurrencyCode,
  locale: string,
  options?: { compact?: boolean; sign?: boolean },
) {
  const parts = formatMoneyParts(minor, currency, locale, options);
  expect(reconstruct(parts)).toBe(formatMoney(minor, currency, locale, options));
  return parts;
}

describe('formatMoneyParts', () => {
  it('splits en-US USD into parts that reassemble formatMoney exactly', () => {
    const parts = expectRoundTrip(1234, 'USD', 'en-US');
    expect(parts).toMatchObject({ sign: '', currency: '$', integer: '12', fraction: '.34', currencyPosition: 'before' });
  });

  it('splits he-IL ILS (RTL) into parts that reassemble formatMoney exactly', () => {
    const parts = expectRoundTrip(1234, 'ILS', 'he-IL');
    expect(parts.currency).toBe('₪');
    expect(parts.currencyPosition).toBe('after');
    expect(parts.integer).toBe('12');
    expect(parts.fraction).toBe('.34');
  });

  it('splits de-DE EUR (currency after, comma decimal) into parts that reassemble formatMoney exactly', () => {
    const parts = expectRoundTrip(123456, 'EUR', 'de-DE');
    expect(parts.currency).toBe('€');
    expect(parts.currencyPosition).toBe('after');
    expect(parts.integer).toBe('1.234');
    expect(parts.fraction).toBe(',56');
  });

  it('splits ja-JP JPY (zero fraction digits) into parts that reassemble formatMoney exactly', () => {
    const parts = expectRoundTrip(1200, 'JPY', 'ja-JP');
    expect(parts.fraction).toBe('');
    expect(parts.currencyPosition).toBe('before');
  });

  it('splits a negative amount, putting the minus sign in its own field', () => {
    const parts = expectRoundTrip(-1234, 'USD', 'en-US');
    expect(parts.sign).toBe('-');
    expect(parts.integer).toBe('12');
  });

  it('splits a signed positive amount with sign: true', () => {
    const parts = expectRoundTrip(1234, 'USD', 'en-US', { sign: true });
    expect(parts.sign).toBe('+');
  });

  it('splits compact notation, keeping the compact suffix out of integer/fraction', () => {
    const parts = expectRoundTrip(1234500, 'USD', 'en-US', { compact: true });
    expect(parts.integer).not.toMatch(/[a-zA-Z]/);
    expect(parts.fraction).not.toMatch(/[a-zA-Z]/);
    expect(parts.literalAfter).toMatch(/K/);
  });

  it('round-trips he-IL compact notation too', () => {
    expectRoundTrip(1234500, 'ILS', 'he-IL', { compact: true });
  });

  it('round-trips de-DE compact notation too', () => {
    expectRoundTrip(1234500, 'EUR', 'de-DE', { compact: true });
  });

  it('round-trips zero amounts', () => {
    expectRoundTrip(0, 'USD', 'en-US');
    expectRoundTrip(0, 'JPY', 'ja-JP');
  });
});
