import { View, type ColorValue } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { resolveIconRender } from "@/theme/icon-sets";
import { useQashyTheme, type ThemeTokens } from "@/theme/theme";
import { readableTextColor, toneColors } from "@/theme/tokens";
import { parseIconId } from "@/utils/icon-id";

export interface BadgeColors {
  container: ColorValue;
  onContainer: ColorValue;
}

/** True when the glyph carries its own colors (emoji, Fluent Emoji) and so must not sit on a solid fill of the entity color. */
export function isMultiColorIcon(name: string, setId: string): boolean {
  const kind = resolveIconRender(parseIconId(name), setId).kind;
  return kind === "emoji" || kind === "color-svg";
}

/**
 * The container and glyph colors of an entity badge for the theme's badge style.
 *
 * `tinted`: the entity color mixed toward the surface, glyph in the entity color (classic).
 * `filled`: a solid entity color with a readable glyph. A multicolor glyph keeps the tinted
 * container instead, so its own colors stay legible rather than sitting on a same-color fill.
 * `none`: no container; the glyph is the entity color, nudged to stay readable on the surface.
 *
 * `seed` must be real hex. Without one (an uncategorised row, a plain settings row) the caller
 * `fallback` pair is used for the tinted container and `fallbackFilled` for the filled one.
 */
export function badgeColors(
  theme: ThemeTokens,
  seed: string | undefined,
  options: {
    multiColor?: boolean;
    fallback: BadgeColors;
    fallbackFilled?: BadgeColors;
  },
): BadgeColors {
  const { style } = theme.iconBadge;
  const dark = theme.mode === "dark";
  const tinted = (): BadgeColors =>
    seed
      ? toneColors(
          seed,
          theme.staticSurface,
          theme.staticText,
          dark,
          theme.charts.tone,
        )
      : options.fallback;
  if (style === "tinted" || options.multiColor) return tinted();
  if (style === "filled") {
    if (!seed)
      return (
        options.fallbackFilled ?? {
          container: theme.accent,
          onContainer: theme.onAccent,
        }
      );
    return { container: seed, onContainer: readableTextColor(seed) };
  }
  // none
  return { container: "transparent", onContainer: tinted().onContainer };
}

const HIGHLIGHT_LIGHT = "inset 0 1px 0 rgba(255,255,255,0.35)";
const HIGHLIGHT_DARK = "inset 0 1px 0 rgba(255,255,255,0.06)";

/**
 * The square or round tile behind an entity icon (category, account, goal), drawn from the
 * theme icons.badge and icons.badgeShape. Every list row and widget uses this one component so
 * a theme restyles all of them at once.
 */
export function IconBadge({
  icon,
  color,
  fallback,
  fallbackFilled,
  size,
  iconSize,
  role = "category",
  raised = false,
}: {
  /** The stored icon id. */
  icon: string;
  /** The entity color (hex). */
  color?: string;
  /** Tinted-badge colors when the entity has no color. */
  fallback: BadgeColors;
  fallbackFilled?: BadgeColors;
  size?: number;
  iconSize?: number;
  /** "category" for an entity icon, "ui" for a settings-style glyph. */
  role?: "ui" | "category";
  /** Add the small top highlight a raised tile carries (only on themes with elevated cards). */
  raised?: boolean;
}) {
  const theme = useQashyTheme();
  const { shape, style } = theme.iconBadge;
  const setId = role === "category" ? theme.categoryIconSet : theme.iconSet;
  const multiColor = isMultiColorIcon(icon, setId);
  const colors = badgeColors(theme, color, {
    multiColor,
    fallback,
    fallbackFilled,
  });
  const tileSize = size ?? theme.tile.size;
  const hasContainer = style !== "none" || multiColor;
  const highlight =
    raised &&
    hasContainer &&
    style === "tinted" &&
    theme.cardStyle === "elevated";
  return (
    <View
      style={{
        width: tileSize,
        height: tileSize,
        borderRadius: shape === "circle" ? tileSize / 2 : theme.radius.tile,
        borderCurve: "continuous",
        backgroundColor: hasContainer ? colors.container : "transparent",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: highlight
          ? theme.mode === "dark"
            ? HIGHLIGHT_DARK
            : HIGHLIGHT_LIGHT
          : undefined,
      }}
    >
      <AppIcon
        name={icon}
        color={colors.onContainer}
        size={iconSize ?? theme.tile.icon}
        role={role}
      />
    </View>
  );
}
