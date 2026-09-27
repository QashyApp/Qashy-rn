import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MotionPressable } from '@/components/ui/motion';
import { PageHeading } from '@/components/ui/page-heading';
import { ScreenContainer } from '@/components/ui/screen-container';
import { TextButton } from '@/components/ui/text-button';
import { availableToAdd } from '@/features/overview/layout/overview-layout';
import { useOverviewLayout } from '@/features/overview/layout/use-overview-layout';
import { WIDGET_REGISTRY } from '@/features/overview/widgets/registry';
import { useLocalization } from '@/localization/localization';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, tile as tileMetrics, toneColors } from '@/theme/tokens';
import { confirmDestructive, errorMessage, showError } from '@/utils/confirm';
import { makeId } from '@/utils/entity';
import { hapticSelection } from '@/utils/haptics';

/**
 * Presented as a form sheet, registered as `overview-cards` in `_layout.tsx` alongside
 * `/budget` and `/goal`. Adding or resetting the layout returns to `/overview` so the section
 * re-reads the repository projection with fresh data.
 */
export function CardGalleryScreen() {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const { layout, dispatch } = useOverviewLayout();
  const available = availableToAdd(layout);

  const addCard = async (type: (typeof available)[number]) => {
    hapticSelection();
    try {
      await dispatch({ type: 'add', card: { id: makeId(), type } });
      router.replace('/overview');
    } catch (reason) {
      showError('Couldn’t add this card', errorMessage(reason, 'Try again.'));
    }
  };

  const resetLayout = async () => {
    const confirmed = await confirmDestructive({
      title: 'Reset to default layout?',
      message: 'Your overview will go back to its original set of cards, order, and sizes.',
      confirmLabel: 'Reset',
    });
    if (!confirmed) return;
    try {
      await dispatch({ type: 'reset' });
      router.replace('/overview');
    } catch (reason) {
      showError('Couldn’t reset your overview', errorMessage(reason, 'Try again.'));
    }
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenContainer>
        <PageHeading title="Add cards" subtitle="Choose what shows up on your overview." />
        {available.length ? (
          <Card variant="list" dividerInset={tileMetrics.size + space.md}>
            {available.map((type) => {
              const definition = WIDGET_REGISTRY[type];
              const tile = toneColors(theme.staticAccent, theme.staticSurface, theme.staticText, theme.mode === 'dark');
              return (
                <MotionPressable
                  key={type}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${t(definition.title)} card`}
                  onPress={() => addCard(type)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.sm }}>
                  <View style={{ width: tileMetrics.size, height: tileMetrics.size, borderRadius: radius.tile, borderCurve: 'continuous', backgroundColor: tile.container, alignItems: 'center', justifyContent: 'center' }}>
                    <AppIcon name={definition.icon} color={tile.onContainer} size={tileMetrics.icon} />
                  </View>
                  <View style={{ flex: 1, gap: space.xxs }}>
                    <AppText variant="label">{definition.title}</AppText>
                    <AppText variant="caption" muted>{definition.description}</AppText>
                  </View>
                  <AppIcon name="plus" color={theme.accent as string} size={20} />
                </MotionPressable>
              );
            })}
          </Card>
        ) : (
          <Card>
            <EmptyState compact icon="checkmark.circle" title="Every card is already on your overview" body="Remove a card first to add it back, or add another instance where more than one is allowed." />
          </Card>
        )}
        <TextButton title="Reset to default layout" tone="muted" onPress={resetLayout} />
      </ScreenContainer>
    </ScrollView>
  );
}

export function AddCardWell({ onPress }: { onPress: () => void }) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={t('Add card')}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      style={[
        {
          borderRadius: radius.card,
          borderCurve: 'continuous',
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: theme.border,
          minHeight: 88,
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.xs,
        },
        materialStyle(theme, 'sunken'),
      ]}>
      <AppIcon name="plus" color={theme.textMuted as string} size={22} />
      <AppText variant="label" muted>Add card</AppText>
    </MotionPressable>
  );
}
