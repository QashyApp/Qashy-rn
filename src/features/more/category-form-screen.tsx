import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useFormSheet } from '@/components/navigation/use-form-sheet';
import { ActionButton } from '@/components/ui/action-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { ColorSwatch } from '@/components/ui/color-swatch';
import { FormField } from '@/components/ui/form-field';
import { FormScreen } from '@/components/ui/form-screen';
import type { CategoryKind } from '@/domain/models';
import { useLocalization } from '@/localization/localization';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { useQashyTheme } from '@/theme/theme';
import { confirmDestructive, errorMessage, showError } from '@/utils/confirm';
import { hapticSuccess } from '@/utils/haptics';
import { CATEGORY_PALETTE, radius, space, toneColors } from '@/theme/tokens';

const COLORS = CATEGORY_PALETTE;
const ICONS = {
  expense: [
    ['cart', 'Groceries'],
    ['fork.knife', 'Dining'],
    ['car', 'Transport'],
    ['house', 'Home'],
    ['heart', 'Health'],
    ['sparkles', 'Fun'],
    ['bag', 'Shopping'],
    ['bus', 'Transit'],
    ['airplane', 'Travel'],
    ['gift', 'Gifts'],
    ['graduationcap', 'Education'],
    ['gamecontroller', 'Games'],
    ['pawprint', 'Pets'],
    ['bolt', 'Utilities'],
    ['tshirt', 'Clothing'],
  ],
  income: [
    ['banknote', 'Pay'],
    ['plus.circle', 'Other income'],
    ['briefcase', 'Business'],
    ['gift', 'Gift'],
    ['chart.line.uptrend.xyaxis', 'Investments'],
    ['creditcard', 'Refund'],
  ],
} as const;

export function CategoryFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const existing = id ? state.categories.find((item) => item.id === id) : undefined;
  const [expectedRevision] = useState(existing?.revision);
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(existing?.kind ?? 'expense');
  const [color, setColor] = useState<string>(existing?.color ?? COLORS[0]);
  const [icon, setIcon] = useState(existing?.icon ?? ICONS[existing?.kind ?? 'expense'][0][0]);
  const [parentId, setParentId] = useState(existing?.parentId ?? '');
  const [busy, setBusy] = useState(false);
  const { closeToOwner } = useFormSheet({
    ownerRoute: '/more',
    values: { name, kind, color, icon, parentId },
  });
  // Mirrors the repository rule that a referenced category cannot change kind,
  // matching the account form's locked-currency treatment.
  const kindLocked = !!existing && (
    state.transactions.some((item) => item.categoryId === existing.id) ||
    state.recurringRules.some((item) => item.template.categoryId === existing.id) ||
    state.budgets.some((item) => item.filters.categoryIds.includes(existing.id)) ||
    state.goals.some((item) => item.linkedCategoryId === existing.id) ||
    state.categories.some((item) => item.parentId === existing.id)
  );
  const parentChoices = state.categories.filter((item) =>
    (!item.archived || item.id === parentId) &&
    item.kind === kind &&
    !item.parentId &&
    item.id !== existing?.id,
  );
  const hasChildren = !!existing && state.categories.some((item) => item.parentId === existing.id);
  const selectedParentId = parentChoices.some((item) => item.id === parentId) ? parentId : '';
  const trimmedName = name.trim();
  const duplicate = state.categories.some((item) =>
    item.id !== existing?.id &&
    !item.archived &&
    item.kind === kind &&
    (item.parentId ?? '') === selectedParentId &&
    item.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase());
  const nameError = !trimmedName
    ? 'Category name is required.'
    : duplicate ? 'A category with this name already exists.' : undefined;

  const save = async () => {
    if (busy || nameError) return;
    setBusy(true);
    try {
      await repository.saveCategory({ name: name.trim(), kind, color, icon, parentId: selectedParentId || null, archived: false }, existing?.id, expectedRevision);
      hapticSuccess();
      closeToOwner();
    } catch (reason) {
      showError('Couldn’t save category', errorMessage(reason, 'Check the form and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!existing || busy) return;
    if (!(await confirmDestructive({ title: `Archive ${existing.name}?`, message: 'The category is hidden from lists and pickers. You can restore it from the Archived section in More.', confirmLabel: 'Archive' }))) return;
    setBusy(true);
    try {
      await repository.saveCategory({ ...existing, archived: true }, existing.id, expectedRevision);
      closeToOwner();
    } catch (reason) {
      showError('Couldn’t archive category', errorMessage(reason, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (id && !existing) return <Redirect href="/more" />;

  const preview = toneColors(color, theme.staticSurface, theme.staticText, theme.mode === 'dark');

  return (
    <FormScreen contentContainerStyle={{ gap: 16 }}>
      {/* Updates live as icon/color change below, the same tinted-tile derivation the category
          appears with everywhere else (More's category list, transaction rows, chips). */}
      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.sm }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: radius.card,
            borderCurve: 'continuous',
            backgroundColor: preview.container,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: theme.shadowRaised,
          }}>
          <AppIcon name={icon} color={preview.onContainer} size={32} />
        </View>
        {name.trim() ? <AppText literal variant="headline" numberOfLines={1}>{name}</AppText> : null}
      </View>
      <Card style={{ gap: 16 }}>
        <FormField label="Category name" value={name} onChangeText={setName} autoFocus={!existing} error={name.length > 0 ? nameError : undefined} />
        <View accessibilityLabel={t('Category kind')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>{(['expense', 'income'] as CategoryKind[]).map((item) => <View key={item} style={{ flex: 1 }}><ChoiceChip icon={item === "income" ? "arrow.down" : item === "expense" ? "arrow.up" : "arrow.left.arrow.right"} label={item[0].toUpperCase() + item.slice(1)} selected={kind === item} disabled={kindLocked && kind !== item} onPress={() => {
          if (item === kind) return;
          setKind(item);
          setParentId('');
          setIcon(ICONS[item][0][0]);
        }} /></View>)}</View>
        {kindLocked ? <AppText variant="caption" muted>Kind is locked because transactions, budgets, goals, or schedules reference this category.</AppText> : null}
        <AppText variant="label">Icon</AppText>
        <View accessibilityLabel={t('Category icon')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {ICONS[kind].map(([value, label]) => <ChoiceChip key={value} label={label} icon={value} selected={icon === value} onPress={() => setIcon(value)} />)}
        </View>
        <AppText variant="label">Color</AppText>
        <View accessibilityLabel={t('Category color')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>{COLORS.map((item) => <ColorSwatch key={item} color={item} selected={color === item} label={`Use ${item} category color`} onPress={() => setColor(item)} />)}</View>
        <AppText variant="label">Parent category</AppText>
        <View accessibilityLabel={t('Parent category')} accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><ChoiceChip icon="xmark.circle" label="None" selected={!selectedParentId} onPress={() => setParentId('')} />{parentChoices.map((item) => <ChoiceChip key={item.id} literal icon={item.icon} label={`${item.name}${item.archived ? ' (archived)' : ''}`} disabled={item.archived || hasChildren} selected={selectedParentId === item.id} onPress={() => setParentId(item.id)} />)}</View>
        {hasChildren ? <AppText variant="caption" muted>A category with child categories must stay at the top level.</AppText> : null}
      </Card>
      <ActionButton title={busy ? 'Saving…' : existing ? 'Save category' : 'Create category'} icon="checkmark" size="large" onPress={save} disabled={busy || Boolean(nameError)} busy={busy} />
      {existing ? <ActionButton title="Archive category" variant="danger" onPress={archive} disabled={busy} /> : null}
    </FormScreen>
  );
}
