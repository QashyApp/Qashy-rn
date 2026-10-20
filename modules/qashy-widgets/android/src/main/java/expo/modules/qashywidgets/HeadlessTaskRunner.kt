package expo.modules.qashywidgets

import android.content.Context
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume

/**
 * Process-wide result of the headless JS tasks. A task always resolves (and React Native's own
 * timeout also finishes it), so "finished" says nothing about success; JS reports whether the
 * work actually completed through QashyWidgets.reportHeadlessResult just before it resolves.
 */
internal object RefreshOutcome {
  private val ok = AtomicBoolean(false)

  fun reset() = ok.set(false)

  fun report(value: Boolean) = ok.set(value)

  fun succeeded(): Boolean = ok.get()
}

/**
 * Starts a JS headless task in-process (without a Service, because background service starts are
 * restricted on Android 8+) and waits for it to finish. Shared by the widget refresh worker and
 * the opt-in background sync worker. [RefreshOutcome] is process-wide and different workers can
 * overlap, so the whole reset -> run -> read section is serialized by one mutex, whichever task
 * it runs: outcomes cannot cross between runs, and two tasks never run JS at the same time.
 */
internal object HeadlessTaskRunner {
  private val jsMutex = Mutex()

  /**
   * Main thread only: ReactHost listeners and HeadlessJsTaskContext.startTask require it.
   * Returns whether JS reported a completed run before the task finished; false also means no
   * React host.
   */
  suspend fun run(context: Context, taskKey: String, jsTimeoutMs: Long): Boolean {
    val host: ReactHost = (context as? ReactApplication)?.reactHost ?: return false
    val reactContext = host.currentReactContext ?: awaitReactContext(host)
    val taskContext = HeadlessJsTaskContext.getInstance(reactContext)
    val startedTaskId = AtomicInteger(-1)
    return jsMutex.withLock {
      // Cleared before the task starts; JS sets it (reportHeadlessResult) right before resolving.
      RefreshOutcome.reset()
      var listener: HeadlessJsTaskEventListener? = null
      try {
        suspendCancellableCoroutine<Unit> { cont ->
          val l = object : HeadlessJsTaskEventListener {
            override fun onHeadlessJsTaskStart(taskId: Int) = Unit

            // Posted to the main thread after startTask returned, so startedTaskId is already set.
            override fun onHeadlessJsTaskFinish(taskId: Int) {
              if (taskId == startedTaskId.get() && cont.isActive) cont.resume(Unit)
            }
          }
          listener = l
          taskContext.addTaskEventListener(l)
          startedTaskId.set(taskContext.startTask(HeadlessJsTaskConfig(taskKey, Arguments.createMap(), jsTimeoutMs, true)))
        }
      } finally {
        listener?.let { taskContext.removeTaskEventListener(it) }
      }
      RefreshOutcome.succeeded()
    }
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
}
