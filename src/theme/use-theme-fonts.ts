import { isLoaded, loadAsync } from "expo-font";
import { useEffect, useMemo, useState } from "react";
import { InteractionManager } from "react-native";

import { FONT_REGISTRY, fontAssetsFor, fontIdsForTheme } from "@/theme/fonts";
import { classicTheme } from "@/theme/themes/classic";
import type { TypeSpec } from "@/theme/themes/types";

/** The fonts the default theme needs: the only ones the splash waits for. */
export const STARTUP_FONT_ASSETS = fontAssetsFor(
  fontIdsForTheme(classicTheme.type),
);

const ALL_FONT_ASSETS = fontAssetsFor(Object.keys(FONT_REGISTRY));

/** Delay past first paint before the remaining faces are fetched in the background. */
const BACKGROUND_FONT_DELAY_MS = 1500;

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
 * Registers every other bundled face once the first screen has settled, so opening Appearance or
 * switching theme finds its fonts ready without making every cold start wait for them.
 */
export function useBackgroundFontLoading() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        if (!allLoaded(ALL_FONT_ASSETS))
          loadAsync(ALL_FONT_ASSETS).catch(() => undefined);
      }, BACKGROUND_FONT_DELAY_MS);
    });
    return () => {
      task.cancel();
      clearTimeout(timer);
    };
  }, []);
}
