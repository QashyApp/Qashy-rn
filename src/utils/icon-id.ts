/**
 * Icon ids are plain strings stored on entities and replicated to peers, so every format has to
 * stay parseable forever.
 *
 * - `ion:<glyph>`  — an Ionicons glyph, drawn identically on every platform (iOS included).
 * - `emoji:<char>` — a single user-chosen emoji.
 * - anything else  — a legacy SF-Symbol-style name (`cart`, `fork.knife`); iOS draws the real
 *   symbol and other platforms map it to an Ionicons glyph.
 */
export const ION_PREFIX = "ion:";
export const EMOJI_PREFIX = "emoji:";

export type ParsedIconId =
  | { kind: "ion"; glyph: string }
  | { kind: "emoji"; emoji: string }
  | { kind: "legacy"; name: string };

export function ionIconId(glyph: string) {
  return `${ION_PREFIX}${glyph}`;
}

export function emojiIconId(emoji: string) {
  return `${EMOJI_PREFIX}${emoji}`;
}

export function parseIconId(id: string): ParsedIconId {
  if (id.startsWith(ION_PREFIX))
    return { kind: "ion", glyph: id.slice(ION_PREFIX.length) };
  if (id.startsWith(EMOJI_PREFIX))
    return { kind: "emoji", emoji: id.slice(EMOJI_PREFIX.length) };
  return { kind: "legacy", name: id };
}

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };

function graphemes(input: string): string[] {
  const Ctor = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" },
      ) => Segmenter;
    }
  ).Segmenter;
  if (Ctor)
    return Array.from(
      new Ctor(undefined, { granularity: "grapheme" }).segment(input),
      (item) => item.segment,
    );
  // Hermes builds without Intl.Segmenter: code points are a close-enough approximation, and the
  // emoji check below still rejects anything that is not a single pictographic cluster.
  return Array.from(input);
}

// Pictographs, keycaps (digit + U+20E3), and flags (regional-indicator pairs).
const EMOJI_PATTERN =
  /^(?:\p{Extended_Pictographic}|[0-9#*]️?⃣|\p{Regional_Indicator}{2})/u;
const MAX_EMOJI_LENGTH = 32;

/** The single emoji in `input`, or null when it is empty, plain text, or more than one emoji. */
export function normalizeEmoji(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_EMOJI_LENGTH) return null;
  const parts = graphemes(trimmed);
  if (parts.length !== 1) return null;
  return EMOJI_PATTERN.test(parts[0]) ? parts[0] : null;
}

const GLYPH_PATTERN = /^[a-z0-9-]{1,48}$/;
const LEGACY_PATTERN = /^[A-Za-z0-9.]{1,64}$/;

/** Format check only: whether the glyph exists in this build is the renderer's concern. */
export function isValidIconId(id: string): boolean {
  const parsed = parseIconId(id);
  if (parsed.kind === "ion") return GLYPH_PATTERN.test(parsed.glyph);
  if (parsed.kind === "emoji")
    return normalizeEmoji(parsed.emoji) === parsed.emoji;
  return LEGACY_PATTERN.test(parsed.name);
}
