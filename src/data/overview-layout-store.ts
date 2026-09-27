/**
 * The device-local Overview screen layout: card order, sizes, and per-card config.
 *
 * Modeled directly on `readRatesFlag` / `writeRatesFlag` in `src/data/exchange-rates/rates-flag.ts`:
 * a small, tolerant reader and a small, explicit writer over the one `sync_meta` key this
 * feature owns (`SYNC_META.overviewLayout`). Writing through `tx` here rather than through
 * `LocalFinanceRepository.putMany` is what keeps this device-local — `putMany` diffs every
 * write into a sync op, while a direct `transact` on `syncingStorage` is a documented
 * pass-through that never captures one. Never inline `SYNC_META.overviewLayout` outside this
 * file.
 */

import type { StorageTx } from '@/data/storage-adapter';
import { SYNC_META, readMeta, writeMeta } from '@/data/sync-store';
import {
  DEFAULT_OVERVIEW_LAYOUT,
  normalizeOverviewLayout,
  serializeOverviewLayout,
  type OverviewLayout,
} from '@/features/overview/layout/overview-layout';

/**
 * Reads the layout. Never throws: an absent key means first launch (the default layout), and
 * unparseable JSON — a stale shape, a hand-edited value, a truncated write — degrades to the
 * default through `normalizeOverviewLayout` rather than crashing the Overview screen.
 */
export async function readOverviewLayout(tx: StorageTx): Promise<OverviewLayout> {
  const meta = await readMeta(tx, [SYNC_META.overviewLayout]);
  const raw = meta.get(SYNC_META.overviewLayout);
  if (raw === undefined) return DEFAULT_OVERVIEW_LAYOUT;

  try {
    return normalizeOverviewLayout(JSON.parse(raw));
  } catch {
    return DEFAULT_OVERVIEW_LAYOUT;
  }
}

export async function writeOverviewLayout(tx: StorageTx, layout: OverviewLayout): Promise<void> {
  await writeMeta(tx, { [SYNC_META.overviewLayout]: serializeOverviewLayout(layout) });
}
