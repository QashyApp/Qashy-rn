/**
 * Android string-resource naming and formatting. Pure, with no imports, so the
 * build-time catalog generator (Node) and the app share one implementation.
 *
 * The hash below is a NON-CRYPTOGRAPHIC naming hash: it only turns an arbitrary
 * English string into a stable, valid Android resource name. It protects nothing,
 * so the cryptography rules in AGENTS.md (everything under `src/sync/crypto/`)
 * do not apply to it.
 */

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** UTF-8 encodes `text`; a lone surrogate becomes U+FFFD, as TextEncoder does. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/** "q_" + the 16 lowercase hex digits of the FNV-1a 64-bit hash of `key`'s UTF-8 bytes. */
export function resourceName(key: string): string {
  let hash = FNV64_OFFSET;
  for (const byte of utf8Bytes(key)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & MASK64;
  }
  return `q_${hash.toString(16).padStart(16, "0")}`;
}

/** Resource name of a dynamic pattern, derived from its regex source. */
export function patternResourceName(regex: RegExp): string {
  return resourceName(`pattern:${regex.source}`);
}

/**
 * Converts a fully anchored `/^...$/` regex made only of plain literal text and
 * capture groups into an English format string: group n becomes `%n$s`, regex
 * escapes are unescaped and a literal `%` becomes `%%`. Returns null for anything
 * else (flags, optional groups, alternation, quantifiers on literals, character
 * classes outside groups, lookarounds, nested or non-capturing groups, ...).
 */
export function patternFormat(regex: RegExp): string | null {
  if (regex.flags !== "") return null;
  const source = regex.source;
  if (source.length < 2 || source[0] !== "^") return null;
  if (source[source.length - 1] !== "$") return null;
  const body = source.slice(1, -1);

  let out = "";
  let groups = 0;
  let i = 0;
  while (i < body.length) {
    const char = body[i];
    if (char === "\\") {
      const next = body[i + 1];
      // Only escaped punctuation is a plain literal; \d, \s, \b, \n, \u... are not.
      if (next === undefined || /[A-Za-z0-9]/.test(next)) return null;
      out += next === "%" ? "%%" : next;
      i += 2;
    } else if (char === "(") {
      const end = captureGroupEnd(body, i);
      if (end === null) return null;
      // A quantifier after the group makes it optional or repeated.
      if (/[*+?{]/.test(body[end + 1] ?? "")) return null;
      groups += 1;
      out += `%${groups}$s`;
      i = end + 1;
    } else if ("[]{}()*+?|.^$".includes(char)) {
      return null;
    } else {
      // A quantifier on a literal is rejected above, because `*+?{` are never literal here.
      out += char === "%" ? "%%" : char;
      i += 1;
    }
  }
  return out;
}

/**
 * Index of the `)` closing the capture group opened at `start`, or null when the
 * group is not a plain capture group (starts with `?`, or contains a nested capture group).
 */
function captureGroupEnd(body: string, start: number): number | null {
  if (body[start + 1] === "?") return null;
  let depth = 1;
  let inClass = false;
  for (let i = start + 1; i < body.length; i += 1) {
    const char = body[i];
    if (char === "\\") {
      i += 1;
    } else if (inClass) {
      if (char === "]") inClass = false;
    } else if (char === "[") {
      inClass = true;
    } else if (char === "(") {
      // Only non-capturing groups may nest; a nested capture would shift numbering.
      if (!body.startsWith("(?:", i)) return null;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

/** Substitutes `%n$s` with `args[n - 1]` and `%%` with `%`. Unknown placeholders stay as written. */
export function formatResource(
  template: string,
  args: readonly string[],
): string {
  return template.replace(/%(?:(\d+)\$s|%)/g, (match, index?: string) => {
    if (index === undefined) return "%";
    const value = args[Number(index) - 1];
    return value === undefined ? match : value;
  });
}
