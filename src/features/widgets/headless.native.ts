import { AppRegistry } from "react-native";

/**
 * The task the native widget side starts (midnight, boot, a widget update) while the app is not
 * running, so widgets stay current without opening the app. It registers at bundle load, before
 * any component exists, which is why this file imports nothing but React Native: the finance
 * repository and the refresher are loaded inside the task, only when it actually runs.
 *
 * Recurring transactions are not generated here (`generateRecurring: false`): a background wake
 * must not post transactions the user has not seen. The task always resolves.
 */
export const WIDGET_HEADLESS_TASK = "QashyWidgetRefresh";

AppRegistry.registerHeadlessTask(WIDGET_HEADLESS_TASK, () => async () => {
  try {
    const { financeRepository } =
      await import("@/data/local-finance-repository");
    await financeRepository.initialize({ generateRecurring: false });
    const { refreshWidgets } = await import("@/features/widgets/refresher");
    await refreshWidgets();
  } catch (error) {
    // A fixed message and an error name only: no finance data in a log.
    console.warn(
      `[widgets] Headless refresh failed (${error instanceof Error ? error.name : "unknown"})`,
    );
  }
});
