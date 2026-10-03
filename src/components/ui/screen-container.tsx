import { type ViewProps, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenTransition } from "@/components/ui/motion";
import {
  resolveBottomChromeInset,
  useScreenMetrics,
  type ScreenMetrics,
} from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";
import { classicTheme } from "@/theme/themes/classic";
import type { SpaceScale } from "@/theme/themes/types";

const IS_WEB = process.env.EXPO_OS === "web";

export interface ScreenInsets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

// Shared metrics so list screens that cannot nest inside ScreenContainer
// (e.g. SectionList content) still match its width and padding.
//
// Everything here is derived from `metrics.contentWidth`, the room the shell
// actually leaves the screen, rather than the window. `metrics.windowWidth`
// stays available for the one decision that really is about the viewport:
// whether the web bottom bar is floating over the end of the content.
//
// `insets` accepts a bare bottom inset for backwards compatibility, or the full
// edge insets. On web the top/right insets are honoured because `+html.tsx`
// opts into `viewport-fit=cover`, so an installed iOS PWA draws under the status
// bar and the rounded display corners. Native tab screens get their top inset
// from the section stack's native header, so it is not added twice here.
export function screenContentMetrics(
  metrics: ScreenMetrics,
  insets: number | ScreenInsets = 0,
  space: SpaceScale = classicTheme.space,
): ViewStyle {
  const edges = typeof insets === "number" ? { bottom: insets } : insets;
  const bottomInset = edges.bottom ?? 0;
  const topInset = IS_WEB ? (edges.top ?? 0) : 0;
  // The rail already pads itself by the left inset, so adding it again here
  // would double-count the notch in landscape on an installed iOS PWA.
  const leftInset =
    IS_WEB && !metrics.hasNavigationRail ? (edges.left ?? 0) : 0;
  const rightInset = IS_WEB ? (edges.right ?? 0) : 0;
  const horizontal = metrics.contentWidth < 600 ? space.lg : 28;
  return {
    width: "100%",
    // Deliberately the window and not the content width. This cap is about how
    // much display there is, and it is the one place where the rail should not
    // be subtracted: keying it off the content width would hold the column at
    // 920 until a 1444px window, wasting most of a 1366px laptop. The step it
    // makes at 1200 is the sidebar expanding, which is a reflow the user asked
    // for by resizing.
    maxWidth: metrics.windowWidth >= 1200 ? 1180 : 920,
    alignSelf: "center",
    paddingLeft: horizontal + leftInset,
    paddingRight: horizontal + rightInset,
    paddingTop: (IS_WEB ? space.xxl : space.md) + topInset,
    // Room to scroll the last row clear of the floating action button (it sits at 92px + its own
    // height above the bottom bar), so nothing is stuck permanently underneath it.
    paddingBottom: resolveBottomChromeInset(metrics, bottomInset, space)
      .contentPaddingBottom,
  };
}

/**
 * Where a screen's floating action button sits.
 *
 * Overview and Transactions each carried their own copy of this expression, and
 * the two had already drifted (`bottom: 26` against `bottom: 24`, one keyed off
 * the content width and the other off the window), so the button moved a couple
 * of pixels as you switched tabs. It also ignored safe-area insets entirely,
 * which put it under the home indicator on an installed iOS PWA.
 */
export function floatingActionMetrics(
  metrics: ScreenMetrics,
  insets: number | ScreenInsets = 0,
  space: SpaceScale = classicTheme.space,
): ViewStyle {
  const edges = typeof insets === "number" ? { bottom: insets } : insets;
  return {
    position: "absolute",
    // Aligns the button with the screen gutter rather than the window edge.
    // `end`, not `right`, so the button follows the reading direction in RTL.
    end:
      (metrics.contentWidth < 600 ? space.lg : 28) +
      (IS_WEB ? (edges.right ?? 0) : 0),
    // Clear the floating web bottom bar or the floating Android bar; docked native tab bars
    // already reserve their own space, so there the inset is the display's, not the chrome's.
    bottom: resolveBottomChromeInset(metrics, edges.bottom ?? 0, space)
      .overlayBottom,
  };
}

export function ScreenContainer({ style, ...props }: ViewProps) {
  const metrics = useScreenMetrics();
  const insets = useSafeAreaInsets();
  const { space } = useQashyTheme();
  return (
    <ScreenTransition
      {...props}
      style={[
        screenContentMetrics(metrics, insets, space),
        { gap: space.xl },
        style,
      ]}
    />
  );
}
