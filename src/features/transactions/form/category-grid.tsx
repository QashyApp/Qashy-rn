import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { MotionPressable } from '@/components/ui/motion';
import { TextButton } from '@/components/ui/text-button';
import { useLocalization } from '@/localization/localization';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { toneColors } from '@/theme/tokens';
import { hapticSelection } from '@/utils/haptics';

export interface CategoryGridOption {
  id: string;
  /** Stored data — rendered and announced exactly as entered, like `ChoiceChip`'s `literal`. */
  name: string;
  icon: string;
  color: string;
  archived: boolean;
}

/** Tiles shown before folding the rest behind "Show all". */
const VISIBLE_LIMIT = 8;

/**
 * The category picker as a grid of square tiles instead of a wrapping chip
 * row, so the most-used categories read at a glance instead of as a run of
 * pills. Keeps the exact `radiogroup`/`radio` semantics and accessible names
 * the chip row had — including "Uncategorized" first and the " (archived)"
 * suffix — so nothing that targets the category picker needs to change.
 */
export function CategoryGrid({
  categories,
  categoryId,
  onSelect,
}: {
  categories: CategoryGridOption[];
  categoryId: string;
  onSelect: (id: string) => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const columns = width >= 520 ? 4 : width >= 340 ? 3 : 2;
  const gap = space.sm;
  const tileWidth = width > 0 ? (width - gap * (columns - 1)) / columns : undefined;

  // `null` stands in for "Uncategorized", which always sorts first.
  const all: (CategoryGridOption | null)[] = [null, ...categories];
  const selectedIndex = all.findIndex((item) => (item ? item.id : '') === categoryId);
  const overflowing = all.length > VISIBLE_LIMIT;
  const visible = !expanded && overflowing
    ? (() => {
      const head = all.slice(0, VISIBLE_LIMIT);
      // The selected tile must stay visible even when it would otherwise be
      // folded behind "Show all" — collapsing the grid must never look like
      // it silently cleared the user's choice.
      if (selectedIndex >= VISIBLE_LIMIT) head[VISIBLE_LIMIT - 1] = all[selectedIndex]!;
      return head;
    })()
    : all;

  return (
    <View style={{ gap: space.md }} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      <View accessibilityLabel={t('Category')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {visible.map((item) => {
          const id = item ? item.id : '';
          const selected = categoryId === id;
          const label = item ? `${item.name}${item.archived ? ' (archived)' : ''}` : 'Uncategorized';
          const tile = item
            ? toneColors(item.color, theme.staticSurface, theme.staticText, theme.mode === 'dark', theme.charts.tone)
            : { container: theme.accentContainer, onContainer: theme.onAccentContainer };
          return (
            <MotionPressable
              key={id || 'uncategorized'}
              accessibilityRole="radio"
              accessibilityLabel={item ? label : t(label)}
              accessibilityState={{ checked: selected, disabled: item?.archived }}
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
                  width: tileWidth,
                  flexGrow: tileWidth ? 0 : 1,
                  minWidth: 80,
                  minHeight: 72,
                  borderRadius: radius.tile,
                  borderCurve: 'continuous',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: space.xs,
                  paddingVertical: space.sm,
                  paddingHorizontal: space.xs,
                  opacity: item?.archived ? 0.45 : 1,
                },
                selected
                  ? materialStyle(theme, 'selected')
                  : materialStyle(theme, 'control'),
              ]}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: radius.tile,
                  borderCurve: 'continuous',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? 'transparent' : tile.container,
                }}>
                <AppIcon name={item ? item.icon : 'questionmark.circle'} size={18} color={selected ? theme.onAccentContainer : tile.onContainer} />
              </View>
              <AppText
                selectable={false}
                literal={Boolean(item)}
                numberOfLines={2}
                variant="caption"
                style={{ textAlign: 'center', color: selected ? theme.onAccentContainer : theme.text, fontWeight: selected ? '600' : '500' }}>
                {label}
              </AppText>
              {selected ? (
                <View style={{ position: 'absolute', top: 6, end: 6 }}>
                  <AppIcon name="checkmark" size={13} color={theme.onAccentContainer} />
                </View>
              ) : null}
            </MotionPressable>
          );
        })}
      </View>
      {overflowing && !expanded ? (
        <TextButton title="Show all" tone="muted" onPress={() => setExpanded(true)} style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </View>
  );
}
