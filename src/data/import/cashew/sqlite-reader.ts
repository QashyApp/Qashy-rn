import { ImportError, type RawRow, type RawValue } from "../types";

/**
 * A dependency-free, read-only reader for the SQLite file format
 * (https://www.sqlite.org/fileformat2.html).
 *
 * It exists so a backup can be parsed identically on web, native and under Jest without
 * shipping a WASM build or a native module. Only what a plain rowid table needs is
 * implemented: the header, table b-tree pages, overflow chains and record decoding.
 */

const MAGIC = "SQLite format 3\0";
const HEADER_SIZE = 100;
const PAGE_INTERIOR_TABLE = 0x05;
const PAGE_LEAF_TABLE = 0x0d;
// A b-tree of even 2^64 rows is far shallower than this; the cap only stops a crafted
// file from recursing forever.
const MAX_TREE_DEPTH = 32;
// A personal budget backup holds thousands of rows. This cap across all tables stops a crafted or
// enormous file from exhausting memory before the mapper ever sees it.
const MAX_TOTAL_ROWS = 500_000;
const tooManyRows = () =>
  new ImportError(
    "unsupported",
    "This backup has more than 500,000 rows and is too large to import.",
  );

const corrupt = (detail: string) =>
  new ImportError(
    "corrupt",
    `This SQLite file looks damaged or incomplete (${detail}).`,
  );

interface Header {
  pageSize: number;
  usableSize: number;
  pageCount: number;
}

interface Varint {
  value: number;
  next: number;
}

interface RawRecord {
  rowid: number;
  values: RawValue[];
}

// Validates the 100-byte file header. Fields that only matter to writers are ignored.
function readHeader(bytes: Uint8Array): Header {
  if (bytes.length < MAGIC.length) throw notSqlite();
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) throw notSqlite();
  }
  if (bytes.length < HEADER_SIZE) throw corrupt("the header is cut short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The page size is a u16, so 65536 cannot be stored directly; the format uses 1 for it.
  const rawPageSize = view.getUint16(16, false);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0)
    throw corrupt("invalid page size");

  // 0 means "not set yet" and behaves as UTF-8; 2 and 3 are the two UTF-16 flavours.
  const encoding = view.getUint32(56, false);
  if (encoding !== 0 && encoding !== 1) {
    throw new ImportError(
      "unsupported",
      "This SQLite file uses UTF-16 text, which is not supported.",
    );
  }

  const reserved = view.getUint8(20);
  const usableSize = pageSize - reserved;
  if (usableSize < 480) throw corrupt("invalid reserved space");

  // The in-header page count is only trustworthy when the change counter (offset 24)
  // matches "version-valid-for" (offset 92); otherwise derive it from the file length.
  const headerPages = view.getUint32(28, false);
  const trusted =
    headerPages > 0 && view.getUint32(24, false) === view.getUint32(92, false);
  const pageCount = trusted ? headerPages : Math.floor(bytes.length / pageSize);
  if (pageCount < 1) throw corrupt("no pages");
  if (bytes.length < pageCount * pageSize)
    throw corrupt("the file is shorter than its header says");

  return { pageSize, usableSize, pageCount };
}

function notSqlite(): ImportError {
  return new ImportError(
    "not-sqlite",
    "This file is not a SQLite database, so it cannot be imported.",
  );
}

/** `user_version` from the database header (Cashew stores its schema version here). */
export function readSqliteUserVersion(bytes: Uint8Array): number {
  readHeader(bytes);
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(60, false);
}

// Varints are 1-9 bytes, big-endian, 7 bits per byte with the high bit meaning "more".
// The ninth byte contributes all 8 bits. Multiplying rather than shifting keeps values
// above 2^31 exact until 2^53, past which the file is not something we can represent.
// Every varint is checked, not only the nine-byte form: an eight-byte value can already exceed 2^53,
// and a value that is not a safe integer cannot be used as a size, page number or row id.
function checkedVarint(value: number, next: number): Varint {
  if (!Number.isSafeInteger(value)) throw corrupt("a number is too large");
  return { value, next };
}

function readVarint(bytes: Uint8Array, offset: number): Varint {
  let value = 0;
  for (let i = 0; i < 8; i += 1) {
    const byte = bytes[offset + i];
    if (byte === undefined)
      throw corrupt("a number runs past the end of the page");
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return checkedVarint(value, offset + i + 1);
  }
  const last = bytes[offset + 8];
  if (last === undefined)
    throw corrupt("a number runs past the end of the page");
  value = value * 256 + last;
  if (!Number.isSafeInteger(value)) throw corrupt("a number is too large");
  return { value, next: offset + 9 };
}

