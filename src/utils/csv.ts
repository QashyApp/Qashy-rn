import { isLocalDate } from '@/utils/date';

const HEADER_ALIASES: Record<string, string> = {
  date: 'date',
  type: 'type',
  kind: 'type',
  status: 'status',
  title: 'title',
  description: 'title',
  amount: 'amount',
  currency: 'currency',
  account: 'account',
  category: 'category',
  tags: 'tags',
  note: 'note',
  notes: 'note',
  exchange_rate: 'exchangeRate',
  exchangerate: 'exchangeRate',
  destination_account: 'destinationAccount',
  destinationaccount: 'destinationAccount',
  destinationamount: 'destinationAmount',
  destination_amount: 'destinationAmount',
  destination_base_amount_minor: 'destinationBaseAmountMinor',
  destinationbaseamountminor: 'destinationBaseAmountMinor',
};

export function unescapeCsvFormula(value: string) {
  // Strip the single guard apostrophe `escapeCsv` adds. The `'` in the lookahead
  // covers a value that already began with one: it is exported doubled, and only
  // the guard may come back off.
  return value.replace(/^'(?=['=+@\t\r-])/, '');
}

export function parseCsvText(input: string) {
  const table = parseCsvTable(input);
  return table.rows.map((source) => {
    const record: Record<string, string | number> = { rowNumber: source.rowNumber };
    table.headers.forEach((header) => {
      record[HEADER_ALIASES[header] ?? header] = source[header];
    });
    return record;
  });
}

export type CsvRowError = { lineNumber: number; message: string };

export function csvCategoryForRow(
  explicitCategory: string,
  rowKind: string,
  defaultCategory?: { name: string; kind: 'expense' | 'income' },
) {
  if (explicitCategory) return explicitCategory;
  return defaultCategory?.kind === rowKind ? defaultCategory.name : '';
}

const DELIMITERS = [',', ';', '\t'] as const;

