import { View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { defaultCategoryPreview } from '@/domain/defaults';
import { StepHeading } from '@/features/onboarding/onboarding-shell';
import type { OnboardingDraft } from '@/features/onboarding/use-onboarding-flow';
import { currencyLabel } from '@/features/onboarding/steps/currency-step';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, toneColors } from '@/theme/tokens';
import { formatMoney, parseMoney } from '@/utils/money';

/**
 * A last look before anything is written. It also introduces the one thing
 * setup creates without asking — the starter categories — so they are not a
 * surprise the first time a transaction wants one.
 */
export function ReadyStep({ draft }: { draft: OnboardingDraft }) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  let balance = draft.openingBalance.trim() || '0';
  try {
    balance = formatMoney(draft.openingBalance.trim() ? parseMoney(draft.openingBalance, draft.currency, draft.locale) : 0, draft.currency, draft.locale);
  } catch {
    // Unreachable past validation; the raw text is a fine fallback.
  }
  const categories = defaultCategoryPreview(draft.locale);
  const rows: [string, string][] = [
    ['Currency', `${currencyLabel(draft.currency, draft.locale)} (${draft.currency})`],
    ['Account', draft.accountName.trim()],
    ['Opening balance', balance],
  ];

  return (
    <View style={{ gap: space.xxl }}>
      <StepHeading title="You’re all set" body="Here’s what Qashy will create. Nothing leaves this device." />
      <Card variant="list">
        {rows.map(([label, value]) => (
          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, minHeight: 52 }}>
            <AppText muted>{label}</AppText>
            <AppText literal variant="label" numeric numberOfLines={1} style={{ flexShrink: 1 }}>{value}</AppText>
          </View>
        ))}
      </Card>
      <View style={{ gap: space.md }}>
        <View style={{ gap: space.xxs }}>
          <AppText variant="headline">Starter categories</AppText>
          <AppText variant="caption" muted>Rename, recolor or remove them any time in More → Categories.</AppText>
        </View>
        <View accessibilityRole="list" accessibilityLabel={t('Starter categories')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {categories.map((category) => {
            const tone = toneColors(category.color, theme.staticSurface, theme.staticText, theme.mode === 'dark');
            return (
              <View
                key={category.name}
                accessibilityRole="text"
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingStart: space.xs, paddingEnd: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: theme.surface }}>
                <View style={{ width: 26, height: 26, borderRadius: radius.pill, backgroundColor: tone.container, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name={category.icon} color={tone.onContainer} size={14} />
                </View>
                <AppText literal variant="caption" style={{ fontWeight: '500' }}>{category.name}</AppText>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}
