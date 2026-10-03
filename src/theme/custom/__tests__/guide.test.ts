import * as fs from 'fs';
import * as path from 'path';

import { FULL_EXAMPLE, MINIMAL_EXAMPLE } from '@/theme/custom/examples';
import { parseCustomTheme } from '@/theme/custom/schema';

/**
 * Keeps CUSTOM_THEME_GUIDE.md honest: every JSON snippet in it is run through the real validator,
 * the two worked examples are the ones in `examples.ts`, and every error message the troubleshooting
 * table quotes still exists in the validator source.
 */

const ROOT = path.resolve(__dirname, '../../../..');
const guide = fs.readFileSync(path.join(ROOT, 'CUSTOM_THEME_GUIDE.md'), 'utf8').replace(/\r\n/g, '\n');
const validatorSource = ['schema.ts', 'contrast.ts']
  .map((file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'))
  .join('\n');

interface Block {
  label: string | null;
  lang: string;
  body: string;
}

/** Every fenced block, with the `<!-- label -->` comment that sits on the line right before it. */
function extractBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^```(\w*)\s*$/.exec(lines[index]);
    if (!open) continue;
    const before = index > 0 ? /^<!--\s*([\w-]+)\s*-->$/.exec(lines[index - 1].trim()) : null;
    const body: string[] = [];
    index += 1;
    while (index < lines.length && !/^```\s*$/.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    blocks.push({ label: before ? before[1] : null, lang: open[1], body: body.join('\n') });
  }
  return blocks;
}

const blocks = extractBlocks(guide);
const jsonBlocks = blocks.filter((block) => block.lang === 'json');

function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      collectKeys(entry, into);
    }
  }
  return into;
}

describe('CUSTOM_THEME_GUIDE.md json snippets', () => {
  it('has json blocks, each labeled valid or invalid', () => {
    expect(jsonBlocks.length).toBeGreaterThanOrEqual(5);
    for (const block of jsonBlocks) {
      expect(['valid', 'invalid']).toContain(block.label);
    }
    expect(jsonBlocks.filter((block) => block.label === 'invalid').length).toBeGreaterThanOrEqual(2);
  });

  it.each(jsonBlocks.filter((block) => block.label === 'valid').map((block, index) => [index, block] as const))(
    'valid snippet %i parses through parseCustomTheme',
    (_index, block) => {
      const result = parseCustomTheme(JSON.parse(block.body));
      if (!result.ok) throw new Error(result.errors.join('; '));
      expect(result.ok).toBe(true);
    },
  );

  it.each(jsonBlocks.filter((block) => block.label === 'invalid').map((block, index) => [index, block] as const))(
    'invalid snippet %i is valid JSON but is rejected',
    (_index, block) => {
      const parsed: unknown = JSON.parse(block.body);
      const result = parseCustomTheme(parsed);
      expect(result.ok).toBe(false);
    },
  );

  it('embeds the minimal and full examples verbatim', () => {
    const find = (id: string) => jsonBlocks.find((block) => (JSON.parse(block.body) as { id?: string }).id === id);
    const minimal = find(MINIMAL_EXAMPLE.id);
    const full = find(FULL_EXAMPLE.id);
    expect(minimal).toBeDefined();
    expect(full).toBeDefined();
    expect(JSON.parse(minimal!.body)).toEqual(MINIMAL_EXAMPLE);
    expect(JSON.parse(full!.body)).toEqual(FULL_EXAMPLE);
    // "Verbatim" includes the pretty-printing, so copy and paste produces the same file.
    expect(minimal!.body).toBe(JSON.stringify(MINIMAL_EXAMPLE, null, 2));
    expect(full!.body).toBe(JSON.stringify(FULL_EXAMPLE, null, 2));
  });

  it('shows contrast warnings that the validator really produces', () => {
    const index = blocks.findIndex((block) => block.label === 'warnings');
    expect(index).toBeGreaterThan(0);
    const source = blocks[index - 1];
    expect(source.lang).toBe('json');
    const result = parseCustomTheme(JSON.parse(source.body));
    if (!result.ok) throw new Error(result.errors.join('; '));
    const shown = blocks[index].body.split('\n').filter(Boolean);
    expect(shown.length).toBeGreaterThan(0);
    for (const line of shown) expect(result.warnings).toContain(line);
  });
});

describe('CUSTOM_THEME_GUIDE.md troubleshooting table', () => {
  const section = guide.split(/^## Troubleshooting\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const rows = section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2); // header and separator
  const fragments = rows.map((row) => {
    const cell = row.split('|')[1] ?? '';
    return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  });

  it('has rows, each quoting at least one fragment', () => {
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const row of fragments) expect(row.length).toBeGreaterThan(0);
  });

  it('quotes only fragments that exist in the validator source', () => {
    for (const row of fragments) {
      for (const fragment of row) {
        expect({ fragment, found: validatorSource.includes(fragment) }).toEqual({ fragment, found: true });
      }
    }
  });
});

describe('CUSTOM_THEME_GUIDE.md coverage', () => {
  it('mentions every top-level schema key in code font', () => {
    for (const key of Object.keys(FULL_EXAMPLE)) {
      expect({ key, mentioned: guide.includes(`\`${key}\``) }).toEqual({ key, mentioned: true });
    }
  });

  it('mentions every field the full example uses', () => {
    for (const key of collectKeys(FULL_EXAMPLE)) {
      const mentioned = guide.includes(`\`${key}\``) || guide.includes(`.${key}\``) || guide.includes(`.${key}.`) || guide.includes(`.${key} `);
      expect({ key, mentioned }).toEqual({ key, mentioned: true });
    }
  });

  it('names the limits that the validator enforces', () => {
    expect(guide).toContain('16 KB');
    expect(guide).toContain('8 custom themes');
  });
});
