import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, View, type ColorValue, type ViewProps, type ViewStyle } from 'react-native';

import { MotionPressable } from '@/components/ui/motion';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';

export type CardVariant = 'default' | 'list' | 'inset' | 'emphasized';

export interface CardProps extends ViewProps {
  /**
   * `default` — a section of the page. Raised material: gradient, top
   *   highlight, layered shadow.
   * `list` — a container for rows. Flush padding, hairlines between children,
   *   same raised material as `default`.
   * `inset` — a recessed well *inside* a section (a summary, a preview, a
   *   callout). Sunken material, so it reads as carved into the card around
   *   it rather than floating above the page.
   * `emphasized` — a section that wants to read as accented rather than
   *   neutral (a highlighted total, a call to action). Same raised shadow as
   *   `default`, but filled with the accent container tint instead of a
   *   gradient.
   */
  variant?: CardVariant;
  /** `list` only: pull the hairlines in from the start edge, past a row's icon. */
  dividerInset?: number;
  onPress?: () => void;
}

/**
 * Sections are physical tiles, not flat planes.
 *
 * Every card is now raised material: a subtle top-to-bottom gradient, a 1px
 * inner top highlight, and a soft layered shadow, so a section visibly sits
 * above the page rather than merely stepping one tone off it. `inset` cards
 * invert that — a sunken well carved *into* the surrounding card, for a
 * summary or preview that should read as quieter, not as its own section.
 * Hierarchy still comes from type as much as from material: the screen's hero
 * figure sits directly on the background, outside any card (see `PageHero`),
 * so the one thing on a page with no material at all is still the thing that
 * outranks everything with it.
 */
export function Card({
  variant = 'default',
  dividerInset = 0,
  onPress,
  style,
  children,
  ...props
}: CardProps) {
  const theme = useQashyTheme();
  const { radius, space } = theme;

  const base: ViewStyle = {
    borderRadius: variant === 'inset' ? radius.tile : radius.card,
    borderCurve: 'continuous',
    // Card edges are drawn with box-shadow, which Windows High Contrast (forced-colors) strips. A
    // transparent outline is invisible normally but is repainted in a system colour there, and
    // unlike a border it takes no layout space.
    ...(process.env.EXPO_OS === 'web'
      ? { outlineWidth: 1, outlineStyle: 'solid' as const, outlineColor: 'transparent' }
      : null),
    ...(variant === 'inset'
      ? materialStyle(theme, 'sunken')
      : variant === 'emphasized'
        // Same raised shadow as `card`, but an accent tint instead of the
        // neutral gradient — a flat tint reads as intentionally accented,
        // where a gradient over a tint would just look like a mistake.
        ? { backgroundColor: theme.accentContainer, boxShadow: theme.shadowCard }
        : materialStyle(theme, 'card')),
  };

  if (variant === 'list') {
    base.paddingVertical = space.xs;
    base.paddingHorizontal = space.lg;
    base.overflow = 'hidden';
  } else {
    base.padding = variant === 'inset' ? space.md : space.lg;
  }

  const content = variant === 'list' ? withDividers(children, theme.border, dividerInset) : children;
  const pressable = Boolean(onPress);

  if (pressable) {
    return (
      <MotionPressable
        accessibilityRole="button"
        onPress={onPress}
        pressedScale={0.985}
        style={({ pressed }) => [
          base,
          pressed ? { boxShadow: theme.shadowControlPressed } : null,
          style,
        ]}>
        {content}
      </MotionPressable>
    );
  }

  return (
    <View {...props} style={[base, style]}>
      {content}
    </View>
  );
}

function withDividers(children: ReactNode, color: ColorValue, inset: number) {
  const items = Children.toArray(children);
  if (items.length < 2) return children;
  return items.map((child, index) => (
    <Fragment key={index}>
      {index > 0 ? (
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color, marginStart: inset }} />
      ) : null}
      {child}
    </Fragment>
  ));
}
