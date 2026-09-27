import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import type { StatDelta } from '@/components/finance/stat-tile';
import { StatTile } from '@/components/finance/stat-tile';
import { AppText } from '@/components/ui/app-text';
import { useMaterial } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, withAlpha } from '@/theme/tokens';

export interface HeroStat {
  label: string;
  value: ReactNode;
  /** Semantic tone for the value. The label always names the stat, so tone is never the only signal. */
  tone?: 'positive' | 'negative' | 'default';
  /** A small chip under the value, e.g. "+4.2% vs last month". */
  delta?: StatDelta;
}

// RN 0.86 native takes `experimental_backgroundImage`; react-native-web 0.21
// only recognises plain `backgroundImage`. Mirrors the key selection in
// `src/theme/materials.ts` (read-only for this component) so the accent wash
// layered on top of the raised material's own gradient picks the same key —
// see that file's comment on `GRADIENT_KEY` for the full explanation.
const GRADIENT_KEY = process.env.EXPO_OS === 'web' ? 'backgroundImage' : 'experimental_backgroundImage';

/**
 * The top of a screen: one overline, one large statement figure, a row of
 * supporting stats. Unlike the sections below it, the hero is a raised
 * "statement" panel — a subtle accent wash over the same neutral material as
 * a card, so it reads as the thing everything else on the screen answers to
 * rather than one more box among equals.
 */
export function PageHero({
  overline,
  figure,
  stats,
  accessory,
  footer,
}: {
  overline: string;
  /** Usually an `AnimatedMoney` or `AppText variant="display"`. */
  figure: ReactNode;
  stats?: HeroStat[];
  /** Trailing control beside the overline, such as a `MonthSwitcher`. */
  accessory?: ReactNode;
  /** Rendered below the stats row, e.g. a `Sparkline`. */
  footer?: ReactNode;
}) {
  const theme = useQashyTheme();
  const raised = useMaterial('raised');
  const accentWash = `linear-gradient(135deg, ${withAlpha(theme.staticAccent, 0.10)}, transparent 60%)`;
  // Layers the accent wash over whatever gradient (or none, under Android's
  // Material You) `raised` already carries — later layers in a CSS
  // `background-image` list paint on top, so the wash stays the topmost tint.
  const existingGradient = (raised as Record<string, string | undefined>)[GRADIENT_KEY];
  const panelStyle: ViewStyle = {
    ...raised,
    [GRADIENT_KEY]: existingGradient ? `${accentWash}, ${existingGradient}` : accentWash,
    borderRadius: radius.sheet,
    borderCurve: 'continuous',
    padding: space.xl,
    gap: space.lg,
  };
  return (
    <View style={panelStyle}>
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
          <AppText variant="overline" muted>{overline}</AppText>
          {accessory}
        </View>
        {figure}
      </View>
      {stats && stats.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {stats.map((stat) => (
            <View key={stat.label} style={{ minWidth: 96, flex: 1 }}>
              <StatTile label={stat.label} value={stat.value} tone={stat.tone} delta={stat.delta} />
            </View>
          ))}
        </View>
      ) : null}
      {footer}
    </View>
  );
}