// Spreadsheet exports in locales that use the comma as a decimal separator are
// semicolon-delimited, and some tools emit TSV. Guessing from the header line
// beats parsing the whole file as a single column.
function detectDelimiter(input: string) {
  const header = input.split(/\r?\n/, 1)[0] ?? '';
  let best: string = DELIMITERS[0];
  let bestCount = 0;
  for (const candidate of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < header.length; index += 1) {
      const character = header[index];
      if (character === '"' && quoted && header[index + 1] === '"') {
        // Escaped quote inside a quoted header field — skip both without toggling.
        index += 1;
        continue;
      }
      if (character === '"') quoted = !quoted;
      else if (character === candidate && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

type ScannedRow = { cells: string[]; quotedCells: boolean[]; lineNumber: number; error?: string };

// Quote errors are scoped to the row that contains them. Aborting the whole
// file meant one stray quote threw away every valid row alongside it, with no
// way for the user to see which line was at fault.
function scanRows(input: string, delimiter: string) {
  const rows: ScannedRow[] = [];
  let cells: string[] = [];
  let quotedCells: boolean[] = [];
  let field = '';
  let fieldQuoted = false;
  let quoted = false;
  let quoteClosed = false;
  let line = 1;
  let rowLine = 1;
  let rowError: string | undefined;

  const endField = () => {
    cells.push(field);
    quotedCells.push(fieldQuoted);
    field = '';
    fieldQuoted = false;
    quoteClosed = false;
  };
  const endRow = () => {
    endField();
    if (rowError || cells.some((cell) => cell.trim())) {
      rows.push({ cells, quotedCells, lineNumber: rowLine, error: rowError });
    }
    cells = [];
    quotedCells = [];
    quoted = false;
    quoteClosed = false;
    rowError = undefined;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (rowError) {
      // Discard the remainder of a broken row and resynchronise at the next
      // line break, so the rows after it still parse.
      if (character === '\n' || character === '\r') {
        if (character === '\r' && input[index + 1] === '\n') index += 1;
        endRow();
        line += 1;
        rowLine = line;
      }
      continue;
    }
    if (character === '"' && quoted && input[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"' && quoted) {
      quoted = false;
      quoteClosed = true;
      fieldQuoted = true;
    } else if (character === '"' && !quoted && !field.length && !quoteClosed) {
      quoted = true;
      fieldQuoted = true;
    } else if (character === '"') {
      rowError = `Malformed CSV quote on line ${line}.`;
    } else if (character === delimiter && !quoted) {
      endField();
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else {
      if (quoteClosed && !/\s/.test(character)) {
        rowError = `Malformed CSV quote on line ${line}.`;
        continue;
      }
      if (character === '\n') line += 1;
      if (!quoteClosed) field += character;
    }
  }
  if (quoted) rowError = `Unclosed quoted CSV field starting on line ${rowLine}.`;
  endRow();
  return rows;
}

export function parseCsvTable(input: string) {
  const scanned = scanRows(input, detectDelimiter(input));
  const empty = { headers: [] as string[], rows: [] as Record<string, string | number>[], rowErrors: [] as CsvRowError[] };
  if (!scanned.length) return empty;
  // Without a usable header row there is nothing to map columns onto, so this
  // one failure is still fatal for the file.
  if (scanned[0].error) throw new Error(scanned[0].error);
  const headers = scanned[0].cells.map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, '_'));

  const body = scanned.slice(1);
  const rowErrors = body
    .filter((source): source is ScannedRow & { error: string } => Boolean(source.error))
    .map((source) => ({ lineNumber: source.lineNumber, message: source.error }));
  const records = body.filter((source) => !source.error).map((source) => {
    // rowNumber is the physical line in the source file, so error messages
    // stay accurate even when blank lines are skipped.
    const record: Record<string, string | number> = { rowNumber: source.lineNumber };
    headers.forEach((header, column) => {
      const raw = source.cells[column] ?? '';
      record[header] = unescapeCsvFormula(source.quotedCells[column] ? raw : raw.trim());
    });
    return record;
  });
  return { headers, rows: records, rowErrors };
}

/** The fields `extractCsvRatePairs` needs, out of a mapped-but-not-yet-validated CSV row. */
export interface CsvRateCandidate {
  readonly date: string;
  readonly currency: string;
  readonly exchangeRate: string;
}

/**
 * The (currency, date) pairs a CSV preview needs an automatic rate for, before validation runs.
 *
 * A row is a candidate when it has no explicit `exchangeRate` and its currency is not the base
 * — exactly the rows that would otherwise fall through to `resolveRate`'s stored-rate lookup, or
 * to a rejection when nothing is stored. Deduplicated, so a statement with fifty EUR rows on the
 * same day produces one pair rather than fifty identical requests. A row whose date does not
 * parse as a real calendar date is left out; `csvRowSchema` reports that rejection on its own
 * once the row reaches `importCsv`, and guessing a rate for an invalid date would be worse than
 * silence.
 *
 * Pure on purpose: it is called from the CSV screen before preview, where the goal is to keep
 * `ensureRatesFor` out of the component and testable without React or a repository.
 */
export function extractCsvRatePairs(
  rows: readonly CsvRateCandidate[],
  baseCurrency: string,
): { currency: string; localDate: string }[] {
  const base = baseCurrency.trim().toUpperCase();
  const seen = new Set<string>();
  const pairs: { currency: string; localDate: string }[] = [];
  for (const row of rows) {
    if (row.exchangeRate.trim()) continue;
    const currency = row.currency.trim().toUpperCase();
    if (!currency || currency === base) continue;
    const localDate = row.date.trim();
    if (!isLocalDate(localDate)) continue;
    const key = `${currency}|${localDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ currency, localDate });
  }
  return pairs;
}

export function escapeCsv(value: unknown) {
  let text = String(value ?? '');
  // Neutralize spreadsheet formula injection; plain numbers stay untouched.
  // A value that already starts with an apostrophe followed by a dangerous
  // character has to be escaped too: the importer strips one leading
  // apostrophe, so exporting a literal `'=SUM(A1)` unchanged would re-import it
  // as the live formula `=SUM(A1)`.
  // This class must stay identical to the lookahead in `unescapeCsvFormula`: any
  // value the importer would strip an apostrophe from has to be doubled here, and
  // that includes a value already starting with two apostrophes.
  const dangerous = /^[=+@\t\r-]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text);
  if (dangerous || /^'['=+@\t\r-]/.test(text)) text = `'${text}`;
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
