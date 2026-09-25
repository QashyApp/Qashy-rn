import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import { MotionPressable, MotionView } from '@/components/ui/motion';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { monthKey, monthLabel, moveMonth, parseLocalDate, startOfMonth } from '@/utils/date';
import { hapticSelection } from '@/utils/haptics';

export type MonthDirection = 'left' | 'right';

/**
 * Steps through calendar months. `value` is always the first day of a month
 * (`YYYY-MM-01`); `onChange` receives the new first day plus the direction the
 * content should slide, so screens can animate their month-scoped content the
 * same way the label moves.
 *
 * The label itself is a button: it opens a year/month grid for jumping further
 * than one step at a time.
 */
export function MonthSwitcher({
  value,
  onChange,
  max,
  direction = 'right',
  disabled = false,
}: {
  value: string;
  onChange: (month: string, direction: MonthDirection) => void;
  /** First day of the latest selectable month. Omit to allow any future month. */
  max?: string;
  direction?: MonthDirection;
  disabled?: boolean;
}) {
  const theme = useQashyTheme();
  const { locale, isRtl, t } = useLocalization();
  const [pickerOpen, setPickerOpen] = useState(false);
  const atMax = max != null && value >= max;

  const step = (delta: number) => {
    hapticSelection();
    onChange(moveMonth(value, delta), delta > 0 ? 'right' : 'left');
  };

  // Chevrons point along the reading direction: "previous" is always toward the
  // start edge, which is the right edge in Hebrew.
  const backIcon = isRtl ? 'chevron.right' : 'chevron.left';
  const forwardIcon = isRtl ? 'chevron.left' : 'chevron.right';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xxs,
        backgroundColor: theme.surface,
        borderRadius: radius.pill,
        padding: space.xxs,
        opacity: disabled ? 0.45 : 1,
      }}>
      <IconButton label="Previous month" icon={backIcon} iconSize={16} disabled={disabled} onPress={() => step(-1)} />
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`${monthLabel(value, locale)}. ${t('Choose month')}`}
        disabled={disabled}
        onPress={() => setPickerOpen(true)}
        pressedScale={0.97}
        style={{ minHeight: 44, minWidth: 128, justifyContent: 'center', paddingHorizontal: space.sm, borderRadius: radius.pill }}>
        <MotionView key={value} variant={direction} duration={180}>
          <AppText literal variant="label" numeric style={{ textAlign: 'center' }}>{monthLabel(value, locale)}</AppText>
        </MotionView>
      </MotionPressable>
      <IconButton label="Next month" icon={forwardIcon} iconSize={16} disabled={disabled || atMax} onPress={() => step(1)} />
      <MonthPicker
        open={pickerOpen}
        value={value}
        max={max}
        onClose={() => setPickerOpen(false)}
        onSelect={(month) => {
          setPickerOpen(false);
          if (month !== value) {
            hapticSelection();
            onChange(month, month > value ? 'right' : 'left');
          }
        }}
      />
    </View>
  );
}

function MonthPicker({
  open,
  value,
  max,
  onClose,
  onSelect,
}: {
  open: boolean;
  value: string;
  max?: string;
  onClose: () => void;
  onSelect: (month: string) => void;
}) {
  const theme = useQashyTheme();
  const { locale, isRtl } = useLocalization();
  const [year, setYear] = useState(() => parseLocalDate(value).getFullYear());
  const current = monthKey(value);
  const thisMonth = monthKey(startOfMonth());
  const shortMonth = new Intl.DateTimeFormat(locale, { month: 'short' });
  const maxYear = max ? parseLocalDate(max).getFullYear() : undefined;

  return (
    <Modal
      transparent
      visible={open}
      animationType="fade"
      onShow={() => setYear(parseLocalDate(value).getFullYear())}
      onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ position: 'absolute', inset: 0, backgroundColor: theme.scrim }} />
        <MotionView
          variant="zoom"
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 360,
            gap: space.lg,
            padding: space.lg,
            borderRadius: radius.sheet,
            borderCurve: 'continuous',
            backgroundColor: theme.surfaceElevated,
            boxShadow: theme.shadowOverlay,
            direction: isRtl ? 'rtl' : 'ltr',
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <IconButton label="Previous year" icon={isRtl ? 'chevron.right' : 'chevron.left'} iconSize={16} onPress={() => setYear((y) => y - 1)} />
            <AppText literal variant="headline" numeric accessibilityRole="header">{String(year)}</AppText>
            <IconButton
              label="Next year"
              icon={isRtl ? 'chevron.left' : 'chevron.right'}
              iconSize={16}
              disabled={maxYear != null && year >= maxYear}
              onPress={() => setYear((y) => y + 1)}
            />
          </View>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm }}>
            {Array.from({ length: 12 }, (_, index) => {
              const key = `${year}-${String(index + 1).padStart(2, '0')}`;
              const first = `${key}-01`;
              const selected = key === current;
              const blocked = max != null && first > max;
              const label = shortMonth.format(new Date(year, index, 15));
              return (
                <View key={key} style={{ width: '33.333%', paddingHorizontal: space.xs }}>
                  <MotionPressable
                    accessibilityRole="radio"
                    accessibilityLabel={monthLabel(first, locale)}
                    accessibilityState={{ checked: selected, disabled: blocked }}
                    aria-checked={selected}
                    disabled={blocked}
                    onPress={() => onSelect(first)}
                    pressedScale={0.95}
                    style={{
                      minHeight: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius.pill,
                      backgroundColor: selected ? theme.accent : 'transparent',
                      borderWidth: 1,
                      borderColor: key === thisMonth && !selected ? theme.border : 'transparent',
                      opacity: blocked ? 0.35 : 1,
                    }}>
                    <AppText literal variant="label" style={{ color: selected ? theme.onAccent : theme.text }}>{label}</AppText>
                  </MotionPressable>
                </View>
              );
            })}
          </View>
        </MotionView>
      </View>
    </Modal>
  );
}