// Hand-written on purpose. `TextDecoder` is missing or partial on some Hermes builds, and
// a decoder that behaves the same everywhere keeps import results platform-independent.
// Invalid sequences become U+FFFD instead of throwing so a stray byte cannot block a backup.
function decodeUtf8(bytes: Uint8Array, start: number, end: number): string {
  const chunks: string[] = [];
  let units: number[] = [];
  const flush = () => {
    chunks.push(String.fromCharCode.apply(null, units));
    units = [];
  };
  const push = (unit: number) => {
    units.push(unit);
    if (units.length >= 4096) flush();
  };
  let i = start;
  while (i < end) {
    const b0 = bytes[i];
    let codePoint = 0xfffd;
    let length = 1;
    if (b0 < 0x80) {
      codePoint = b0;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      const b1 = bytes[i + 1];
      if (i + 1 < end && (b1 & 0xc0) === 0x80) {
        codePoint = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
        length = 2;
      }
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      if (i + 2 < end && (b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
        const candidate =
          ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
        // Reject overlong forms and lone surrogates.
        if (candidate >= 0x800 && (candidate < 0xd800 || candidate > 0xdfff)) {
          codePoint = candidate;
          length = 3;
        }
      }
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const b3 = bytes[i + 3];
      if (
        i + 3 < end &&
        (b1 & 0xc0) === 0x80 &&
        (b2 & 0xc0) === 0x80 &&
        (b3 & 0xc0) === 0x80
      ) {
        const candidate =
          ((b0 & 0x07) << 18) |
          ((b1 & 0x3f) << 12) |
          ((b2 & 0x3f) << 6) |
          (b3 & 0x3f);
        if (candidate >= 0x10000 && candidate <= 0x10ffff) {
          codePoint = candidate;
          length = 4;
        }
      }
    }
    if (codePoint >= 0x10000) {
      const offset = codePoint - 0x10000;
      push(0xd800 + (offset >> 10));
      push(0xdc00 + (offset & 0x3ff));
    } else {
      push(codePoint);
    }
    i += length;
  }
  flush();
  return chunks.join("");
}

// Serial types 1-6 are signed big-endian integers of 1, 2, 3, 4, 6 and 8 bytes. Up to six
// bytes a running total stays exact; eight bytes are split into a signed high word and an
// unsigned low word, and rejected if they leave the safe-integer range rather than
// silently losing digits (money amounts here are minor units, which always fit).
function readSignedInt(
  bytes: Uint8Array,
  offset: number,
  width: number,
): number {
  if (width === 8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const value =
      view.getInt32(0, false) * 4294967296 + view.getUint32(4, false);
    if (!Number.isSafeInteger(value))
      throw corrupt("an integer is outside the supported range");
    return value;
  }
  let value = 0;
  for (let i = 0; i < width; i += 1) {
    value = value * 256 + bytes[offset + i];
  }
  return (bytes[offset] & 0x80) !== 0 ? value - 2 ** (8 * width) : value;
}

function decodeRecord(payload: Uint8Array): RawValue[] {
  const header = readVarint(payload, 0);
  const headerEnd = header.value;
  if (headerEnd > payload.length)
    throw corrupt("a row header runs past its data");
  const serialTypes: number[] = [];
  let pos = header.next;
  while (pos < headerEnd) {
    const serial = readVarint(payload, pos);
    serialTypes.push(serial.value);
    pos = serial.next;
  }

  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const values: RawValue[] = [];
  let offset = headerEnd;
  const need = (size: number) => {
    if (offset + size > payload.length)
      throw corrupt("a row is shorter than its header says");
  };
  for (const type of serialTypes) {
    if (type === 0) {
      values.push(null);
    } else if (type >= 1 && type <= 6) {
      const width = type <= 4 ? type : type === 5 ? 6 : 8;
      need(width);
      values.push(readSignedInt(payload, offset, width));
      offset += width;
    } else if (type === 7) {
      need(8);
      values.push(view.getFloat64(offset, false));
      offset += 8;
    } else if (type === 8) {
      values.push(0);
    } else if (type === 9) {
      values.push(1);
    } else if (type === 10 || type === 11) {
      throw corrupt("a row uses a reserved value type");
    } else if (type % 2 === 0) {
      // A BLOB. Cashew stores none, and nothing downstream can use raw bytes, so it is
      // skipped but still measured so the following columns stay aligned.
      const size = (type - 12) / 2;
      need(size);
      values.push(null);
      offset += size;
    } else {
      const size = (type - 13) / 2;
      need(size);
      values.push(decodeUtf8(payload, offset, offset + size));
      offset += size;
    }
  }
  return values;
}

class SqliteFile {
  private readonly bytes: Uint8Array;
  private readonly header: Header;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.header = readHeader(bytes);
  }

  private page(pageNumber: number): Uint8Array {
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > this.header.pageCount
    ) {
      throw corrupt(`page ${pageNumber} does not exist`);
    }
    const start = (pageNumber - 1) * this.header.pageSize;
    return this.bytes.subarray(start, start + this.header.pageSize);
  }

  /** Every row of the table b-tree rooted at `rootPage`, in rowid order, at most `maxRows` of them. */
  readTable(rootPage: number, maxRows: number): RawRecord[] {
    const rows: RawRecord[] = [];
    this.maxRows = maxRows;
    this.walk(rootPage, 0, new Set<number>(), rows);
    return rows;
  }

  private maxRows = 0;

  private walk(
    pageNumber: number,
    depth: number,
    seen: Set<number>,
    out: RawRecord[],
  ): void {
    if (depth > MAX_TREE_DEPTH) throw corrupt("the table is nested too deeply");
    // A page reachable twice means a loop or two branches sharing a page: never valid.
    if (seen.has(pageNumber)) throw corrupt("a page is referenced twice");
    seen.add(pageNumber);

    const page = this.page(pageNumber);
    // Page 1 starts with the 100-byte file header, so its b-tree header is pushed down.
    const base = pageNumber === 1 ? HEADER_SIZE : 0;
    const type = page[base];
    const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
    const cellCount = view.getUint16(base + 3, false);

    if (type === PAGE_INTERIOR_TABLE) {
      const pointerArray = base + 12;
      for (let i = 0; i < cellCount; i += 1) {
        const cell = view.getUint16(pointerArray + i * 2, false);
        if (cell + 4 > page.length)
          throw corrupt("a cell points outside its page");
        // The rowid key after the child pointer is only needed to search; a full scan
        // just visits children left to right, then the right-most pointer.
        this.walk(view.getUint32(cell, false), depth + 1, seen, out);
      }
      this.walk(view.getUint32(base + 8, false), depth + 1, seen, out);
    } else if (type === PAGE_LEAF_TABLE) {
      const pointerArray = base + 8;
      for (let i = 0; i < cellCount; i += 1) {
        const cell = view.getUint16(pointerArray + i * 2, false);
        if (cell >= page.length)
          throw corrupt("a cell points outside its page");
        if (out.length >= this.maxRows) throw tooManyRows();
        out.push(this.readLeafCell(page, cell));
      }
    } else {
      throw corrupt("unexpected page type");
    }
  }

  private readLeafCell(page: Uint8Array, offset: number): RawRecord {
    const size = readVarint(page, offset);
    const rowid = readVarint(page, size.next);
    const payloadSize = size.value;
    if (payloadSize > this.bytes.length)
      throw corrupt("a row is larger than the file");

    // Exact local-payload rule from the format spec: rows that do not fit keep only
    // enough bytes on the b-tree page that the rest fills whole overflow pages.
    const usable = this.header.usableSize;
    const maxLocal = usable - 35;
    let local = payloadSize;
    if (payloadSize > maxLocal) {
      const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
      const spill = minLocal + ((payloadSize - minLocal) % (usable - 4));
      local = spill <= maxLocal ? spill : minLocal;
    }

    const localStart = rowid.next;
    if (localStart + local > page.length)
      throw corrupt("a row runs past its page");
    if (local === payloadSize) {
      return {
        rowid: rowid.value,
        values: decodeRecord(page.subarray(localStart, localStart + local)),
      };
    }

    if (localStart + local + 4 > page.length)
      throw corrupt("a row runs past its page");
    const payload = new Uint8Array(payloadSize);
    payload.set(page.subarray(localStart, localStart + local), 0);
    const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
    let next = view.getUint32(localStart + local, false);
    let filled = local;
    while (filled < payloadSize) {
      if (next === 0) throw corrupt("an overflow chain ends early");
      const overflow = this.page(next);
      const take = Math.min(usable - 4, payloadSize - filled);
      payload.set(overflow.subarray(4, 4 + take), filled);
      filled += take;
      next = new DataView(
        overflow.buffer,
        overflow.byteOffset,
        overflow.byteLength,
      ).getUint32(0, false);
    }
    return { rowid: rowid.value, values: decodeRecord(payload) };
  }
}

