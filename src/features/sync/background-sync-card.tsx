/**
 * The opt-in switch for periodic background sync. Android only, per device, off by default.
 *
 * Shown only on a build that can schedule it, and only on a device that has a vault; it is
 * disabled (and reads as off) while sync is paused, because there is nothing to check in for.
 * The choice is stored device-locally (`data/background-sync-store.ts`), never in the synced
 * settings, so enabling it here never turns it on for another device.
 *
 * The copy is blunt about the two costs: battery and data, and the fact that the relay can see
 * when this device checks in. Both are real, and the user is the one who decides.
 */

import { useCallback, useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import {
  isBackgroundSyncAvailable,
  setBackgroundSyncEnabled,
} from "@/features/background-sync";
import { ToggleRow } from "@/features/sync/relay-card";
import { readBackgroundSync } from "@/data/background-sync-store";
import type { SyncStatus } from "@/sync/setup";
import { errorMessage, showError } from "@/utils/confirm";

export function BackgroundSyncCard({
  status,
}: {
  readonly status: SyncStatus;
}) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    let live = true;
    readBackgroundSync().then(
      (value) => {
        if (live) setOn(value);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const change = useCallback(
    async (next: boolean) => {
      setOn(next);
      try {
        await setBackgroundSyncEnabled(next, {
          enabled: status.enabled,
          deviceId: status.deviceId,
        });
      } catch (reason) {
        setOn(!next);
        showError(
          "Couldn’t change background sync",
          errorMessage(reason, "Nothing was changed."),
        );
      }
    },
    [status.enabled, status.deviceId],
  );

  if (!isBackgroundSyncAvailable() || !status.deviceId) return null;

  return (
    <>
      <SectionHeader title="Background sync" />
      <Card>
        <ToggleRow
          title="Sync in the background"
          body={
            status.enabled
              ? "Checks for changes from your other devices about every 30 minutes when this device is connected, so widgets stay current without opening Qashy. It uses some battery and data, and the relay can see when this device checks in."
              : "Turn sync on to use this. It checks for changes about every 30 minutes when connected, uses some battery and data, and lets the relay see when this device checks in."
          }
          value={on && status.enabled}
          disabled={!status.enabled}
          onValueChange={(value) => void change(value)}
        />
      </Card>
    </>
  );
}
