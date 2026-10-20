package expo.modules.qashywidgets

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

/**
 * Opt-in background sync: the unique periodic work that starts the JS headless task
 * "QashyBackgroundSync" about every 30 minutes while the device is connected and the battery is
 * not low. WorkManager persists it across reboots, so there is no boot receiver. It exists only
 * while the user has turned the device-local setting on and sync is set up; JS schedules and
 * cancels it (see `setBackgroundSync`) and the task cancels it itself if it finds the setting off.
 *
 * Starting the task, its timeouts and the outcome handshake are the shared [HeadlessTaskRunner].
 */
class BackgroundSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val finished = try {
      // Null means the total budget ran out; false means no React host, an exception, or a task
      // that finished without JS reporting a completed run.
      withTimeoutOrNull(TOTAL_TIMEOUT_MS) {
        withContext(Dispatchers.Main) { HeadlessTaskRunner.run(applicationContext, TASK_KEY, JS_TIMEOUT_MS) }
      } == true
    } catch (e: Exception) {
      if (e is CancellationException) throw e
      // No finance data or key material is ever in this message.
      Log.w(TAG, "Background sync task failed", e)
      false
    }
    // A couple of backed-off retries for a failed run; after that wait for the next period.
    if (!finished && runAttemptCount < MAX_RETRIES) return Result.retry()
    return Result.success()
  }

  companion object {
    private const val TAG = "QashyBackgroundSync"
    private const val WORK_NAME = "qashy-background-sync"
    private const val TASK_KEY = "QashyBackgroundSync"
    private const val JS_TIMEOUT_MS = 50_000L
    private const val TOTAL_TIMEOUT_MS = 60_000L
    private const val MAX_RETRIES = 2
    private const val PERIOD_MINUTES = 30L
    private const val BACKOFF_MINUTES = 5L

    /**
     * Idempotent. Enabling keeps an existing schedule (KEEP) so reconciling on every app start
     * does not restart the period; disabling cancels it.
     */
    fun setEnabled(context: Context, enabled: Boolean) {
      val work = WorkManager.getInstance(context)
      if (!enabled) {
        work.cancelUniqueWork(WORK_NAME)
        return
      }
      val request = PeriodicWorkRequestBuilder<BackgroundSyncWorker>(PERIOD_MINUTES, TimeUnit.MINUTES)
        .setConstraints(
          Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build(),
        )
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
        .build()
      work.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }
  }
}
