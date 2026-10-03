import { classicTheme } from '@/theme/themes/classic';
import type { ThemeDefinition } from '@/theme/themes/types';

/**
 * Classic's shapes and surfaces with the Android wallpaper-derived accent. The platform
 * colours are applied by `QashyThemeProvider` (accent.mode 'system'); it is offered on Android only.
 */
export const materialYouTheme: ThemeDefinition = {
  ...classicTheme,
  id: 'material-you',
  name: 'Material You',
  accent: { ...classicTheme.accent, mode: 'system' },
  availableOn: ['android'],
};
