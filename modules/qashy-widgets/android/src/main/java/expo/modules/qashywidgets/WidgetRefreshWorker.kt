package expo.modules.qashywidgets

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume

/**
 * Process-wide result of the headless refresh task. The task always resolves (and React Native's
 * own timeout also finishes it), so "finished" says nothing about success; JS reports whether the
 * refresh actually completed through QashyWidgets.reportHeadlessResult just before it resolves.
 */
internal object RefreshOutcome {
  private val ok = AtomicBoolean(false)

  fun reset() = ok.set(false)

  fun report(value: Boolean) = ok.set(value)

  fun succeeded(): Boolean = ok.get()
}

/**
 * Runs the JS headless task "QashyWidgetRefresh" (which rebuilds the snapshot and calls update())
 * and schedules the next midnight run. JS is started in-process without a Service, because
 * background service starts are restricted on Android 8+.
 */
class WidgetRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val context = applicationContext
    if (WidgetScheduler.hasWidgets(context)) {
      // Null means the 40 s budget ran out; false means no React host, an exception, or a task
      // that finished without JS reporting a completed refresh.
      val finished = try {
        withTimeoutOrNull(TOTAL_TIMEOUT_MS) { withContext(Dispatchers.Main) { runJsTask(context) } } == true
      } catch (e: Exception) {
        if (e is CancellationException) throw e
        Log.w(TAG, "Widget refresh task failed", e)
        false
      }
      // Retry a failed or timed-out run; the next midnight is scheduled only once, on the final
      // attempt or on success, so a retry never loses or duplicates it.
      if (!finished && runAttemptCount < MAX_RETRIES) return Result.retry()
      // Last step: REPLACE cancels the running midnight worker, i.e. this one.
      if (WidgetScheduler.hasWidgets(context)) WidgetScheduler.scheduleMidnight(context)
    }
    return Result.success()
  }

  // Main thread only: ReactHost listeners and HeadlessJsTaskContext.startTask require it.
  private suspend fun runJsTask(context: Context): Boolean {
    val host: ReactHost = (context as? ReactApplication)?.reactHost ?: return false
    val reactContext = host.currentReactContext ?: awaitReactContext(host)
    val taskContext = HeadlessJsTaskContext.getInstance(reactContext)
    val taskId = AtomicInteger(-1)
    // Cleared before the task starts; JS sets it (reportHeadlessResult) right before resolving.
    RefreshOutcome.reset()
    var listener: HeadlessJsTaskEventListener? = null
    try {
      suspendCancellableCoroutine<Unit> { cont ->
        val l = object : HeadlessJsTaskEventListener {
          override fun onHeadlessJsTaskStart(started: Int) = Unit

          // Posted to the main thread after startTask returned, so taskId is already set.
          override fun onHeadlessJsTaskFinish(finished: Int) {
            if (finished == taskId.get() && cont.isActive) cont.resume(Unit)
          }
        }
        listener = l
        taskContext.addTaskEventListener(l)
        taskId.set(taskContext.startTask(HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), JS_TIMEOUT_MS, true)))
      }
    } finally {
      listener?.let { taskContext.removeTaskEventListener(it) }
    }
    return RefreshOutcome.succeeded()
  }

  private suspend fun awaitReactContext(host: ReactHost): ReactContext =
    suspendCancellableCoroutine<ReactContext> { cont ->
      val l = object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          if (cont.isActive) cont.resume(context)
        }
      }
      host.addReactInstanceEventListener(l)
      cont.invokeOnCancellation { host.removeReactInstanceEventListener(l) }
      host.start()
    }

  private companion object {
    const val TAG = "QashyWidgets"
    const val TASK_KEY = "QashyWidgetRefresh"
    const val JS_TIMEOUT_MS = 30_000L
    const val TOTAL_TIMEOUT_MS = 40_000L
    const val MAX_RETRIES = 2
  }
}