interface TableSchema {
  columns: string[];
  /** Index of the `INTEGER PRIMARY KEY` column, which SQLite stores as NULL. */
  rowidAlias: number;
}

const TABLE_CONSTRAINT_KEYWORDS = new Set([
  "PRIMARY",
  "FOREIGN",
  "UNIQUE",
  "CHECK",
  "CONSTRAINT",
]);

// Splits the body of a CREATE TABLE on top-level commas, honouring nesting and the four
// quoting styles SQLite accepts, and dropping comments.
function splitColumnDefinitions(sql: string): string[] {
  const open = sql.indexOf("(");
  if (open === -1) return [];
  const entries: string[] = [];
  let current = "";
  let depth = 1;
  let i = open + 1;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? sql.length : close + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const closer = ch === "[" ? "]" : ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === closer) {
          // A doubled quote is an escaped quote (brackets have no escape).
          if (closer !== "]" && sql[j + 1] === closer) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
    if (ch === "," && depth === 1) {
      entries.push(current);
      current = "";
    } else {
      current += ch;
    }
    i += 1;
  }
  if (current.trim()) entries.push(current);
  return entries;
}

function firstIdentifier(
  entry: string,
): { name: string; quoted: boolean; rest: string } | null {
  const text = entry.trimStart();
  if (!text) return null;
  const ch = text[0];
  if (ch === '"' || ch === "`" || ch === "'" || ch === "[") {
    const closer = ch === "[" ? "]" : ch;
    let name = "";
    let j = 1;
    while (j < text.length) {
      if (text[j] === closer) {
        if (closer !== "]" && text[j + 1] === closer) {
          name += closer;
          j += 2;
          continue;
        }
        break;
      }
      name += text[j];
      j += 1;
    }
    return { name, quoted: true, rest: text.slice(j + 1) };
  }
  const match = /^[^\s(,]+/.exec(text);
  if (!match) return null;
  return { name: match[0], quoted: false, rest: text.slice(match[0].length) };
}

function parseTableSchema(sql: string): TableSchema {
  const columns: string[] = [];
  let rowidAlias = -1;
  for (const entry of splitColumnDefinitions(sql)) {
    const identifier = firstIdentifier(entry);
    if (!identifier) continue;
    if (
      !identifier.quoted &&
      TABLE_CONSTRAINT_KEYWORDS.has(identifier.name.toUpperCase())
    )
      continue;
    // Only the exact declared type INTEGER makes a column an alias of the rowid; `INT`,
    // `BIGINT` or `PRIMARY KEY DESC` do not.
    if (
      /^\s*integer\b/i.test(identifier.rest) &&
      /\bprimary\s+key\b/i.test(identifier.rest) &&
      !/\bprimary\s+key\s+desc\b/i.test(identifier.rest)
    ) {
      rowidAlias = columns.length;
    }
    columns.push(identifier.name);
  }
  return { columns, rowidAlias };
}

function asText(value: RawValue): string {
  return typeof value === "string" ? value : "";
}

function readAllTables(bytes: Uint8Array): Record<string, RawRow[]> {
  const file = new SqliteFile(bytes);
  // A null-prototype map: table names come from the file, and a table called "__proto__" must not
  // rewrite the prototype of the object it is stored in.
  const tables: Record<string, RawRow[]> = Object.create(null);
  // The schema table is always rooted at page 1: type, name, tbl_name, rootpage, sql.
  const schema = file.readTable(1, MAX_TOTAL_ROWS);
  let remainingRows = MAX_TOTAL_ROWS - schema.length;
  for (const entry of schema) {
    const [type, name, , rootpage, sql] = entry.values;
    if (
      type !== "table" ||
      typeof name !== "string" ||
      name.startsWith("sqlite_")
    )
      continue;
    // Virtual tables have no b-tree (rootpage 0); WITHOUT ROWID tables use index pages.
    if (typeof rootpage !== "number" || rootpage < 1) continue;
    const definition = asText(sql);
    if (/\bwithout\s+rowid\b/i.test(definition)) continue;

    const tableSchema = parseTableSchema(definition);
    const rows: RawRow[] = [];
    const records = file.readTable(rootpage, remainingRows);
    remainingRows -= records.length;
    for (const record of records) {
      const row: RawRow = Object.create(null);
      const width = Math.max(tableSchema.columns.length, record.values.length);
      for (let i = 0; i < width; i += 1) {
        // Columns added later with ALTER TABLE are absent from older rows.
        const key = tableSchema.columns[i] ?? `column_${i}`;
        const value = record.values[i] ?? null;
        row[key] =
          i === tableSchema.rowidAlias && value === null ? record.rowid : value;
      }
      rows.push(row);
    }
    tables[name] = rows;
  }
  return tables;
}

/** Reads every table of a SQLite file into rows keyed by column name. */
export function readSqliteTables(bytes: Uint8Array): Record<string, RawRow[]> {
  try {
    return readAllTables(bytes);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // RangeErrors from reading past a truncated buffer, and anything else unexpected,
    // mean the bytes were not a well-formed database.
    throw corrupt("unreadable data");
  }
}
