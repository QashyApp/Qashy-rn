import { useState } from "react";
import { View, type ColorValue } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { AnimatedMoney } from "@/components/finance/animated-money";
import { StatTile } from "@/components/finance/stat-tile";
import { AppText } from "@/components/ui/app-text";
import type { CurrencyCode } from "@/domain/models";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";

export interface SummaryTileData {
  label: string;
  amountMinor: number;
  color: ColorValue;
}

/** The compact tile's height: one line of figure between the tile's own padding. */
const COMPACT_HEIGHT = 36;

/**
 * The month's Income / Spent / Net tiles, which fold to a single line as `collapse` goes 0 → 1.
 *
 * The full tile (label above figure) and the compact one (label beside figure) are two layers
 * of the same well, cross-fading while its height folds from the full tile's measured height
 * down to one line, so the figure and its label stay on screen the whole way.
 */
export function CollapsingSummaryTiles({
  tiles,
  currency,
  locale,
  compactFigures,
  collapse,
}: {
  tiles: readonly SummaryTileData[];
  currency: CurrencyCode;
  locale: string;
  compactFigures: boolean;
  collapse: SharedValue<number>;
}) {
  const { space } = useQashyTheme();
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      {tiles.map((tile) => (
        <View key={tile.label} style={{ flex: 1, minWidth: 0 }}>
          <CollapsingTile
            tile={tile}
            currency={currency}
            locale={locale}
            compactFigures={compactFigures}
            collapse={collapse}
          />
        </View>
      ))}
    </View>
  );
}

function CollapsingTile({
  tile,
  currency,
  locale,
  compactFigures,
  collapse,
}: {
  tile: SummaryTileData;
  currency: CurrencyCode;
  locale: string;
  compactFigures: boolean;
  collapse: SharedValue<number>;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const [fullHeight, setFullHeight] = useState<number | null>(null);
  // The compact line grows with the font scale, so the well folds to its measured height rather
  // than a fixed one (a fixed height clips the figure at large text sizes).
  const [compactHeight, setCompactHeight] = useState<number | null>(null);
  const foldedHeight = Math.max(COMPACT_HEIGHT, compactHeight ?? 0);

  const well = useAnimatedStyle(() => ({
    height:
      fullHeight === null
        ? undefined
        : interpolate(collapse.get(), [0, 1], [fullHeight, foldedHeight]),
  }));
  const full = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.get(), [0, 0.5], [1, 0], "clamp"),
  }));
  const compact = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.get(), [0.5, 1], [0, 1], "clamp"),
  }));

  return (
    <Animated.View
      style={[
        {
          ...materialStyle(theme, "sunken"),
          borderRadius: radius.control,
          overflow: "hidden",
        },
        well,
      ]}
    >
      <Animated.View
        style={full}
        onLayout={(event) => setFullHeight(event.nativeEvent.layout.height)}
      >
        <View style={{ padding: space.md }}>
          <StatTile
            label={tile.label}
            value={
              <AnimatedMoney
                minor={tile.amountMinor}
                currency={currency}
                locale={locale}
                compact={compactFigures}
                variant="label"
                numeric
                style={{ color: tile.color }}
              />
            }
          />
        </View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            minHeight: COMPACT_HEIGHT,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.xs,
            paddingHorizontal: space.md,
          },
          compact,
        ]}
        onLayout={(event) => setCompactHeight(event.nativeEvent.layout.height)}
        // The full layer carries the label and figure for assistive tech.
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <AppText
          variant="caption"
          muted
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {tile.label}
        </AppText>
        <AnimatedMoney
          minor={tile.amountMinor}
          currency={currency}
          locale={locale}
          compact
          variant="label"
          numeric
          style={{ color: tile.color }}
        />
      </Animated.View>
    </Animated.View>
  );
}
