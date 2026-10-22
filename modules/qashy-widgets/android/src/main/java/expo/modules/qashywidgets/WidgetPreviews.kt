package expo.modules.qashywidgets

import android.appwidget.AppWidgetProviderInfo
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.collection.intSetOf
import androidx.glance.appwidget.GlanceAppWidgetManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The strings the picker previews are drawn with: fixed sample text, never the user's data. */
internal fun sampleLabels(context: Context) = Labels(
  netWorth = context.getString(R.string.qashy_preview_label_net_worth),
  spent = context.getString(R.string.qashy_preview_label_spent),
  earned = context.getString(R.string.qashy_preview_label_earned),
  add = context.getString(R.string.qashy_preview_label_add),
  openApp = context.getString(R.string.qashy_widget_open_app),
)

/**
 * Publishes each kind's picker preview (Android 15+; older versions use the provider's
 * `previewLayout` / `previewImage`). Publishing is rate limited by the system and not free, so a
 * preview is rebuilt only when what it is drawn from may have changed: the preview visuals
 * ([PREVIEW_VERSION]), the app version, or the language. Those, and nothing about the user's
 * finances, are the only thing stored, in a private preferences file.
 */
object WidgetPreviews {
  /** Bump when a kind's preview visuals or sample strings change. */
  const val PREVIEW_VERSION = 3

  private const val PREFS = "qashy_widget_previews"
  private const val TAG = "QashyWidgets"

  enum class Result(val id: String) {
    UNSUPPORTED("unsupported"),
    UNCHANGED("unchanged"),
    REGISTERED("registered"),
    RATE_LIMITED("rateLimited"),
    FAILED("failed"),
  }

  /** Never throws: a failure is a result, and the next launch tries again. */
  suspend fun register(context: Context): Result {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return Result.UNSUPPORTED
    return try {
      withContext(Dispatchers.Default) { registerApi35(context.applicationContext) }
    } catch (e: Exception) {
      // The class name only: a message could echo something it should not.
      Log.w(TAG, "Widget previews were not registered (${e.javaClass.simpleName})")
      Result.FAILED
    }
  }

  /** What the previews were last built for, as a stable string. */
  private fun stamp(context: Context): String {
    val versionCode = try {
      context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode
    } catch (e: Exception) {
      0L
    }
    return "$PREVIEW_VERSION|$versionCode|${context.resources.configuration.locales.toLanguageTags()}"
  }

  @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
  private suspend fun registerApi35(context: Context): Result {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val current = stamp(context)
    val manager = GlanceAppWidgetManager(context)
    var result = Result.UNCHANGED
    for (kind in WidgetKinds.all) {
      val key = "preview.${kind.id}"
      if (prefs.getString(key, null) == current) continue
      val outcome = manager.setWidgetPreviews(
        kind.receiver.kotlin,
        intSetOf(AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN),
      )
      if (outcome == GlanceAppWidgetManager.SET_WIDGET_PREVIEWS_RESULT_SUCCESS) {
        prefs.edit().putString(key, current).apply()
        if (result != Result.RATE_LIMITED) result = Result.REGISTERED
      } else {
        // Left unstamped, so a later launch retries it.
        result = Result.RATE_LIMITED
      }
    }
    return result
  }
}
