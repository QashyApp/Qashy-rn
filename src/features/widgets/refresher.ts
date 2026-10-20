/**
 * Pushes the widget snapshot to the native module. The same code path serves the app (see
 * `WidgetRefresher`) and the headless task the native side starts for a midnight or boot refresh.
 *
 * Android only: everywhere else, or in a build without the native module, it is a no-op.
 */

import {
  financeRepository,
  syncingStorage,
} from "@/data/local-finance-repository";
import { loadCustomThemeFiles } from "@/data/custom-themes-store";
import { updateWidgetSettings } from "@/data/widget-settings-store";
import { createStandaloneTranslator } from "@/localization/standalone";
import { knownPlacedWidgets } from "@/features/widgets/kinds";
import { createWidgetRefresher } from "@/features/widgets/refresher-core";
import { resolveWidgetPalettes } from "@/features/widgets/palette";
import { buildWidgetSnapshot } from "@/features/widgets/snapshot";
import { parseCustomTheme } from "@/theme/custom/schema";
import { isSystemPalettes } from "@/theme/dynamic-palette";
import type { ThemeDefinition } from "@/theme/themes/types";
import { todayLocal } from "@/utils/date";
import * as QashyDynamicColors from "../../../modules/qashy-dynamic-colors";
import * as QashyWidgets from "../../../modules/qashy-widgets";

async function loadCustomThemes(): Promise<ThemeDefinition[]> {
  try {
    const files = await loadCustomThemeFiles(syncingStorage);
    return files.flatMap((file) => {
      const parsed = parseCustomTheme(file);
      return parsed.ok ? [parsed.theme] : [];
    });
  } catch {
    // No custom themes is the app's own fallback (Classic).
    return [];
  }
}

function readPalettes() {
  try {
    const palettes: unknown = QashyDynamicColors.readSystemPalettes();
    return isSystemPalettes(palettes) ? palettes : null;
  } catch {
    return null;
  }
}

const refresher = createWidgetRefresher({
  isAvailable: () => QashyWidgets.isAvailable(),
  getPlacedWidgets: async () =>
    knownPlacedWidgets(await QashyWidgets.getPlacedWidgets()),
  update: (json) => QashyWidgets.update(json),
  clear: () => QashyWidgets.clear(),
  pruneSettings: (placedIds) =>
    updateWidgetSettings((current) => {
      const stale = Object.keys(current.widgets).filter(
        (id) => !placedIds.has(id),
      );
      if (stale.length === 0) return null;
      const widgets = { ...current.widgets };
      for (const id of stale) delete widgets[id];
      return { ...current, widgets };
    }),
  async buildSnapshot(placed, settings) {
    const state = financeRepository.getSnapshot();
    if (!state.ready) return null;
    const [translator, customThemes] = await Promise.all([
      createStandaloneTranslator(),
      loadCustomThemes(),
    ]);
    const systemPalettes = readPalettes();
    return buildWidgetSnapshot({
      placed,
      settings,
      source: {
        accounts: state.accounts,
        categories: state.categories,
        queryTransactions: (query) =>
          financeRepository.queryTransactions(query),
        getDashboard: (from, to) => financeRepository.getDashboard(from, to),
        getNetWorthSeries: (months, today) =>
          financeRepository.getNetWorthSeries(months, today),
      },
      palettes: (config) =>
        resolveWidgetPalettes(config, state.settings, {
          customThemes,
          systemPalettes,
        }),
      t: translator.t,
      locale: translator.locale,
      today: todayLocal(),
      now: new Date(),
    });
  },
  // Only ever a fixed message and an error name: no amount, title or name can reach a log.
  log: (message, errorName) =>
    console.warn(`[widgets] ${message} (${errorName})`),
});

/**
 * Rebuilds the snapshot and pushes it when it changed. Serialized, coalesced, never rejects;
 * resolves to whether the refresh completed (an unchanged snapshot counts as completed).
 */
export const refreshWidgets = refresher.refresh;

/** Deletes the stored snapshot, then rebuilds it, in order, through the same queue (e.g. after the data was replaced). */
export const clearWidgetData = refresher.clearData;
