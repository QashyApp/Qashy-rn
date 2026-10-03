import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppearanceScreen } from '@/features/more/appearance-screen';
import type { ThemeDefinition } from '@/theme/themes/types';

const mockUpdateSettings = jest.fn();

jest.mock('@/theme/theme', () => {
  const actual = jest.requireActual('@/theme/theme');
  return { ...actual, useQashyTheme: () => actual.accentTokens('#5966E9', false) };
});

jest.mock('@/theme/themes/registry', () => {
  const actual = jest.requireActual('@/theme/themes/registry');
  const classic = jest.requireActual('@/theme/themes/classic').classicTheme as ThemeDefinition;
  const fixed: ThemeDefinition = { ...classic, id: 'high-contrast', name: 'High contrast', accent: { ...classic.accent, mode: 'fixed' } };
  const themes = [classic, fixed];
  return {
    ...actual,
    listAvailableThemes: () => themes,
    getTheme: (id: string) => themes.find((theme: ThemeDefinition) => theme.id === id) ?? themes[0],
  };
});

jest.mock('@/localization/localization', () => ({
  useLocalization: () => ({ t: (message: string) => message, isRtl: false, language: 'en', locale: 'en-US' }),
}));

jest.mock('@/providers/finance-provider', () => ({
  useFinanceRepository: () => ({ updateSettings: mockUpdateSettings }),
  useFinanceState: () => ({
    settings: { revision: 1, locale: 'en-US', baseCurrency: 'USD', themeId: 'classic', themeMode: 'light', accentSource: 'preset', accentHex: '#5966E9' },
  }),
}));

describe('AppearanceScreen theme selection', () => {
  beforeEach(() => {
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockResolvedValue({ revision: 2 });
  });

  it('shows the accent controls for a theme that lets the user choose one', async () => {
    await render(<AppearanceScreen />);
    expect(screen.getByLabelText('Custom accent')).toBeTruthy();
    expect(screen.queryByText('This theme sets its own accent color.')).toBeNull();
  });

  it('saves the chosen theme id, and hides the accent controls for a fixed-accent theme', async () => {
    await render(<AppearanceScreen />);

    await fireEvent.press(screen.getByRole('radio', { name: /^High contrast/ }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ themeId: 'high-contrast' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /^High contrast/ }).props.accessibilityState).toMatchObject({ checked: true }));
    expect(screen.queryByLabelText('Custom accent')).toBeNull();
    expect(screen.getByText('This theme sets its own accent color.')).toBeTruthy();
    // The mode controls stay for every theme.
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeTruthy();
  });
});
