import { isLoaded, loadAsync } from "expo-font";
import { useEffect, useMemo, useState } from "react";

import { FONT_REGISTRY, fontAssetsFor, fontIdsForTheme } from "@/theme/fonts";
import { classicTheme } from "@/theme/themes/classic";
import type { TypeSpec } from "@/theme/themes/types";

/** The fonts the default theme needs: the only ones the splash waits for. */
export const STARTUP_FONT_ASSETS = fontAssetsFor(
  fontIdsForTheme(classicTheme.type),
);

const ALL_FONT_ASSETS = fontAssetsFor(Object.keys(FONT_REGISTRY));

const allLoaded = (assets: Record<string, number>) =>
  Object.keys(assets).every((family) => isLoaded(family));

/**
 * Loads the faces the *active* type spec resolves to. `expo-font`'s `useFonts` ignores a changed
 * map after mount, so a theme or font-override switch needs its own effect. Returns false until
 * every face is registered (immediately true when they already were, e.g. the classic default).
 * A load failure counts as done: text falls through to the system face rather than hanging.
 */
export function useThemeFonts(type: TypeSpec) {
  const assets = useMemo(() => fontAssetsFor(fontIdsForTheme(type)), [type]);
  const [loadedFor, setLoadedFor] = useState<
    Record<string, number> | undefined
  >();
  useEffect(() => {
    let live = true;
    const done = () => {
      if (live) setLoadedFor(assets);
    };
    loadAsync(assets).then(done, done);
    return () => {
      live = false;
    };
  }, [assets]);
  return loadedFor === assets || allLoaded(assets);
}

/**
 * Registers every bundled face while `enabled`, for a picker that previews each font in its own
 * type. Nothing else needs them, so a cold start loads only what the active theme uses. Re-renders
 * once they land so the previews swap from the system face.
 */
export function useAllFonts(enabled: boolean) {
  const [, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled || allLoaded(ALL_FONT_ASSETS)) return;
    let live = true;
    const done = () => {
      if (live) setLoaded(true);
    };
    loadAsync(ALL_FONT_ASSETS).then(done, done);
    return () => {
      live = false;
    };
  }, [enabled]);
}
