import { useEffect } from "react";
import { AppState } from "react-native";

import { financeRepository } from "@/data/local-finance-repository";
import { subscribeWidgetSettings } from "@/data/widget-settings-store";
import { requestPreviewRegistration } from "@/features/widgets/preview-registration";
import { refreshWidgets } from "@/features/widgets/refresher";
import { customThemesStore } from "@/theme/custom/use-custom-themes";
import * as QashyWidgets from "../../../modules/qashy-widgets";

/**
 * After a refresh starts, events inside this window fold into one trailing refresh. The first
 * event of a quiet period is never delayed (a leading edge), so a single tap reaches the widget
 * at once while an import or sync burst still costs two builds at most.
 */
export const WIDGET_REFRESH_WINDOW_MS = 250;

/** Waits before re-running a refresh that did not complete; the list's length is the retry budget. */
export const WIDGET_REFRESH_RETRY_DELAYS_MS = [2_000, 10_000, 30_000];

/**
 * Keeps the home-screen widgets current while the app is open: refreshes on mount, whenever the
 * finance data, the widget settings or the custom themes change, and when the app returns to the
 * foreground, and publishes the picker previews once per launch when they are out of date. A pending trailing refresh is flushed when the app leaves the foreground, because
 * the JS timer may not run again until it returns. A refresh that did not complete is retried.
 * Renders nothing, and does nothing off Android or without the native module.
 */
export function WidgetRefresher(): null {
  useEffect(() => {
    if (!QashyWidgets.isAvailable()) return;
    let disposed = false;
    let windowTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let retries = 0;

    const run = () => {
      void refreshWidgets().then((completed) => {
        if (disposed) return;
        if (completed) {
          retries = 0;
          return;
        }
        const delay = WIDGET_REFRESH_RETRY_DELAYS_MS[retries];
        if (delay === undefined || retryTimer !== undefined) return;
        retries += 1;
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          trigger();
        }, delay);
      });
    };
    const openWindow = () => {
      windowTimer = setTimeout(() => {
        windowTimer = undefined;
        if (!pending) return;
        pending = false;
        run();
        openWindow();
      }, WIDGET_REFRESH_WINDOW_MS);
    };
    const trigger = () => {
      if (windowTimer !== undefined) {
        pending = true;
        return;
      }
      run();
      openWindow();
    };
    // A fresh event restarts the retry budget and supersedes a scheduled retry.
    const schedule = () => {
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      retries = 0;
      trigger();
    };

    trigger();
    // Once per process; the native side only acts when the picker previews are out of date.
    requestPreviewRegistration(() => QashyWidgets.registerPreviews());
    const unsubscribeRepository = financeRepository.subscribe(schedule);
    const unsubscribeSettings = subscribeWidgetSettings(schedule);
    const unsubscribeThemes = customThemesStore.subscribe(schedule);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        schedule();
      } else if (pending) {
        pending = false;
        run();
      }
    });
    return () => {
      disposed = true;
      if (windowTimer !== undefined) clearTimeout(windowTimer);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      unsubscribeRepository();
      unsubscribeSettings();
      unsubscribeThemes();
      appState.remove();
    };
  }, []);
  return null;
}
