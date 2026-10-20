package expo.modules.qashywidgets

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Runs the JS headless task "QashyWidgetRefresh" (which rebuilds the snapshot and calls update())
 * and schedules the next midnight run. JS is started in-process by [HeadlessTaskRunner].
 */
class WidgetRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val context = applicationContext
    if (WidgetScheduler.hasWidgets(context)) {
      // Null means the 40 s budget ran out; false means no React host, an exception, or a task
      // that finished without JS reporting a completed refresh.
      val finished = try {
        withTimeoutOrNull(TOTAL_TIMEOUT_MS) {
          withContext(Dispatchers.Main) { HeadlessTaskRunner.run(context, TASK_KEY, JS_TIMEOUT_MS) }
        } == true
      } catch (e: Exception) {
        if (e is CancellationException) throw e
        Log.w(TAG, "Widget refresh task failed", e)
        false
      }
      // Retry a failed or timed-out run; the next midnight is scheduled only once, on the final
      // attempt or on success, so a retry never loses or duplicates it.
      if (!finished && runAttemptCount < MAX_RETRIES) return Result.retry()
      // Last step. Only the midnight worker replaces (it is the one being replaced, after its own
      // run); the "now" worker keeps, since REPLACE could cancel an in-flight midnight run.
      val isNowWorker = inputData.getString(WidgetScheduler.INPUT_WORKER_KIND) == WidgetScheduler.WORKER_NOW
      if (WidgetScheduler.hasWidgets(context)) WidgetScheduler.scheduleMidnight(context, replace = !isNowWorker)
    }
    return Result.success()
  }

  private companion object {
    const val TAG = "QashyWidgets"
    const val TASK_KEY = "QashyWidgetRefresh"
    const val JS_TIMEOUT_MS = 30_000L
    const val TOTAL_TIMEOUT_MS = 40_000L
    const val MAX_RETRIES = 2
  }
}
