import { useState } from "react";
import { ScrollView, View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { IconBadge } from "@/components/ui/icon-badge";
import { MotionPressable } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";

import { hapticSelection } from "@/utils/haptics";

export interface CategoryPickerOption {
  id: string;
  /** Stored data — rendered and announced exactly as entered, like `ChoiceChip`'s `literal`. */
  name: string;
  icon: string;
  color: string;
  archived: boolean;
}

/** One tile's width; the row scrolls sideways, so tiles never need to share the screen's width. */
const TILE_WIDTH = 96;

/**
 * The category picker: one row of square tiles that scrolls sideways, so a long category list
 * costs one tile's height instead of a block of them. Keeps the `radiogroup`/`radio` semantics
 * and accessible names the chip row had — including "Uncategorized" first and the " (archived)"
 * suffix — and opens already scrolled to the selected tile.
 */
export function CategoryPicker({
  categories,
  categoryId,
  onSelect,
  label: groupLabel = "Category",
}: {
  categories: CategoryPickerOption[];
  categoryId: string;
  onSelect: (id: string) => void;
  /** The radio group's accessible name. */
  label?: string;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  const gap = space.sm;

  // `null` stands in for "Uncategorized", which always sorts first.
  const all: (CategoryPickerOption | null)[] = [null, ...categories];
  const selectedIndex = all.findIndex(
    (item) => (item ? item.id : "") === categoryId,
  );
  // Opens with the selected tile in view. Fixed at mount, so picking a tile never re-scrolls the row.
  const [initialX] = useState(() =>
    Math.max(0, selectedIndex * (TILE_WIDTH + gap) - TILE_WIDTH),
  );
  return (
    <View style={{ marginHorizontal: -space.lg }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={t(groupLabel)}
        accessibilityRole="radiogroup"
        contentContainerStyle={{ gap, paddingHorizontal: space.lg }}
        contentOffset={{ x: initialX, y: 0 }}
      >
        {all.map((item) => {
          const id = item ? item.id : "";
          const selected = categoryId === id;
          const label = item
            ? `${item.name}${item.archived ? " (archived)" : ""}`
            : "Uncategorized";
          return (
            <MotionPressable
              key={id || "uncategorized"}
              accessibilityRole="radio"
              accessibilityLabel={item ? label : t(label)}
              accessibilityState={{
                checked: selected,
                disabled: item?.archived,
              }}
              aria-checked={selected}
              disabled={item?.archived}
              onPress={() => {
                if (selected) return;
                hapticSelection();
                onSelect(id);
              }}
              pressedScale={0.97}
              style={[
                {
                  width: TILE_WIDTH,
                  minHeight: 72,
                  borderRadius: radius.tile,
                  borderCurve: "continuous",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: space.xs,
                  paddingVertical: space.sm,
                  paddingHorizontal: space.xs,
                  opacity: item?.archived ? 0.45 : 1,
                },
                selected
                  ? materialStyle(theme, "selected")
                  : materialStyle(theme, "control"),
              ]}
            >
              {selected ? (
                // The selected tile is already filled with the container color, so the glyph sits bare.
                <View
                  style={{
                    width: 36,
                    height: 36,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <AppIcon
                    name={item ? item.icon : "questionmark.circle"}
                    size={18}
                    color={theme.onAccentContainer}
                    role={item ? "category" : "ui"}
                  />
                </View>
              ) : (
                <IconBadge
                  icon={item ? item.icon : "questionmark.circle"}
                  color={item?.color}
                  role={item ? "category" : "ui"}
                  fallback={{
                    container: theme.accentContainer,
                    onContainer: theme.onAccentContainer,
                  }}
                  size={36}
                  iconSize={18}
                />
              )}
              <AppText
                selectable={false}
                literal={Boolean(item)}
                numberOfLines={2}
                variant="caption"
                style={{
                  textAlign: "center",
                  color: selected ? theme.onAccentContainer : theme.text,
                  fontWeight: selected ? "600" : "500",
                }}
              >
                {label}
              </AppText>
              {selected ? (
                <View style={{ position: "absolute", top: 6, end: 6 }}>
                  <AppIcon
                    name="checkmark"
                    size={13}
                    color={theme.onAccentContainer}
                  />
                </View>
              ) : null}
            </MotionPressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
