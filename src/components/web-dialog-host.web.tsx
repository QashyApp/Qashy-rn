import { useEffect, useSyncExternalStore } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { AppText } from '@/components/ui/app-text';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { webDialogStore } from '@/utils/web-dialog-store';

/** In-app replacement for window.confirm / window.alert on web. Mount once near the root. */
export function WebDialogHost() {
  const theme = useQashyTheme();
  const { space, radius } = theme;
  const { t } = useLocalization();
  const dialog = useSyncExternalStore(webDialogStore.subscribe, webDialogStore.getSnapshot, () => null);

  useEffect(() => webDialogStore.mountHost(), []);

  if (!dialog) return null;
  const dismiss = () => webDialogStore.close(dialog.id, false);

  return (
    <Modal transparent visible animationType="fade" onRequestClose={dismiss}>
      <Pressable
        accessible={false}
        onPress={dismiss}
        style={{ flex: 1, backgroundColor: theme.scrim, alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
        <Pressable
          role="alertdialog"
          accessibilityLabel={dialog.title}
          aria-modal
          onPress={() => undefined}
          style={{
            width: '100%',
            maxWidth: 420,
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.card,
            borderCurve: 'continuous',
            backgroundColor: theme.surfaceElevated,
            boxShadow: theme.shadowRaised,
          }}>
          <AppText literal variant="headline">{dialog.title}</AppText>
          {dialog.message ? <AppText literal muted>{dialog.message}</AppText> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, flexWrap: 'wrap' }}>
            {dialog.confirmLabel ? <ActionButton title={t('Cancel')} variant="secondary" onPress={dismiss} /> : null}
            <ActionButton
              title={dialog.confirmLabel ?? t('OK')}
              variant={dialog.destructive ? 'danger' : 'primary'}
              onPress={() => webDialogStore.close(dialog.id, true)}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
