import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, View, type ColorValue, type ViewProps, type ViewStyle } from 'react-native';

import { useQashyTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';

export type CardVariant = 'default' | 'list' | 'inset';

export interface CardProps extends ViewProps {
  /**
   * `default` — a section of the page. A surface fill, nothing else.
   * `list` — a container for rows. Flush padding, hairlines between children.
   * `inset` — a quieter well *inside* a section (a summary, a preview, a
   *   callout). Muted fill, so it never competes with the section around it.
   */
  variant?: CardVariant;
  /** `list` only: pull the hairlines in from the start edge, past a row's icon. */
  dividerInset?: number;
}

/**
 * Sections are planes, not boxes.
 *
 * Every card used to carry a surface, a hairline border *and* a shadow, and
 * Overview stacked seven of them at equal weight, so nothing on the page
 * outranked anything else. A card is now only a tonal step off the page: no
 * border, no resting shadow. Hierarchy comes from type and from what sits
 * directly on the background — the screen's hero figure is not in a card at
 * all (see `PageHero`). Shadows are reserved for things that genuinely float:
 * sheets, menus, the floating action button.
 */
export function Card({ variant = 'default', dividerInset = 0, style, children, ...props }: CardProps) {
  const theme = useQashyTheme();

  const base: ViewStyle = {
    backgroundColor: variant === 'inset' ? theme.surfaceMuted : theme.surface,
    borderRadius: variant === 'inset' ? radius.tile : radius.card,
    borderCurve: 'continuous',
  };

  if (variant === 'list') {
    base.paddingVertical = space.xs;
    base.paddingHorizontal = space.lg;
    base.overflow = 'hidden';
  } else {
    base.padding = variant === 'inset' ? space.md : space.lg;
  }

  return (
    <View {...props} style={[base, style]}>
      {variant === 'list' ? withDividers(children, theme.border, dividerInset) : children}
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
