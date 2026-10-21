package expo.modules.qashywidgets

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.SystemClock
import android.util.Log
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.compose
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The one place a snapshot change reaches the screen. Glance's `update()`/`updateAll()` only send
 * an event to a session that is still alive (about 45 s after its first render) and are lost
 * there, so each placed widget is rendered once with `GlanceAppWidget.compose` and published
 * through `AppWidgetManager.updateAppWidget`. Sessions Glance starts itself (placement, onUpdate,
 * resize) are not affected: they read the snapshot flow inside provideContent.
 */
object WidgetPublisher {
  private const val TAG = "QashyWidgets"

  /** compose() for one id must not overlap: a second call makes the first throw. */
  private val composeLock = Mutex()

  /** Every kind renders at once; widgets of one kind are published one after another. */
  suspend fun publishAll(context: Context) {
    val app = context.applicationContext
    val debug = (app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    val start = SystemClock.elapsedRealtime()
    var count = 0
    coroutineScope {
      for (kind in WidgetKinds.all) {
        launch {
          val manager = AppWidgetManager.getInstance(app)
          val ids = manager.getAppWidgetIds(android.content.ComponentName(app, kind.receiver))
          for (appWidgetId in ids) {
            publish(app, manager, kind, appWidgetId)
            synchronized(this@WidgetPublisher) { count++ }
          }
        }
      }
    }
    if (debug) {
      // Durations and counts only, never snapshot contents.
      Log.d(TAG, "publishAll: $count widgets ${SystemClock.elapsedRealtime() - start} ms")
    }
  }

  private suspend fun publish(context: Context, manager: AppWidgetManager, kind: WidgetKind, appWidgetId: Int) {
    val widget = kind.widget()
    try {
      // The bound widget's current options (not a default Bundle) drive SizeMode.Responsive and
      // LocalAppWidgetOptions exactly as in a managed session; compose() skips the lookup itself
      // when options are passed.
      val glanceId = GlanceAppWidgetManager(context).getGlanceIdBy(appWidgetId)
      val views = composeLock.withLock {
        widget.compose(context, glanceId, options = manager.getAppWidgetOptions(appWidgetId))
      }
      manager.updateAppWidget(appWidgetId, views)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      Log.w(TAG, "publish failed for widget $appWidgetId, falling back to update", e)
      try {
        widget.update(context, GlanceAppWidgetManager(context).getGlanceIdBy(appWidgetId))
      } catch (e2: CancellationException) {
        throw e2
      } catch (e2: Exception) {
        Log.w(TAG, "fallback update failed for widget $appWidgetId", e2)
      }
    }
  }
}
