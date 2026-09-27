import { useMemo } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { ChoiceListField, type ChoiceListOption } from '@/components/ui/choice-list-field';
import { MotionPressable, MotionView } from '@/components/ui/motion';
import { StepHeading } from '@/features/onboarding/onboarding-shell';
import { useLocalization } from '@/localization/localization';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { hapticSelection } from '@/utils/haptics';
import { formatMoney, parseMoney, SUPPORTED_CURRENCY_CODES } from '@/utils/money';

const FEATURED_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'];

/** A sample amount, in major units, used to show how figures will look. */
const SAMPLE_AMOUNT = '1234';

export function currencyLabel(currency: string, locale: string) {
  try {
    const name = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'name',
    }).formatToParts(1).find((part) => part.type === 'currency')?.value;
    return name ? name[0].toLocaleUpperCase() + name.slice(1) : currency;
  } catch {
    return currency;
  }
}

/**
 * The base currency. It is the one setup choice that can never be changed
 * afterwards, so the step says so, and shows a real amount formatted the way
 * the app will format it rather than asking the user to imagine it.
 *
 * The four most likely currencies are one tap away; the full list is still
 * there, searchable, for everyone else.
 */
export function CurrencyStep({ currency, locale, onCurrency }: { currency: string; locale: string; onCurrency: (currency: string) => void }) {
  const { t } = useLocalization();
  // The device's own currency joins the quick picks when it is not already one.
  const quick = useMemo(
    () => (FEATURED_CURRENCIES.includes(currency) ? FEATURED_CURRENCIES : [currency, ...FEATURED_CURRENCIES.slice(0, 3)]),
    // Deliberately only the initial currency: picking from the full list must
    // not reshuffle the chips under the user's finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const options = useMemo(() => {
    const toOption = (code: string): ChoiceListOption => ({ value: code, label: currencyLabel(code, locale), description: code });
    return [...SUPPORTED_CURRENCY_CODES]
      .map(toOption)
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [locale]);

  let sample = currency;
  try {
    sample = formatMoney(parseMoney(SAMPLE_AMOUNT, currency, 'en-US'), currency, locale);
  } catch {
    // An unsupported code simply shows as itself until a valid one is picked.
  }

  return (
    <View style={{ gap: space.xxl }}>
      <StepHeading
        title="Your main currency"
        body="Totals, budgets and goals are counted in it. It can’t be changed later, so choose the one you live in."
      />
      <Card variant="inset" style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.xxl }}>
        <MotionView key={currency} variant="zoom" style={{ alignItems: 'center', gap: space.xs }}>
          <AppText literal variant="display" numeric>{sample}</AppText>
          <AppText literal variant="caption" muted>{`${currencyLabel(currency, locale)} · ${currency}`}</AppText>
        </MotionView>
      </Card>
      <View style={{ gap: space.md }}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('Common currencies')} style={{ flexDirection: 'row', gap: space.sm }}>
          {quick.map((code) => (
            // Equal columns, so the four quick picks read as one row of options
            // rather than wrapping raggedly on a phone.
            <View key={code} style={{ flex: 1 }}>
              <CurrencyTile code={code} name={currencyLabel(code, locale)} selected={currency === code} onPress={() => onCurrency(code)} />
            </View>
          ))}
        </View>
        <ChoiceListField
          label="Base currency"
          value={currency}
          options={options}
          onChange={onCurrency}
          searchable
          // Currency names come from Intl for the chosen locale and the
          // descriptions are ISO codes; neither belongs in the dictionary.
          literalOptions
          searchPlaceholder="Search by currency name or code"
        />
      </View>
    </View>
  );
}

/**
 * A quick-pick currency as a raised tactile tile: the code set large in the
 * numeric display face, the currency's name beneath it. Selection reads as
 * physically pressed in — a sunken fill instead of a raised one — the same
 * language `ChoiceChip` uses, just roomier since there are only ever four.
 */
function CurrencyTile({ code, name, selected, onPress }: { code: string; name: string; selected: boolean; onPress: () => void }) {
  const theme = useQashyTheme();
  return (
    <MotionPressable
      accessibilityRole="radio"
      accessibilityLabel={code}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      active={selected}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      pressedScale={0.96}
      style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.xxs,
          paddingVertical: space.md,
          borderRadius: radius.tile,
          borderCurve: 'continuous',
        },
        selected
          ? { backgroundColor: theme.accentContainer, boxShadow: theme.shadowControlPressed }
          : materialStyle(theme, 'control'),
      ]}>
      <AppText literal figure variant="label" style={{ fontWeight: '700', color: selected ? theme.onAccentContainer : theme.text }}>{code}</AppText>
      <AppText literal variant="caption" numberOfLines={1} style={{ fontSize: 11, color: selected ? theme.onAccentContainer : theme.textMuted }}>{name}</AppText>
    </MotionPressable>
  );
}
