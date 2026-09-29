import type { ReactNode } from 'react';
import { View, type ColorValue } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, withAlpha } from '@/theme/tokens';

export type StatTileTone = 'positive' | 'negative' | 'transfer' | 'default';

export interface StatDelta {
  label: string;
  tone: 'positive' | 'negative' | 'neutral';
}

/**
 * One labelled figure: a hero's supporting stat, a budget card's spent/left
 * pair. The label always renders — tone colors the value but is never the
 * only signal a stat is up, down, or a transfer.
 *
 * `positive`/`negative`/`transfer` on `ThemeTokens` are never replaced by an
 * opaque Android platform color (only `accent`/`surface`/`text`-family tokens
 * are), so they are safe to use directly and to run through `withAlpha` here.
 */
export function StatTile({
  label,
  value,
  tone = 'default',
  delta,
  icon,
  variant = 'flat',
}: {
  label: string;
  value: ReactNode | string;
  tone?: StatTileTone;
  delta?: StatDelta;
  /** An `AppIcon` name, shown in a small tinted circle beside the label. */
  icon?: string;
  /** `sunken` sets a carved-in well look; `flat` (default) renders inline with its surroundings. */
  variant?: 'flat' | 'sunken';
}) {
  const theme = useQashyTheme();
  const toneColor: ColorValue = tone === 'positive'
    ? theme.positive
    : tone === 'negative'
      ? theme.negative
      : tone === 'transfer'
        ? theme.transfer
        : theme.text;
  const deltaColor: ColorValue = delta?.tone === 'positive'
    ? theme.positive
    : delta?.tone === 'negative'
      ? theme.negative
      : theme.textMuted;
  // `theme.textMuted` can be an opaque Android platform color, so the neutral
  // delta background stays a flat token instead of running it through `withAlpha`.
  const deltaBackground = !delta
    ? undefined
    : delta.tone === 'positive'
      ? withAlpha(theme.positive as string, 0.12)
      : delta.tone === 'negative'
        ? withAlpha(theme.negative as string, 0.12)
        : theme.surfaceMuted;

  const content = (
    <View style={{ gap: space.xxs }}>
      {icon && typeof value === 'string' ? (
        // Value sits centred above the icon; a min-width box keeps it aligned to the icon's centre.
        <View style={{ minWidth: 28, alignSelf: 'flex-start', alignItems: 'center' }}>
          <AppText literal figure variant="figure" style={{ color: toneColor }}>{value}</AppText>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        {icon ? (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: withAlpha(theme.staticAccent, 0.12),
            }}>
            <AppIcon name={icon} color={theme.staticAccent} size={16} />
          </View>
        ) : null}
        <AppText variant="caption" muted numberOfLines={1}>{label}</AppText>
      </View>
      {icon && typeof value === 'string' ? null : typeof value === 'string' ? (
        <AppText literal figure variant="figure" style={{ color: toneColor }}>{value}</AppText>
      ) : value}
      {delta ? (
        <View
          style={{
            alignSelf: 'flex-start',
            borderRadius: radius.pill,
            paddingHorizontal: space.sm,
            paddingVertical: space.xxs,
            backgroundColor: deltaBackground,
          }}>
          <AppText literal variant="eyebrow" style={{ color: deltaColor }}>{delta.label}</AppText>
        </View>
      ) : null}
    </View>
  );

  if (variant === 'sunken') {
    return (
      <View style={{ ...materialStyle(theme, 'sunken'), borderRadius: radius.control, padding: space.md }}>
        {content}
      </View>
    );
  }
  return content;
}
