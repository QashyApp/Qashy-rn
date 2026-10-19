package expo.modules.qashywidgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.os.SystemClock
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.Calendar
import java.util.concurrent.TimeUnit

const val KIND_TRANSACTIONS = "transactions"
const val KIND_SUMMARY = "summary"

object WidgetScheduler {
  private const val MIDNIGHT_WORK = "qashy-widget-midnight"
  private const val NOW_WORK = "qashy-widget-now"
  private const val THROTTLE_MS = 60_000L
  private const val BACKOFF_MS = 60_000L

  /** appWidgetId to the time (elapsedRealtime) of its last no-data refresh request. Guarded by this. */
  private val lastRefreshRequest = HashMap<Int, Long>()

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
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MS, TimeUnit.MILLISECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      MIDNIGHT_WORK,
      if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
      request,
    )
  }

  /** An immediate refresh; by default a pending or running one is kept. */
  fun enqueueNow(context: Context, policy: ExistingWorkPolicy = ExistingWorkPolicy.KEEP) {
    WorkManager.getInstance(context).enqueueUniqueWork(
      NOW_WORK,
      policy,
      OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MS, TimeUnit.MILLISECONDS)
        .build(),
    )
  }

  /**
   * enqueueNow for "this widget has no data". The refresh re-renders widgets, so a widget JS never
   * fills (unknown id) or one just cleared would loop; a per-widget timestamp rate-limits it, so
   * placing a second widget right after the first still gets its own refresh. A refresh already
   * running was started before this widget existed, so the new one is chained after it.
   */
  fun enqueueNowThrottled(context: Context, appWidgetId: Int) {
    if (markRefreshRequested(appWidgetId)) enqueueNow(context, ExistingWorkPolicy.APPEND_OR_REPLACE)
  }

  /** False when this widget requested a refresh within the last minute. */
  @Synchronized
  fun markRefreshRequested(appWidgetId: Int): Boolean {
    val now = SystemClock.elapsedRealtime()
    val last = lastRefreshRequest[appWidgetId]
    if (last != null && now - last < THROTTLE_MS) return false
    lastRefreshRequest[appWidgetId] = now
    return true
  }

  /** Marks every placed widget as just requested, so re-rendering them to "open the app" cannot loop. */
  fun markAllRefreshRequested(context: Context) {
    placed(context).forEach { markRefreshRequested(it.first) }
  }

  @Synchronized
  private fun forgetRefreshRequests() {
    lastRefreshRequest.clear()
  }

  fun cancelAll(context: Context) {
    val work = WorkManager.getInstance(context)
    work.cancelUniqueWork(MIDNIGHT_WORK)
    work.cancelUniqueWork(NOW_WORK)
    forgetRefreshRequests()
  }

  /**
   * After the snapshot was cleared: with no widget placed nothing needs to run, so drop the
   * schedule; otherwise keep (never replace) the midnight run, so a failed rebuild cannot leave
   * the widgets without a next refresh.
   */
  fun afterClear(context: Context) {
    if (hasWidgets(context)) scheduleMidnight(context, replace = false) else cancelAll(context)
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
