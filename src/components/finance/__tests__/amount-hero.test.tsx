import { render, screen } from '@testing-library/react-native';

import { AmountHero } from '@/components/finance/amount-hero';

// A minimal stand-in theme: only the tokens `materialStyle`/`AppText` actually
// read for the materials this hero uses (`sunken`, `control`).
jest.mock('@/theme/theme', () => ({
  useQashyTheme: () => ({
    text: '#111111',
    textMuted: '#666666',
    negative: '#cc0000',
    accent: '#4040ff',
    surface: '#ffffff',
    surfaceSunken: '#f2f2f2',
    surfaceElevated: '#ffffff',
    surfaceMuted: '#eeeeee',
    shadowSunken: 'none',
    shadowControl: 'none',
    shadowControlPressed: 'none',
    shadowCard: 'none',
    shadowRaised: 'none',
    surfaceGradient: undefined,
  }),
}));

jest.mock('@/localization/localization', () => ({
  useLocalization: () => ({ t: (message: string) => message, isRtl: false, language: 'en', locale: 'en-US' }),
}));

describe('AmountHero', () => {
  it('matches the transaction form\'s accessible name: "Amount (currency), required"', async () => {
    await render(
      <AmountHero
        label="Amount"
        currency="USD"
        value=""
        onChangeText={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Amount (USD), required')).toBeTruthy();
  });

  it('matches onboarding\'s accessible name for the (optional) opening balance field', async () => {
    await render(
      <AmountHero
        label="Opening balance"
        size="money"
        required={false}
        currency="ILS"
        value=""
        onChangeText={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Opening balance (ILS)')).toBeTruthy();
    // Never "required" for this optional field.
    expect(screen.queryByLabelText('Opening balance (ILS), required')).toBeNull();
  });

  it('matches the Plan forms\' accessible name, which translates the label alone', async () => {
    await render(
      <AmountHero
        label="Target"
        size="display"
        currencyInTranslation={false}
        currency="EUR"
        value=""
        onChangeText={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Target (EUR), required')).toBeTruthy();
  });

  it('renders an alert role element containing the error text', async () => {
    await render(
      <AmountHero
        label="Amount"
        currency="USD"
        value=""
        onChangeText={jest.fn()}
        error="Enter an amount"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.props.children ?? screen.getByText('Enter an amount')).toBeTruthy();
    expect(screen.getByText('Enter an amount')).toBeTruthy();
  });

  it('shows the hint beneath the well when no error is present', async () => {
    await render(
      <AmountHero
        label="Opening balance"
        size="money"
        required={false}
        hint="Leave empty to start from zero."
        currency="ILS"
        value=""
        onChangeText={jest.fn()}
      />,
    );

    expect(screen.getByText('Leave empty to start from zero.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('swaps the hint for the error, with an alert role, when an error is present', async () => {
    await render(
      <AmountHero
        label="Opening balance"
        size="money"
        required={false}
        hint="Leave empty to start from zero."
        currency="ILS"
        value=""
        onChangeText={jest.fn()}
        error="Invalid amount"
      />,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Invalid amount')).toBeTruthy();
    expect(screen.queryByText('Leave empty to start from zero.')).toBeNull();
  });
});
