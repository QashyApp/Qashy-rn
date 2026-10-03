import { finishPayload, stepIsValid, validateDraft, type OnboardingDraft } from '@/features/onboarding/use-onboarding-flow';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const draft = (patch: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
  locale: 'en-US',
  currency: 'USD',
  accountName: 'Everyday',
  accountType: 'checking',
  openingBalance: '',
  themeId: 'classic',
  themeMode: 'system',
  accentSource: 'system',
  accentHex: '#5966E9',
  ...patch,
});

describe('onboarding flow rules', () => {
  it('lets the welcome and currency steps through with a valid currency', () => {
    expect(stepIsValid('welcome', draft({ currency: 'nope' }))).toBe(true);
    expect(stepIsValid('currency', draft())).toBe(true);
    expect(stepIsValid('currency', draft({ currency: 'XXX1' }))).toBe(false);
  });

  it('treats an empty opening balance as zero, not as an error', () => {
    expect(validateDraft(draft()).openingBalance).toBeUndefined();
    expect(finishPayload(draft()).openingBalanceMinor).toBe(0);
  });

  it('parses the opening balance in the chosen locale and currency', () => {
    expect(finishPayload(draft({ openingBalance: '1,234.50' })).openingBalanceMinor).toBe(123_450);
    expect(finishPayload(draft({ currency: 'JPY', openingBalance: '1200' })).openingBalanceMinor).toBe(1_200);
  });

  it('blocks the account step on a bad balance or a blank name', () => {
    expect(stepIsValid('account', draft({ openingBalance: 'abc' }))).toBe(false);
    expect(stepIsValid('account', draft({ accountName: '   ' }))).toBe(false);
    expect(() => finishPayload(draft({ accountName: '' }))).toThrow();
  });

  it('carries the chosen theme into the finish payload', () => {
    expect(finishPayload(draft()).themeId).toBe('classic');
    expect(finishPayload(draft({ themeId: 'high-contrast' })).themeId).toBe('high-contrast');
  });

  it('normalizes the finish payload', () => {
    expect(finishPayload(draft({ currency: 'ils', accountName: '  Joint  ' }))).toMatchObject({
      baseCurrency: 'ILS',
      accountName: 'Joint',
    });
  });
});
