import { AppRegistry } from "react-native";

import { runHeadlessRefresh } from "@/features/widgets/headless-task";
import { reportHeadlessResult } from "../../../modules/qashy-widgets";

/**
 * The task the native widget side starts (midnight, boot, a widget update) while the app is not
 * running, so widgets stay current without opening the app. It registers at bundle load, before
 * any component exists, which is why it imports only React Native, the tiny task body and the
 * native module's thin wrapper: the finance repository and the refresher are loaded inside the
 * task, only when it actually runs.
 *
 * Recurring transactions are not generated here (`generateRecurring: false`): a background wake
 * must not post transactions the user has not seen. The task always resolves, after reporting
 * whether the refresh completed so the native worker can retry a failure.
 */
export const WIDGET_HEADLESS_TASK = "QashyWidgetRefresh";

AppRegistry.registerHeadlessTask(
  WIDGET_HEADLESS_TASK,
  () => () =>
    runHeadlessRefresh({
      async initialize() {
        const { financeRepository } =
          await import("@/data/local-finance-repository");
        await financeRepository.initialize({ generateRecurring: false });
      },
      async refresh() {
        const { refreshWidgets } = await import("@/features/widgets/refresher");
        return refreshWidgets();
      },
      report: reportHeadlessResult,
      // A fixed message and an error name only: no finance data in a log.
      warn: (message) => console.warn(message),
    }),
);
