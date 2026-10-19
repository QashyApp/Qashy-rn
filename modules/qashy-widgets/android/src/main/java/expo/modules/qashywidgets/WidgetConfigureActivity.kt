package expo.modules.qashywidgets

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * Android 12+ launchers call this when a widget is placed or reconfigured. It only hands over to
 * the app's widget settings screen, so it shows no UI of its own.
 */
class WidgetConfigureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val id = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID) {
      setResult(RESULT_CANCELED)
    } else {
      // OK keeps the widget placed; the app screen then edits its style.
      setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
      val open = Intent(Intent.ACTION_VIEW, Uri.parse("qashy:///widgets?widgetId=$id"))
        .setPackage(packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { startActivity(open) }
    }
    finish()
  }
}
