import Ionicons from '@expo/vector-icons/Ionicons';

import type { ParsedIconId } from '@/utils/icon-id';

/**
 * Icon sets decide how a stored icon id is DRAWN on this device. The id itself (`ion:<glyph>`,
 * `emoji:<char>`, legacy SF-style names) is replicated data and is never rewritten by a theme.
 * Every set is keyed by Ionicons glyph name, and any glyph a set does not cover falls back to
 * the default Ionicons rendering, so a theme can never produce an empty box.
 */
export type IoniconName = keyof typeof Ionicons.glyphMap;

export type SvgGlyphPath = { d: string; fillRule?: 'evenodd' | 'nonzero' };

export type IconGlyph =
  | { kind: 'ionicon'; name: IoniconName }
  | { kind: 'svg'; viewBox: string; paths: readonly SvgGlyphPath[] };

export interface IconSet {
  id: string;
  label: string;
  /** The set's drawing of an Ionicons glyph name, or null when the set does not cover it. */
  resolve(ionGlyph: string): IconGlyph | null;
}

export const DEFAULT_ICON_SET_ID = 'ionicons';
export const FALLBACK_GLYPH: IoniconName = 'help-circle-outline';

/** Legacy SF-Symbol-style ids and the Ionicons glyph android and web draw for each. */
export const IONICON_BY_SF_NAME: Record<string, IoniconName> = {
  plus: 'add',
  minus: 'remove',
  'plus.circle': 'add-circle-outline',
  'arrow.up': 'arrow-up',
  'arrow.down': 'arrow-down',
  'arrow.left.arrow.right': 'swap-horizontal',
  'chevron.right': 'chevron-forward',
  'chevron.left': 'chevron-back',
  'chevron.down': 'chevron-down',
  'list.bullet.rectangle': 'receipt-outline',
  // Filled counterparts, used for the selected navigation section. Selection
  // that reads only as a tint fails anyone who cannot separate the two hues,
  // and on the rail the accent container is subtle by design — the change of
  // weight is what actually says "you are here".
  'house.fill': 'home',
  'list.bullet.rectangle.fill': 'receipt',
  'chart.pie.fill': 'pie-chart',
  'ellipsis.circle.fill': 'ellipsis-horizontal-circle',
  magnifyingglass: 'search',
  calendar: 'calendar-outline',
  wallet: 'wallet-outline',
  'wallet.bifold': 'wallet',
  target: 'locate-outline',
  chart: 'pie-chart-outline',
  'chart.pie': 'pie-chart-outline',
  gear: 'settings-outline',
  checkmark: 'checkmark',
  xmark: 'close',
  // Outline, like every other unselected icon. The filled glyph was the only
  // solid shape in the navigation rail, so "More" looked permanently selected.
  'ellipsis.circle': 'ellipsis-horizontal-circle-outline',
  repeat: 'repeat',
  tray: 'download-outline',
  trash: 'trash-outline',
  paintbrush: 'color-palette-outline',
  cart: 'cart-outline',
  'fork.knife': 'restaurant-outline',
  car: 'car-outline',
  house: 'home-outline',
  heart: 'heart-outline',
  sparkles: 'sparkles-outline',
  banknote: 'cash-outline',
  bag: 'bag-outline',
  bus: 'bus-outline',
  airplane: 'airplane-outline',
  gift: 'gift-outline',
  graduationcap: 'school-outline',
  gamecontroller: 'game-controller-outline',
  pawprint: 'paw-outline',
  bolt: 'flash-outline',
  tshirt: 'shirt-outline',
  briefcase: 'briefcase-outline',
  // Sync. Every state a device, a relay, or a batch can be in needs a glyph here: the pills
  // and rows that report them are icon-plus-text by rule, so a missing entry does not degrade
  // to "no icon" on Android and web — it degrades to a question mark sitting next to the word
  // "Reachable", which reads as uncertainty about the very thing being reported.
  'arrow.triangle.2.circlepath': 'sync-outline',
  'arrow.clockwise': 'refresh-outline',
  'point.3.connected.trianglepath.dotted': 'git-network-outline',
  'antenna.radiowaves.left.and.right': 'radio-outline',
  'exclamationmark.triangle': 'warning-outline',
  'checkmark.circle': 'checkmark-circle-outline',
  'xmark.circle': 'close-circle-outline',
  'questionmark.circle': 'help-circle-outline',
  'pause.circle': 'pause-circle-outline',
  // Not a literal match — Ionicons has no struck-through wifi — but "offline" is the meaning,
  // and a cloud with a slash carries it more plainly than a bare wifi glyph would.
  'wifi.slash': 'cloud-offline-outline',
  lock: 'lock-closed-outline',
  'lock.open': 'lock-open-outline',
  'lock.shield': 'shield-checkmark-outline',
  key: 'key-outline',
  // Backup and restore. `arrow.down.circle` is restore specifically — `square.and.arrow.down`
  // already means "import a file", and the two sit next to each other on the transfer screen,
  // so sharing a glyph would make the reversible action and the destructive one look alike.
  folder: 'folder-outline',
  doc: 'document-outline',
  textformat: 'text-outline',
  'arrow.down.circle': 'arrow-down-circle-outline',
  clock: 'time-outline',
  'info.circle': 'information-circle-outline',
  'person.2': 'people-outline',
  qrcode: 'qr-code-outline',
  'doc.on.doc': 'copy-outline',
  pencil: 'create-outline',
  'eye.slash': 'eye-off-outline',
  eye: 'eye-outline',
  'square.and.arrow.up': 'share-outline',
  'square.and.arrow.down': 'download-outline',
  laptopcomputer: 'laptop-outline',
  iphone: 'phone-portrait-outline',
  desktopcomputer: 'desktop-outline',
  globe: 'globe-outline',
  'qrcode.viewfinder': 'scan-outline',
  'arrow.right': 'arrow-forward',
  'building.columns': 'business-outline',
  creditcard: 'card-outline',
  leaf: 'leaf-outline',
  'sun.max': 'sunny-outline',
  moon: 'moon-outline',
  'circle.lefthalf.filled': 'contrast-outline',
  'chart.line.uptrend.xyaxis': 'trending-up-outline',
  // Overview edit toolbar's size-cycle control.
  'arrow.up.left.and.arrow.down.right': 'resize-outline',
};

