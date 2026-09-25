import { Children } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { typeScale } from '@/theme/tokens';
import { withAppFont } from '@/theme/typography';

export type TextVariant = keyof typeof typeScale;

// Not `as const`: TextStyle declares fontVariant as a mutable array, so a
// readonly tuple is rejected where the style is actually consumed.
const TABULAR: TextStyle['fontVariant'] = ['tabular-nums'];

/** Variants whose whole purpose is a figure, so digits are always tabular. */
const NUMERIC_VARIANTS = new Set<TextVariant>(['display', 'money']);

const variants = Object.fromEntries(
  (Object.keys(typeScale) as TextVariant[]).map((name) => {
    const { fontSize, lineHeight, weight, letterSpacing } = typeScale[name];
    const style: TextStyle = { fontSize, lineHeight, letterSpacing, fontWeight: weight === 'regular' ? '400' : weight === 'medium' ? '500' : weight === 'semibold' ? '600' : '700' };
    if (NUMERIC_VARIANTS.has(name)) style.fontVariant = TABULAR;
    return [name, style];
  }),
) as Record<TextVariant, TextStyle>;

/**
 * `literal` opts a run of text out of translation. Anything the user typed —
 * account and category names, transaction titles, notes, tag names — must set
 * it. Without it the dictionary rewrites content it happens to have a key for,
 * so an account the user deliberately named "Savings" renders as "חיסכון" in
 * Hebrew and the ledger stops matching what they entered.
 *
 * `numeric` locks the digits to a fixed advance width. Every figure that can
 * change in place — a balance that animates, a column of amounts, a countdown —
 * needs it, or the text jitters horizontally as digits swap.
 */
export function AppText({ variant = 'body', muted, numeric, style, selectable = false, literal = false, children, ...props }: TextProps & { variant?: TextVariant; muted?: boolean; numeric?: boolean; literal?: boolean }) {
  const theme = useQashyTheme();
  const { isRtl, t } = useLocalization();
  const localizedChildren = literal
    ? children
    : Children.map(children, (child) => typeof child === 'string' ? t(child) : child);
  return (
    <Text
      {...props}
      selectable={selectable}
      style={withAppFont([
        variants[variant],
        numeric ? { fontVariant: TABULAR } : null,
        { color: muted ? theme.textMuted : theme.text, writingDirection: isRtl ? 'rtl' : 'ltr', textAlign: isRtl ? 'right' : undefined },
        style,
      ])}>
      {localizedChildren}
    </Text>
  );
}
