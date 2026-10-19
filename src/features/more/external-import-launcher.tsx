import { useRouter } from "expo-router";

import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";

/**
 * The entry point in More → Import & export. The import itself lives on its own screen
 * (`external-import-screen.tsx`): a source, a file, a review and a result do not belong in one
 * scrolling card.
 */
export function ExternalImportLauncher() {
  const router = useRouter();
  return (
    <Card style={{ gap: 14 }}>
      <AppText variant="headline">Import from another app</AppText>
      <AppText muted>
        Bring your history over from a backup file. Everything is read on this
        device, and nothing is committed until after preview.
      </AppText>
      <ActionButton
        title="Start import"
        icon="arrow.right"
        variant="secondary"
        onPress={() => router.push("/import-app")}
      />
    </Card>
  );
}