// ---------------------------------------------------------------------------------------------
// Pixel set: 16x16 bitmaps, each '#' becomes a 1x1 square. Drawn with crispEdges.
// ---------------------------------------------------------------------------------------------

export const PIXEL_GRID = 16;
const E = '................';

/** Builds an SVG path from an ASCII bitmap, merging horizontal runs into one rectangle each. */
export function bitmapToPath(rows: readonly string[]): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#') {
        x += 1;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === '#') end += 1;
      parts.push(`M${x} ${y}h${end - x}v1h${x - end}z`);
      x = end;
    }
  });
  return parts.join('');
}

const flipH = (rows: readonly string[]) => rows.map((row) => Array.from(row).reverse().join(''));
const flipV = (rows: readonly string[]) => [...rows].reverse();
const rot180 = (rows: readonly string[]) => flipV(flipH(rows));
const transpose = (rows: readonly string[]) =>
  Array.from(rows[0] ?? '', (_, x) => rows.map((row) => row[x]).join(''));
const overlay = (a: readonly string[], b: readonly string[]) =>
  a.map((row, y) => Array.from(row, (ch, x) => (ch === '#' || b[y][x] === '#' ? '#' : '.')).join(''));

const ARROW_UP = [E, E,
  '.......##.......',
  '......####......',
  '.....######.....',
  '....##.##.##....',
  '...##..##..##...',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......', E, E, E];

const CHEVRON_FORWARD = [E, E, E,
  '.....##.........',
  '......##........',
  '.......##.......',
  '........##......',
  '.........##.....',
  '.........##.....',
  '........##......',
  '.......##.......',
  '......##........',
  '.....##.........', E, E, E];

const SWAP_TOP = [E, E,
  '..........##....',
  '...........##...',
  '..############..',
  '..############..',
  '...........##...',
  '..........##....', E, E, E, E, E, E, E, E];

const CIRCLE_OUTLINE = [E,
  '.....######.....',
  '...##......##...',
  '..#..........#..',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '..#..........#..',
  '...##......##...',
  '.....######.....', E];

const CIRCLE_FILLED = [E,
  '.....######.....',
  '...##########...',
  '..############..',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '..############..',
  '...##########...',
  '.....######.....', E];

const withDots = (rows: readonly string[], dotted: string, dotRows: readonly number[]) =>
  rows.map((row, y) => (dotRows.includes(y) ? dotted : row));

const SYNC_TOP = [E, E,
  '....#######.....',
  '..##......#####.',
  '.#.........###..',
  '.#..........#...',
  '.#..............',
  '.#..............', E, E, E, E, E, E, E, E];

export const PIXEL_BITMAPS: Record<string, readonly string[]> = {
  add: [E, E, E,
    '.......##.......', '.......##.......', '.......##.......', '.......##.......',
    '...##########...', '...##########...',
    '.......##.......', '.......##.......', '.......##.......', '.......##.......', E, E, E],
  remove: [E, E, E, E, E, E, E,
    '...##########...', '...##########...', E, E, E, E, E, E, E],
  checkmark: [E, E, E,
    '..............##',
    '.............##.',
    '............##..',
    '...........##...',
    '..##......##....',
    '...##....##.....',
    '....##..##......',
    '.....####.......',
    '......##........', E, E, E, E],
  close: [E, E, E,
    '...##......##...',
    '....##....##....',
    '.....##..##.....',
    '......####......',
    '......####......',
    '.....##..##.....',
    '....##....##....',
    '...##......##...', E, E, E, E, E],
  'chevron-forward': CHEVRON_FORWARD,
  'chevron-back': flipH(CHEVRON_FORWARD),
  'chevron-down': transpose(CHEVRON_FORWARD),
  'arrow-up': ARROW_UP,
  'arrow-down': flipV(ARROW_UP),
  'arrow-forward': flipH(transpose(ARROW_UP)),
  search: [E,
    '....######......',
    '...##....##.....',
    '..##......##....',
    '..##......##....',
    '..##......##....',
    '..##......##....',
    '...##....##.....',
    '....######......',
    '.........##.....',
    '..........##....',
    '...........##...',
    '............##..', E, E, E],
  home: [E,
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '..############..',
    '.##############.',
    '....########....',
    '....########....',
    '....###..###....',
    '....###..###....',
    '....###..###....', E, E, E],
  'home-outline': [E,
    '.......##.......',
    '......####......',
    '.....##..##.....',
    '....##....##....',
    '...##......##...',
    '..##........##..',
    '.##..........##.',
    '....##....##....',
    '....##....##....',
    '....##....##....',
    '....##....##....',
    '....########....', E, E, E],
  wallet: [E, E, E, E,
    '..############..',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##########..##.',
    '.##########..##.',
    '.##############.',
    '.##############.',
    '..############..', E, E, E],
  'wallet-outline': [E, E, E, E,
    '..############..',
    '.##..........##.',
    '.##..........##.',
    '.##..........##.',
    '.##.....####.##.',
    '.##.....####.##.',
    '.##..........##.',
    '.##..........##.',
    '..############..', E, E, E],
  'settings-outline': [E,
    '.......##.......',
    '.......##.......',
    '....########....',
    '...###....###...',
    '..###......###..',
    '..##........##..',
    '####........####',
    '####........####',
    '..##........##..',
    '..###......###..',
    '...###....###...',
    '....########....',
    '.......##.......',
    '.......##.......', E],
  'trash-outline': [E, E,
    '......####......',
    '..############..',
    '...##########...',
    '...##......##...',
    '...##.#..#.##...',
    '...##.#..#.##...',
    '...##.#..#.##...',
    '...##.#..#.##...',
    '...##.#..#.##...',
    '...##......##...',
    '...##########...', E, E, E],
  'create-outline': [E, E,
    '..........###...',
    '.........###....',
    '........###.....',
    '.......###......',
    '......###.......',
    '.....###........',
    '....###.........',
    '...###..........',
    '..###...........',
    '..##............',
    '..#.............', E,
    '.##############.', E],
  'calendar-outline': [E, E,
    '...##......##...',
    '..############..',
    '..############..',
    '..##........##..',
    '..##.##.##..##..',
    '..##........##..',
    '..##.##.##..##..',
    '..##........##..',
    '..##.##.##..##..',
    '..##........##..',
    '..############..', E, E, E],
  'receipt-outline': [E,
    '...##########...',
    '...##......##...',
    '...##.####.##...',
    '...##......##...',
    '...##.####.##...',
    '...##......##...',
    '...##.####.##...',
    '...##......##...',
    '...##......##...',
    '...###.##.###...',
    '....#..##..#....', E, E, E, E],
  'pie-chart': [E, E,
    '.....###.##.....',
    '...#####.####...',
    '..######.#####..',
    '.#######.######.',
    '.#######.######.',
    '.#######........',
    '.##############.',
    '.##############.',
    '..############..',
    '...##########...',
    '.....######.....', E, E, E],
  'pie-chart-outline': [E, E,
    '.....######.....',
    '...###..#.###...',
    '..##....#...##..',
    '.##.....#....##.',
    '.##.....#....##.',
    '.##.....#######.',
    '.##..........##.',
    '.##..........##.',
    '..##........##..',
    '...###....###...',
    '.....######.....', E, E, E],
  'swap-horizontal': overlay(SWAP_TOP, rot180(SWAP_TOP)),
  'ellipsis-horizontal-circle-outline': withDots(CIRCLE_OUTLINE, '.#..##.##.##..#.', [7, 8]),
  'ellipsis-horizontal-circle': withDots(CIRCLE_FILLED, '.###..#..#..###.', [7, 8]),
  'cart-outline': [E, E, E,
    '.##.............',
    '..#.###########.',
    '..#..#.......#..',
    '..#...#.....#...',
    '..#....#####....',
    '..###########...', E,
    '....##....##....',
    '....##....##....', E, E, E, E],
  'restaurant-outline': [E,
    '..#.#.#....##...',
    '..#.#.#....##...',
    '..#.#.#....##...',
    '..#.#.#....##...',
    '..#####....##...',
    '...###.....##...',
    '....#......##...',
    '....#......##...',
    '....#......##...',
    '....#......##...',
    '....#......##...',
    '....#......##...',
    '....#......##...', E, E],
  'car-outline': [E, E, E, E,
    '....########....',
    '...#........#...',
    '..#..........#..',
    '.##############.',
    '.#............#.',
    '.#............#.',
    '.##############.',
    '..##........##..',
    '..##........##..', E, E, E],
  'heart-outline': [E, E, E,
    '..####....####..',
    '.#....#..#....#.',
    '.#.....##.....#.',
    '.#............#.',
    '.#............#.',
    '..#..........#..',
    '...#........#...',
    '....#......#....',
    '.....#....#.....',
    '......#..#......',
    '.......##.......', E, E],
  'gift-outline': [E, E,
    '.....##..##.....',
    '....#..##..#....',
    '.....##..##.....',
    '..############..',
    '..#....##....#..',
    '..############..',
    '...#...##...#...',
    '...#...##...#...',
    '...#...##...#...',
    '...#...##...#...',
    '...##########...', E, E, E],
  'cash-outline': [E, E, E, E,
    '.##############.',
    '.#............#.',
    '.#....####....#.',
    '.#...#....#...#.',
    '.#...#....#...#.',
    '.#....####....#.',
    '.#............#.',
    '.##############.', E, E, E, E],
  'lock-closed-outline': [E, E,
    '.....######.....',
    '....#......#....',
    '....#......#....',
    '....#......#....',
    '..############..',
    '..#..........#..',
    '..#..........#..',
    '..#....##....#..',
    '..#....##....#..',
    '..#..........#..',
    '..############..', E, E, E],
  'sync-outline': overlay(SYNC_TOP, rot180(SYNC_TOP)),
};

/** Every glyph in the pixel set, built once. */
const PIXEL_GLYPHS: Record<string, IconGlyph> = Object.fromEntries(
  Object.entries(PIXEL_BITMAPS).map(([name, rows]) => [
    name,
    { kind: 'svg', viewBox: `0 0 ${PIXEL_GRID} ${PIXEL_GRID}`, paths: [{ d: bitmapToPath(rows), fillRule: 'nonzero' }] } satisfies IconGlyph,
  ]),
);

export const ionicons: IconSet = {
  id: 'ionicons',
  label: 'Ionicons',
  resolve: (ionGlyph) => ({ kind: 'ionicon', name: ionGlyph as IoniconName }),
};

export const pixel: IconSet = {
  id: 'pixel',
  label: 'Pixel',
  resolve: (ionGlyph) => (Object.prototype.hasOwnProperty.call(PIXEL_GLYPHS, ionGlyph) ? PIXEL_GLYPHS[ionGlyph] : null),
};

export const ICON_SETS: Readonly<Record<string, IconSet>> = { ionicons, pixel };
export const ICON_SET_IDS: readonly string[] = Object.keys(ICON_SETS);

/** The registered set, or Ionicons for an unknown id. Never throws. */
export function getIconSet(id: string): IconSet {
  return Object.prototype.hasOwnProperty.call(ICON_SETS, id) ? ICON_SETS[id] : ionicons;
}

export function iconSetCoverage(setId: string, glyphs: readonly string[]): { covered: string[]; missing: string[] } {
  const set = getIconSet(setId);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const glyph of glyphs) (set.resolve(glyph) ? covered : missing).push(glyph);
  return { covered, missing };
}

