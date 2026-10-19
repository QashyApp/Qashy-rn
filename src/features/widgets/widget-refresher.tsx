import { useEffect } from "react";
import { AppState } from "react-native";

import { financeRepository } from "@/data/local-finance-repository";
import { subscribeWidgetSettings } from "@/data/widget-settings-store";
import { refreshWidgets } from "@/features/widgets/refresher";
import * as QashyWidgets from "../../../modules/qashy-widgets";

/** Long enough that a burst of repository writes (an import, a sync batch) is one refresh. */
export const WIDGET_REFRESH_DEBOUNCE_MS = 600;

/**
 * Keeps the home-screen widgets current while the app is open: refreshes on mount, whenever the
 * finance data or the widget settings change, and when the app returns to the foreground.
 * Renders nothing, and does nothing off Android or without the native module.
 */
export function WidgetRefresher(): null {
  useEffect(() => {
    if (!QashyWidgets.isAvailable()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void refreshWidgets();
      }, WIDGET_REFRESH_DEBOUNCE_MS);
    };
    void refreshWidgets();
    const unsubscribeRepository = financeRepository.subscribe(schedule);
    const unsubscribeSettings = subscribeWidgetSettings(schedule);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") schedule();
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribeRepository();
      unsubscribeSettings();
      appState.remove();
    };
  }, []);
  return null;
}
