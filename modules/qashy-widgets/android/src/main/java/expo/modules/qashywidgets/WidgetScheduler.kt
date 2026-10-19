package expo.modules.qashywidgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.io.File
import java.util.Calendar
import java.util.concurrent.TimeUnit

const val KIND_TRANSACTIONS = "transactions"
const val KIND_SUMMARY = "summary"

object WidgetScheduler {
  private const val MIDNIGHT_WORK = "qashy-widget-midnight"
  private const val NOW_WORK = "qashy-widget-now"
  private const val THROTTLE_MS = 60_000L

  /** (appWidgetId, kind) for every placed widget of both kinds. */
  fun placed(context: Context): List<Pair<Int, String>> {
    val manager = AppWidgetManager.getInstance(context)
    fun ids(receiver: Class<*>, kind: String) =
      manager.getAppWidgetIds(ComponentName(context, receiver)).map { it to kind }
    return ids(TransactionsWidgetReceiver::class.java, KIND_TRANSACTIONS) +
      ids(SummaryWidgetReceiver::class.java, KIND_SUMMARY)
  }

  fun hasWidgets(context: Context, excluding: Set<Int> = emptySet()): Boolean =
    placed(context).any { it.first !in excluding }

  /**
   * Replaces the pending midnight run (needed after a clock or time zone change, and after a
   * midnight run). Never call it with replace = true from inside the refresh task: REPLACE
   * cancels the running worker.
   */
  fun scheduleMidnight(context: Context, replace: Boolean = true) {
    val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
      .setInitialDelay(millisUntilNextMidnight(), TimeUnit.MILLISECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      MIDNIGHT_WORK,
      if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
      request,
    )
  }

  /** An immediate refresh; a pending or running one is kept. */
  fun enqueueNow(context: Context) {
    WorkManager.getInstance(context).enqueueUniqueWork(
      NOW_WORK,
      ExistingWorkPolicy.KEEP,
      OneTimeWorkRequestBuilder<WidgetRefreshWorker>().build(),
    )
  }

  /**
   * enqueueNow for "this widget has no data". The refresh re-renders widgets, so a widget JS never
   * fills (unknown id) or one just cleared would loop; a marker file's mtime rate-limits it.
   */
  fun enqueueNowThrottled(context: Context) {
    if (markRefreshRequested(context)) enqueueNow(context)
  }

  /** False when a refresh was requested within the last minute. */
  fun markRefreshRequested(context: Context): Boolean {
    val dir = SnapshotStore.dir(context).apply { mkdirs() }
    val marker = File(dir, "refresh-requested")
    val now = System.currentTimeMillis()
    if (marker.exists() && now - marker.lastModified() < THROTTLE_MS) return false
    runCatching { marker.writeText("") }
    return true
  }

  fun cancelAll(context: Context) {
    val work = WorkManager.getInstance(context)
    work.cancelUniqueWork(MIDNIGHT_WORK)
    work.cancelUniqueWork(NOW_WORK)
  }

  /** Called when a widget is removed: with none left, drop the data and the schedule. */
  fun cleanupIfNoWidgets(context: Context, excluding: Set<Int> = emptySet()) {
    if (hasWidgets(context, excluding)) return
    SnapshotStore.delete(context)
    cancelAll(context)
  }

  private fun millisUntilNextMidnight(): Long {
    val now = System.currentTimeMillis()
    val target = Calendar.getInstance().apply {
      timeInMillis = now
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 1)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      if (timeInMillis <= now) add(Calendar.DAY_OF_YEAR, 1)
    }
    return target.timeInMillis - now
  }
}
