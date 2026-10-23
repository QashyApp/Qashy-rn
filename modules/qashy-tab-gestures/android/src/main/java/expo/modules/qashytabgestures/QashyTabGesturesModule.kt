package expo.modules.qashytabgestures

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import com.google.android.material.navigation.NavigationBarView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * Reports long presses on the items of Android's native bottom navigation bar, using only public
 * Android and Material APIs. It replaces a patch to react-native-screens: nothing inside a library
 * is modified, the bar is found in the activity's view hierarchy instead.
 *
 * Material's bar installs a long-click listener on each item to show a tooltip, and installs it
 * again whenever an item's title or content description changes, which replaces ours. The bar is
 * rebuilt mid-session (react-native-screens updates titles and descriptions as its tabs change,
 * and the navigator can be swapped and swapped back), and react-native-screens and Fabric lay
 * views out directly, which does not fire the window's global-layout event. So the listeners are
 * put back from a pre-draw listener on the decor view instead: it runs before every frame the
 * window draws, however the layout happened. Each pass is a handful of `setOnLongClickListener`
 * calls on listeners made once per item, and the view tree is searched again only when the cached
 * bar is gone or no longer shown, at most every [SEARCH_INTERVAL_MS] (a screen pushed over the tabs
 * hides the bar for as long as it is open, and the tree is not walked on every one of its frames).
 * Ours also suppresses the tooltip, which is wanted: the long press opens the "Navigation bar
 * style" sheet instead, and returning true gives the system long-press haptic.
 *
 * Everything that touches the state runs on the UI thread, in the order it was requested, so an
 * attach right after a detach (or the reverse) cannot leave a listener removed or a stale bar cached.
 */
class QashyTabGesturesModule : Module() {
  // UI thread only.
  private var host: WeakReference<Activity>? = null
  private var bar: WeakReference<NavigationBarView>? = null
  private var lastSearchAt = 0L
  private val longClickListeners = mutableListOf<View.OnLongClickListener>()
  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    installListeners()
    true
  }
  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var observing = false

  override fun definition() = ModuleDefinition {
    Name("QashyTabGestures")

    Events("onTabLongPress")

    OnStartObserving {
      observing = true
      attach()
    }

    OnStopObserving {
      observing = false
      detach()
    }

    // An activity that was recreated (rotation, theme change) has a new view tree.
    OnActivityEntersForeground {
      if (observing) attach()
    }

    OnDestroy {
      detach()
    }
  }

  private fun attach() {
    val activity = appContext.currentActivity ?: return
    onMain {
      detachNow()
      host = WeakReference(activity)
      val decor = activity.window?.decorView ?: return@onMain
      decor.viewTreeObserver.addOnPreDrawListener(preDrawListener)
      installListeners()
    }
  }

  private fun detach() {
    // Queued behind any earlier attach, so it cannot be overtaken by it (and `host` is only read there).
    onMain { detachNow() }
  }

  /** Runs now on the UI thread, otherwise queues on it; calls from one thread keep their order. */
  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  private fun detachNow() {
    val activity = host?.get()
    host = null
    bar = null
    lastSearchAt = 0L
    val observer = activity?.window?.decorView?.viewTreeObserver
    if (observer != null && observer.isAlive) observer.removeOnPreDrawListener(preDrawListener)
  }

  private fun installListeners() {
    val navigationBar = currentBar() ?: return
    val menu = navigationBar.menu
    for (index in 0 until menu.size()) {
      val item = navigationBar.findViewById<View>(menu.getItem(index).itemId) ?: continue
      item.setOnLongClickListener(longClickListener(index))
    }
  }

  private fun longClickListener(index: Int): View.OnLongClickListener {
    while (longClickListeners.size <= index) {
      val position = longClickListeners.size
      longClickListeners.add(
        View.OnLongClickListener {
          sendEvent("onTabLongPress", mapOf("index" to position))
          true
        },
      )
    }
    return longClickListeners[index]
  }

  private fun currentBar(): NavigationBarView? {
    val cached = bar?.get()?.takeIf { it.isAttachedToWindow }
    if (cached != null && cached.isShown) return cached
    val now = SystemClock.uptimeMillis()
    if (lastSearchAt != 0L && now - lastSearchAt < SEARCH_INTERVAL_MS) return cached
    lastSearchAt = now
    val root = host?.get()?.window?.decorView ?: return null
    val found = findBar(root, shownOnly = true) ?: findBar(root, shownOnly = false)
    bar = found?.let { WeakReference(it) }
    return found
  }

  private fun findBar(view: View, shownOnly: Boolean): NavigationBarView? {
    if (view is NavigationBarView && (!shownOnly || view.isShown)) return view
    if (view !is ViewGroup) return null
    for (index in 0 until view.childCount) {
      findBar(view.getChildAt(index), shownOnly)?.let { return it }
    }
    return null
  }

  private companion object {
    const val SEARCH_INTERVAL_MS = 500L
  }
}
