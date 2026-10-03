import type { CustomThemeFile } from '@/theme/custom/schema';

/**
 * Worked examples for the user-facing custom theme guide. The guide embeds these verbatim and a
 * test checks it against them, so edit them here and update the guide, never the other way around.
 */

/** The smallest valid theme: both schemes are present; everything else is inherited from Classic. */
export const MINIMAL_EXAMPLE: CustomThemeFile = {
  themeSchemaVersion: 1,
  id: 'forest-minimal',
  name: 'Forest Minimal',
  palette: {
    light: { background: '#EEF3EC', surface: '#FFFFFF' },
    dark: { background: '#0D120E', surface: '#161D17' },
  },
};

/** A theme that uses every section: a bevel (pixel) look with Pixelify Sans, pixel icons and custom charts. */
export const FULL_EXAMPLE: CustomThemeFile = {
  themeSchemaVersion: 1,
  id: 'moss-block',
  name: 'Moss Block',
  extends: 'classic',
  palette: {
    light: {
      background: '#D5DDC4',
      surface: '#EAF0DC',
      surfaceElevated: '#F4F8EA',
      surfaceMuted: '#DCE5CB',
      surfaceSunken: '#CCD6B8',
      text: '#1F2A14',
      textMuted: '#475736',
      border: '#475736',
      positive: '#2F6B1E',
      negative: '#A52A22',
      warning: '#7F5200',
      transfer: '#2C5C9A',
    },
    dark: {
      background: '#10160B',
      surface: '#1B2412',
      surfaceElevated: '#242F18',
      surfaceMuted: '#2D3A1F',
      surfaceSunken: '#0B1007',
      text: '#E9F2D8',
      textMuted: '#B3C49A',
      border: '#6F8552',
      positive: '#8FD35A',
      negative: '#FF8F82',
      warning: '#F0C050',
      transfer: '#86B4F0',
    },
  },
  accent: {
    mode: 'user',
    default: '#4C9A2A',
    presets: ['#4C9A2A', '#2F6F8F', '#B5651D', '#A33B2E', '#6B4E9B'],
  },
  shape: {
    radius: { sm: 0, control: 0, tile: 0, card: 0, sheet: 0, nav: 0, pill: 0 },
    space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
    tile: { size: 40, icon: 20, compactSize: 32, compactIcon: 16 },
  },
  material: { engine: 'bevel', gradients: false, bevelDepth: 2 },
  motion: { press: 'translate', pressTranslate: 2, durationScale: 0.8 },
  type: {
    text: { family: 'pixelify-sans' },
    numeric: { family: 'pixelify-sans' },
  },
  icons: { set: 'pixel' },
  charts: {
    patterns: true,
    lineWidth: 3,
    donutThickness: 18,
    gridDash: '2 2',
    lineCap: 'butt',
    categoryPalette: ['#5E8C31', '#B5651D', '#3E7CB1', '#8E5BA8', '#C0392B', '#C9A227', '#2E8B7A', '#7A6A58'],
  },
};
