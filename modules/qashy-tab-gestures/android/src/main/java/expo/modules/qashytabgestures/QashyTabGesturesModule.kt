package expo.modules.qashytabgestures

import android.app.Activity
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
 * again whenever an item's title or content description changes, which would replace ours. So the
 * listeners are put back after every layout pass (a handful of `setOnLongClickListener` calls, and
 * the view tree is only searched when the bar has not been found yet). Ours also suppresses the
 * tooltip, which is wanted: the long press opens the "Navigation bar style" sheet instead.
 */
class QashyTabGesturesModule : Module() {
  private var host: WeakReference<Activity>? = null
  private var bar: WeakReference<NavigationBarView>? = null
  private var observing = false
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { installListeners() }

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
    activity.runOnUiThread {
      detach()
      host = WeakReference(activity)
      val decor = activity.window?.decorView ?: return@runOnUiThread
      decor.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
      installListeners()
    }
  }

  private fun detach() {
    val activity = host?.get() ?: return
    host = null
    activity.runOnUiThread {
      val observer = activity.window?.decorView?.viewTreeObserver
      if (observer != null && observer.isAlive) observer.removeOnGlobalLayoutListener(layoutListener)
      bar = null
    }
  }

  private fun installListeners() {
    val navigationBar = currentBar() ?: return
    val menu = navigationBar.menu
    for (index in 0 until menu.size()) {
      val item = navigationBar.findViewById<View>(menu.getItem(index).itemId) ?: continue
      item.setOnLongClickListener {
        sendEvent("onTabLongPress", mapOf("index" to index))
        true
      }
    }
  }

  private fun currentBar(): NavigationBarView? {
    bar?.get()?.let { if (it.isAttachedToWindow) return it }
    val root = host?.get()?.window?.decorView ?: return null
    val found = findBar(root)
    bar = found?.let { WeakReference(it) }
    return found
  }

  private fun findBar(view: View): NavigationBarView? {
    if (view is NavigationBarView) return view
    if (view !is ViewGroup) return null
    for (index in 0 until view.childCount) {
      findBar(view.getChildAt(index))?.let { return it }
    }
    return null
  }
}
