import { useState } from 'react';
import { View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { AppText } from '@/components/ui/app-text';
import { useLocalization } from '@/localization/localization';
import { useFinanceRepository } from '@/providers/finance-provider';
import type { FinanceState } from '@/domain/models';
import { useQashyTheme } from '@/theme/theme';
import { confirmDestructive, errorMessage, showError } from '@/utils/confirm';

type DeletableType = 'recurringRules' | 'accounts' | 'categories' | 'budgets' | 'goals';

/**
 * Multi-select + batch delete state for one list on the More screen. `liveIds` are the ids
 * currently in the list; a selection can outlive a row (sync, another sheet), so only live
 * ones are counted and deleted.
 */
export function useBatchDelete(options: {
  type: DeletableType;
  liveIds: string[];
  confirmTitle: (count: number) => string;
  confirmMessage: string | ((ids: string[]) => string);
  errorTitle: string;
}) {
  const repository = useFinanceRepository();
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const liveSelected = selectedIds.filter((id) => options.liveIds.includes(id));

  const toggleMode = () => {
    setSelecting((current) => !current);
    setSelectedIds([]);
  };
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const deleteSelected = async () => {
    if (deleting || !liveSelected.length) return;
    const ids = [...liveSelected];
    const confirmed = await confirmDestructive({ title: options.confirmTitle(ids.length), message: typeof options.confirmMessage === 'function' ? options.confirmMessage(ids) : options.confirmMessage });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await repository.deleteEntities(options.type as keyof FinanceState, ids);
      setSelectedIds([]);
      setSelecting(false);
    } catch (reason) {
      showError(options.errorTitle, errorMessage(reason, 'Try again.'));
    } finally {
      setDeleting(false);
    }
  };

  return { selecting, selectedIds, liveSelectedCount: liveSelected.length, deleting, toggleMode, toggle, deleteSelected };
}

export function BatchDeleteBar({ count, busy, onDelete }: { count: number; busy: boolean; onDelete: () => void }) {
  const { space } = useQashyTheme();
  const { t } = useLocalization();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
      <AppText literal variant="caption" muted>{t(`${count} selected`)}</AppText>
      <ActionButton title="Delete selected" icon="trash" variant="danger" disabled={busy || !count} onPress={onDelete} />
    </View>
  );
}
