package expo.modules.qashywidgets

import androidx.glance.appwidget.updateAll
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Bridge between the JS snapshot builder and the two Glance home-screen widgets. The snapshot
 * (finance figures, already formatted by JS) is stored device-locally and excluded from backups.
 */
class QashyWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QashyWidgets")

    AsyncFunction("getPlacedWidgets") {
      val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
      WidgetScheduler.placed(context).map { (id, kind) -> mapOf<String, Any>("id" to id, "kind" to kind) }
    }

    // Rejects (and keeps the old data) when the JSON is not a version-1 snapshot.
    AsyncFunction("update") Coroutine { json: String ->
      val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        SnapshotStore.write(context, json)
        updateWidgets(context)
        // KEEP: update() also runs inside the refresh task, which REPLACE would cancel.
        WidgetScheduler.scheduleMidnight(context, replace = false)
      }
    }

    AsyncFunction("clear") Coroutine { ->
      val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        SnapshotStore.delete(context)
        // Widgets re-render to "open the app"; that must not trigger a refresh that refills them.
        WidgetScheduler.markRefreshRequested(context)
        updateWidgets(context)
        WidgetScheduler.cancelAll(context)
      }
    }
  }

  private suspend fun updateWidgets(context: android.content.Context) {
    TransactionsWidget().updateAll(context)
    SummaryWidget().updateAll(context)
  }
}
