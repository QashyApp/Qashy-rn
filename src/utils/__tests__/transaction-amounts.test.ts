import {
  feeMinorFor,
  normalizeFeePercent,
  principalOf,
  totalWithFee,
} from '@/utils/transaction-amounts';

describe('normalizeFeePercent', () => {
  it('accepts a percentage strictly between 0 and 100 inclusive of 100', () => {
    expect(normalizeFeePercent('2.5')).toBe('2.5');
    expect(normalizeFeePercent('100')).toBe('100');
  });

  it('rejects zero, negative, and greater-than-100 values', () => {
    expect(() => normalizeFeePercent('0')).toThrow('Fee percentage must be greater than 0 and at most 100.');
    expect(() => normalizeFeePercent('-1')).toThrow('Fee percentage must be greater than 0 and at most 100.');
    expect(() => normalizeFeePercent('100.01')).toThrow('Fee percentage must be greater than 0 and at most 100.');
  });

  it('rejects garbage input', () => {
    expect(() => normalizeFeePercent('abc')).toThrow('Fee percentage must be greater than 0 and at most 100.');
  });
});

describe('feeMinorFor', () => {
  it('returns the entered amount for a fixed fee', () => {
    expect(feeMinorFor(10_000, { kind: 'fixed', amountMinor: 250 })).toBe(250);
  });

  it('rejects a non-positive fixed fee', () => {
    expect(() => feeMinorFor(10_000, { kind: 'fixed', amountMinor: 0 })).toThrow();
    expect(() => feeMinorFor(10_000, { kind: 'fixed', amountMinor: -5 })).toThrow();
  });

  it('computes a percent fee and rounds half up', () => {
    // 2.5% of 10001 = 250.025 -> rounds to 250.
    expect(feeMinorFor(10_001, { kind: 'percent', percent: '2.5' })).toBe(250);
    // 2.5% of 10003 = 250.075 -> rounds to 250.
    expect(feeMinorFor(10_003, { kind: 'percent', percent: '2.5' })).toBe(250);
    // A case that lands exactly on .5 rounds up, not to even.
    expect(feeMinorFor(50, { kind: 'percent', percent: '1' })).toBe(1); // 0.5 -> 1
    expect(feeMinorFor(150, { kind: 'percent', percent: '1' })).toBe(2); // 1.5 -> 2
  });

  it('rejects a non-positive principal for a percent fee', () => {
    expect(() => feeMinorFor(0, { kind: 'percent', percent: '2.5' })).toThrow();
    expect(() => feeMinorFor(-100, { kind: 'percent', percent: '2.5' })).toThrow();
  });
});

describe('totalWithFee', () => {
  it('adds the fee for an expense', () => {
    expect(totalWithFee('expense', 10_000, 250)).toBe(10_250);
  });

  it('subtracts the fee for income', () => {
    expect(totalWithFee('income', 10_000, 250)).toBe(9_750);
  });

  it('throws when a fee would consume the entire income amount or more', () => {
    expect(() => totalWithFee('income', 10_000, 10_000)).toThrow('Fees can’t exceed the income amount.');
    expect(() => totalWithFee('income', 10_000, 10_500)).toThrow('Fees can’t exceed the income amount.');
  });

  it('allows a fee just under the full income amount', () => {
    expect(totalWithFee('income', 10_000, 9_999)).toBe(1);
  });
});

describe('principalOf', () => {
  it('returns amountMinor unchanged when there is no fee', () => {
    expect(principalOf({ kind: 'expense', amountMinor: 10_000, fee: null })).toBe(10_000);
    expect(principalOf({ kind: 'income', amountMinor: 10_000 })).toBe(10_000);
  });

  it('reverses an expense fee by subtracting it back out', () => {
    expect(principalOf({
      kind: 'expense',
      amountMinor: 10_250,
      fee: { kind: 'fixed', percent: null, amountMinor: 250 },
    })).toBe(10_000);
  });

  it('reverses an income fee by adding it back in', () => {
    expect(principalOf({
      kind: 'income',
      amountMinor: 9_750,
      fee: { kind: 'fixed', percent: null, amountMinor: 250 },
    })).toBe(10_000);
  });

  it('round-trips through feeMinorFor and totalWithFee', () => {
    const principal = 12_345;
    const feeMinor = feeMinorFor(principal, { kind: 'percent', percent: '3' });
    const total = totalWithFee('expense', principal, feeMinor);
    expect(principalOf({
      kind: 'expense',
      amountMinor: total,
      fee: { kind: 'percent', percent: '3', amountMinor: feeMinor },
    })).toBe(principal);
  });
});