export type IconRender =
  | { kind: 'emoji'; emoji: string }
  | { kind: 'sf'; name: string }
  | IconGlyph;

/**
 * Decides how an icon id is drawn. Pure: `ios` says whether legacy names may use the native
 * `sf:` image. Order: emoji (set ignored) -> `ion:` / legacy -> the set's glyph, else Ionicons.
 */
export function resolveIconRender(parsed: ParsedIconId, setId: string, ios = false): IconRender {
  if (parsed.kind === 'emoji') return { kind: 'emoji', emoji: parsed.emoji };
  const set = getIconSet(setId);
  if (parsed.kind === 'ion') {
    const name = parsed.glyph in Ionicons.glyphMap ? (parsed.glyph as IoniconName) : FALLBACK_GLYPH;
    return set.resolve(name) ?? { kind: 'ionicon', name };
  }
  const mapped = Object.prototype.hasOwnProperty.call(IONICON_BY_SF_NAME, parsed.name) ? IONICON_BY_SF_NAME[parsed.name] : undefined;
  if (ios) {
    if (set.id !== DEFAULT_ICON_SET_ID && mapped) {
      const own = set.resolve(mapped);
      if (own && own.kind === 'svg') return own;
    }
    return { kind: 'sf', name: parsed.name };
  }
  const name = mapped ?? FALLBACK_GLYPH;
  return set.resolve(name) ?? { kind: 'ionicon', name };
}
