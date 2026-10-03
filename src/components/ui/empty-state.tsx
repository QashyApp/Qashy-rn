import { type ReactNode } from "react";
import { View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { MotionView } from "@/components/ui/motion";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";

/**
 * The one shape an empty list takes.
 *
 * Six screens had each hand-rolled this — an icon tile in a 52, 54, or 56pt
 * square, `paddingVertical` of 28, 30, or 34, a heading, a centred line of body
 * copy, sometimes a button — so the moment a user hit two empty screens in a row
 * the app looked like it had been assembled from two different products. The
 * differences were never decisions; they were whichever number the previous
 * screen happened to use.
 *
 * `compact` is for an empty region nested inside a populated card, where the
 * full-height treatment would push everything below it off the fold.
 */
export function EmptyState({
  icon,
  title,
  body,
  compact = false,
  tone = "default",
  children,
}: {
  icon: string;
  title: string;
  body?: string;
  compact?: boolean;
  /** `'accent'` tints the icon well itself, for the rare empty state that wants more emphasis. */
  tone?: "default" | "accent";
  /** Actions. Rendered in a row below the copy. */
  children?: ReactNode;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const tile = compact ? 48 : 56;
  // The icon tile sits inside a larger sunken well, so it reads as set into
  // the page rather than floating flat on it — the one place in the empty
  // state where material carries the sense of "there's nothing here yet".
  const well = tile + space.md * 2;
  // The well's corners are concentric with the tile's, so both are circles in
  // themes with round cards and both are rounded squares in blockier ones.
  const tileRadius = Math.min(radius.card, tile / 2);
  const wellRadius = Math.min(tileRadius + space.md, well / 2);
  return (
    <MotionView
      variant="down"
      style={{
        alignItems: "center",
        gap: space.md,
        paddingVertical: compact ? space.xxl : 40,
        paddingHorizontal: space.lg,
      }}
    >
      <View
        style={[
          {
            width: well,
            height: well,
            borderRadius: wellRadius,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
          },
          materialStyle(theme, "sunken"),
          // Sunken keeps its carved-in shadow either way; only the fill swaps to
          // an accent tint, so the well still reads as "set into the page".
          tone === "accent" ? { backgroundColor: theme.accentContainer } : null,
        ]}
      >
        <View
          style={{
            width: tile,
            height: tile,
            borderRadius: tileRadius,
            borderCurve: "continuous",
            backgroundColor: theme.accentContainer,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppIcon
            name={icon}
            color={theme.onAccentContainer}
            size={compact ? 21 : 24}
          />
        </View>
      </View>
      <AppText variant="headline" style={{ textAlign: "center" }}>
        {title}
      </AppText>
      {body ? (
        <AppText muted style={{ textAlign: "center", maxWidth: 360 }}>
          {body}
        </AppText>
      ) : null}
      {children ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: space.sm,
            paddingTop: space.xs,
          }}
        >
          {children}
        </View>
      ) : null}
    </MotionView>
  );
}
