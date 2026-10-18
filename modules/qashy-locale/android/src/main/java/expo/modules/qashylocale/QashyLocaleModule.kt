package expo.modules.qashylocale

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.core.os.LocaleManagerCompat
import expo.modules.kotlin.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads and writes the per-app language through AppCompat (Android's per-app language
 * preference, shown in system settings on 13+). Local only; no permissions, no data leaves
 * the device.
 */
class QashyLocaleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QashyLocale")

    // BCP-47 tags of the per-app locale list, comma-separated. "" means follow the system.
    Function("getApplicationLocales") {
      AppCompatDelegate.getApplicationLocales().toLanguageTags()
    }

    // "" resets to the system default. AppCompat requires the main thread.
    AsyncFunction("setApplicationLocales") { tags: String ->
      AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tags))
    }.runOnQueue(Queues.MAIN)

    // The system (not per-app) locale list, comma-separated BCP-47 tags.
    Function("getSystemLocales") {
      val context = appContext.reactContext ?: return@Function ""
      LocaleManagerCompat.getSystemLocales(context).toLanguageTags()
    }
  }
}
