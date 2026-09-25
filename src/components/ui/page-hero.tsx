import type { ReactNode } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useQashyTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';

export interface HeroStat {
  label: string;
  value: ReactNode;
  /** Semantic tone for the value. The label always names the stat, so tone is never the only signal. */
  tone?: 'positive' | 'negative' | 'default';
}

/**
 * The top of a screen: one overline, one large figure, a row of supporting
 * stats. It sits directly on the page background rather than in a card — it is
 * the thing every other section on the screen is subordinate to, and putting
 * it in the same kind of box as those sections is what made them all read as
 * equals.
 */
export function PageHero({
  overline,
  figure,
  stats,
  accessory,
}: {
  overline: string;
  /** Usually an `AnimatedMoney` or `AppText variant="display"`. */
  figure: ReactNode;
  stats?: HeroStat[];
  /** Trailing control beside the overline, such as a `MonthSwitcher`. */
  accessory?: ReactNode;
}) {
  const theme = useQashyTheme();
  return (
    <View style={{ gap: space.lg, paddingVertical: space.sm }}>
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
          <AppText variant="overline" muted>{overline}</AppText>
          {accessory}
        </View>
        {figure}
      </View>
      {stats && stats.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xxl, rowGap: space.md }}>
          {stats.map((stat) => (
            <View key={stat.label} style={{ gap: space.xxs, minWidth: 88 }}>
              <AppText variant="caption" muted>{stat.label}</AppText>
              {typeof stat.value === 'string' ? (
                <AppText
                  literal
                  numeric
                  variant="headline"
                  style={stat.tone === 'positive' ? { color: theme.positive } : stat.tone === 'negative' ? { color: theme.negative } : undefined}>
                  {stat.value}
                </AppText>
              ) : stat.value}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
