import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  resolveBottomChromeInset,
  useScreenMetrics,
  type BottomChromeInset,
} from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";

/**
 * The one place a screen asks "how far from the bottom do my overlays sit?". It reflects whichever
 * navigation chrome is showing (docked native bar, web bottom bar, or the floating Android bar), so
 * the FAB, batch bar and undo bar never hard-code an offset.
 */
export function useBottomChromeInset(): BottomChromeInset {
  const metrics = useScreenMetrics();
  const insets = useSafeAreaInsets();
  const { space } = useQashyTheme();
  return resolveBottomChromeInset(metrics, insets.bottom, space);
}
