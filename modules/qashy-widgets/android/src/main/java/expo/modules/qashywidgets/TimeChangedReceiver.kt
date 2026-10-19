package expo.modules.qashywidgets

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Exported only because the system delivers these broadcasts from outside the app. It does
 * nothing unless a widget is placed, and never reads the intent's contents.
 */
class TimeChangedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_TIMEZONE_CHANGED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_DATE_CHANGED,
      Intent.ACTION_LOCALE_CHANGED,
      -> if (WidgetScheduler.hasWidgets(context)) {
        WidgetScheduler.enqueueNow(context)
        WidgetScheduler.scheduleMidnight(context)
      }
    }
  }
}
