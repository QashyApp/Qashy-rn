import { useRef } from 'react';
import { TextInput, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { FormField } from '@/components/ui/form-field';
import { MotionPressable } from '@/components/ui/motion';
import type { AccountType } from '@/domain/models';
import { StepHeading } from '@/features/onboarding/onboarding-shell';
import type { OnboardingDraft } from '@/features/onboarding/use-onboarding-flow';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, tile } from '@/theme/tokens';
import { hapticSelection } from '@/utils/haptics';

const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: 'checking', label: 'Bank', icon: 'building.columns' },
  { value: 'cash', label: 'Cash', icon: 'banknote' },
  { value: 'savings', label: 'Savings', icon: 'leaf' },
  { value: 'credit', label: 'Credit card', icon: 'creditcard' },
  { value: 'wallet', label: 'Wallet', icon: 'wallet' },
];

export function AccountStep({
  draft,
  errors,
  onChange,
  onSubmit,
}: {
  draft: OnboardingDraft;
  errors: { accountName?: string; openingBalance?: string };
  onChange: (patch: Partial<OnboardingDraft>) => void;
  onSubmit: () => void;
}) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const balanceRef = useRef<TextInput>(null);

  return (
    <View style={{ gap: space.xxl }}>
      <StepHeading
        title="Your first account"
        body="Where most of your everyday money lives. You can add the rest any time."
      />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('Account type')}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {ACCOUNT_TYPES.map((item) => {
          const selected = draft.accountType === item.value;
          return (
            <MotionPressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityLabel={t(item.label)}
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              active={selected}
              onPress={() => {
                hapticSelection();
                onChange({ accountType: item.value });
              }}
              pressedScale={0.96}
              style={{
                flexGrow: 1,
                flexBasis: 96,
                minHeight: 84,
                alignItems: 'center',
                justifyContent: 'center',
                gap: space.xs,
                padding: space.sm,
                borderRadius: radius.card,
                borderCurve: 'continuous',
                borderWidth: 1.5,
                borderColor: selected ? theme.accent : 'transparent',
                backgroundColor: selected ? theme.accentContainer : theme.surface,
              }}>
              <AppIcon name={item.icon} color={selected ? theme.onAccentContainer : theme.textMuted} size={tile.icon + 2} />
              <AppText variant="caption" numberOfLines={1} style={{ color: selected ? theme.onAccentContainer : theme.text, fontWeight: '500' }}>{item.label}</AppText>
            </MotionPressable>
          );
        })}
      </View>
      <View style={{ gap: space.lg }}>
        <FormField
          label="Account name"
          value={draft.accountName}
          onChangeText={(accountName) => onChange({ accountName })}
          placeholder="Everyday"
          error={errors.accountName}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => balanceRef.current?.focus()}
        />
        <FormField
          ref={balanceRef}
          label={`Opening balance (${draft.currency})`}
          value={draft.openingBalance}
          onChangeText={(openingBalance) => onChange({ openingBalance })}
          keyboardType="decimal-pad"
          placeholder="0"
          hint="What’s in it today. Leave empty to start from zero."
          error={errors.openingBalance}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          style={{ fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] }}
        />
      </View>
    </View>
  );
}
