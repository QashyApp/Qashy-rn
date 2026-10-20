package expo.modules.qashywidgets

import android.content.pm.ApplicationInfo
import android.os.SystemClock
import android.util.Log
import androidx.glance.appwidget.updateAll
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Bridge between the JS snapshot builder and the Glance home-screen widgets. The snapshot
 * (finance figures, already formatted by JS) is stored device-locally and excluded from backups.
 */
class QashyWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QashyWidgets")

    AsyncFunction("getPlacedWidgets") {
      val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
      WidgetScheduler.placed(context).map { (id, kind) -> mapOf<String, Any>("id" to id, "kind" to kind) }
    }

    // Rejects (and keeps the old data) when the JSON is not a version-2 snapshot.
    AsyncFunction("update") Coroutine { json: String ->
      val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        val debug = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val start = SystemClock.elapsedRealtime()
        SnapshotStore.write(context, json)
        val written = SystemClock.elapsedRealtime()
        // updateAll still starts sessions for widgets without a live one; live ones recompose from the flow.
        updateWidgets(context)
        if (debug) {
          // Durations only, never snapshot contents.
          val done = SystemClock.elapsedRealtime()
          Log.d("QashyWidgets", "update: write ${written - start} ms, updateAll ${done - written} ms")
        }
        // KEEP: update() also runs inside the refresh task, which REPLACE would cancel.
        WidgetScheduler.scheduleMidnight(context, replace = false)
      }
    }

    // Called by the headless JS task right before it resolves, so the worker can tell a refresh
    // that completed from one that failed (the task itself always resolves).
    Function("reportHeadlessResult") { ok: Boolean ->
      RefreshOutcome.report(ok)
    }

    // Publishes the picker previews (Android 15+) when they are out of date; a no-op otherwise.
    // Resolves to a short status and never rejects, so a failure can only cost the preview.
    AsyncFunction("registerPreviews") Coroutine { ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) "failed" else WidgetPreviews.register(context).id
    }

    // Opt-in background sync: schedules (true) or cancels (false) the unique periodic work. Lives
    // here because this module already owns WorkManager and the headless-task start.
    AsyncFunction("setBackgroundSync") { enabled: Boolean ->
      val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
      BackgroundSyncWorker.setEnabled(context, enabled)
    }

    AsyncFunction("clear") Coroutine { ->
      val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        SnapshotStore.delete(context)
        // Widgets re-render to "open the app"; that must not trigger a refresh that refills them.
        WidgetScheduler.markAllRefreshRequested(context)
        updateWidgets(context)
        WidgetScheduler.afterClear(context)
      }
    }
  }

  // Every kind renders at once: one slow composition must not delay another kind's redraw.
  private suspend fun updateWidgets(context: android.content.Context) {
    coroutineScope {
      WidgetKinds.all.forEach { kind -> launch { kind.widget().updateAll(context) } }
    }
  }
}
