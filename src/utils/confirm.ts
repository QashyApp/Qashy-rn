import { Alert } from "react-native";

import { storageFailureMessage } from "@/data/storage-error";
import { translateCurrent } from "@/localization/localization";
import { hapticError, hapticWarning } from "@/utils/haptics";
import { webDialogStore } from "@/utils/web-dialog-store";

interface ConfirmOptions {
  title: string;
  /** A list is one sentence per line; each is translated on its own and shown on its own line. */
  message?: string | readonly string[];
  confirmLabel?: string;
}

// Alert.alert is a no-op on react-native-web, so dialogs must branch per platform.
export function confirmDestructive({
  title,
  message,
  confirmLabel = "Delete",
}: ConfirmOptions) {
  const translatedTitle = translateCurrent(title);
  const translatedMessage = message
    ? typeof message === "string"
      ? translateCurrent(message)
      : message.map((line) => translateCurrent(line)).join("\n")
    : undefined;
  const translatedConfirmLabel = translateCurrent(confirmLabel);
  if (process.env.EXPO_OS === "web") {
    if (webDialogStore.hasHost()) {
      return webDialogStore.open({
        title: translatedTitle,
        message: translatedMessage,
        confirmLabel: translatedConfirmLabel,
        destructive: true,
      });
    }
    const text = translatedMessage
      ? `${translatedTitle}\n\n${translatedMessage}`
      : translatedTitle;
    return Promise.resolve(
      typeof window !== "undefined" && window.confirm(text),
    );
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      translatedTitle,
      translatedMessage,
      [
        {
          text: translateCurrent("Cancel"),
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: translatedConfirmLabel,
          style: "destructive",
          onPress: () => {
            hapticWarning();
            resolve(true);
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * `quiet` is for a notice that is not a failure (a success report, "nothing to
 * do"): the dialog is the same but the error buzz would be wrong.
 */
export function showError(
  title: string,
  message?: string,
  { quiet = false }: { quiet?: boolean } = {},
) {
  if (!quiet) hapticError();
  const translatedTitle = translateCurrent(title);
  const translatedMessage = message ? translateCurrent(message) : undefined;
  if (process.env.EXPO_OS === "web") {
    if (webDialogStore.hasHost()) {
      void webDialogStore.open({
        title: translatedTitle,
        message: translatedMessage,
        confirmLabel: null,
        destructive: false,
      });
      return;
    }
    if (typeof window !== "undefined")
      window.alert(
        translatedMessage
          ? `${translatedTitle}\n\n${translatedMessage}`
          : translatedTitle,
      );
    return;
  }
  Alert.alert(translatedTitle, translatedMessage);
}

export function errorMessage(reason: unknown, fallback: string) {
  // A storage engine's own diagnostic is English that no dictionary knows; show Qashy's sentence.
  const storage = storageFailureMessage(reason);
  if (storage) return storage;
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
