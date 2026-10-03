import { isFontId, stackFor } from "@/theme/fonts";
import { ICON_SETS } from "@/theme/icon-sets";
import type { ThemeDefinition } from "@/theme/themes/types";

/**
 * Per-device appearance overrides that sit on top of the active theme (`AppSettings`
 * `fontTextOverride` and friends). `null` / `undefined` follow the theme.
 */
export interface AppearanceOverrides {
  fontTextOverride?: string | null;
  fontNumericOverride?: string | null;
  uiIconSetOverride?: string | null;
  categoryIconSetOverride?: string | null;
}

const isIconSetId = (id: unknown): id is string =>
  typeof id === "string" && Object.prototype.hasOwnProperty.call(ICON_SETS, id);

/**
 * The theme with the user's font and icon-set choices applied. An id this build cannot resolve
 * (stale, from a future version) is ignored, so the theme default shows. A chosen font keeps
 * Hebrew coverage: `stackFor` appends Rubik when the face has no Hebrew glyphs.
 *
 * Returns the same object when nothing changes, so memoised consumers stay stable.
 */
export function applyAppearanceOverrides(
  theme: ThemeDefinition,
  overrides: AppearanceOverrides,
): ThemeDefinition {
  const text = overrides.fontTextOverride;
  const numeric = overrides.fontNumericOverride;
  const ui = overrides.uiIconSetOverride;
  const category = overrides.categoryIconSetOverride;
  const useText = isFontId(text);
  const useNumeric = isFontId(numeric);
  const useUi = isIconSetId(ui);
  const useCategory = isIconSetId(category);
  if (!useText && !useNumeric && !useUi && !useCategory) return theme;
  return {
    ...theme,
    type: {
      ...theme.type,
      text: useText ? stackFor(text) : theme.type.text,
      numeric: useNumeric ? stackFor(numeric) : theme.type.numeric,
    },
    icons: {
      ...theme.icons,
      set: useUi ? ui : theme.icons.set,
      // Without an explicit category choice the category set keeps following the theme: its own
      // `categorySet`, or its UI set (which a UI override must not silently retarget).
      categorySet: useCategory
        ? category
        : (theme.icons.categorySet ?? theme.icons.set),
    },
  };
}
