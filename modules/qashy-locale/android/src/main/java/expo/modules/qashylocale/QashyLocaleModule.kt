package expo.modules.qashylocale

import android.content.res.Configuration
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.app.LocaleManagerCompat
import androidx.core.os.LocaleListCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

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

    // Reads string resources (res/values*/strings.xml) in a specific locale, independent of the
    // app's current locale. A missing name gives null; a locale without translations falls back to
    // the default (English) value, as Android resource lookup does. Runs on the default
    // (background) queue.
    AsyncFunction("getStrings") { names: List<String>, localeTag: String ->
      val context = appContext.reactContext?.applicationContext
        ?: return@AsyncFunction names.map<String, String?> { null }
      // Resources live under the package aapt2 compiled them with, which differs from
      // packageName when an applicationIdSuffix is set. The app label is a known resource
      // (@string/app_name), so ask it; fall back to packageName if it is not a resource.
      val labelRes = context.applicationInfo.labelRes
      val labelPackage: String? =
        if (labelRes == 0) null
        else runCatching { context.resources.getResourcePackageName(labelRes) }.getOrNull()
      val resourcePackage: String = labelPackage ?: context.packageName
      val configuration = Configuration(context.resources.configuration)
      configuration.setLocale(Locale.forLanguageTag(localeTag))
      val localized = context.createConfigurationContext(configuration)
      names.map<String, String?> { name ->
        val id = localized.resources.getIdentifier(name, "string", resourcePackage)
        if (id == 0) null else localized.getString(id)
      }
    }

    // The system (not per-app) locale list, comma-separated BCP-47 tags.
    Function("getSystemLocales") {
      val context = appContext.reactContext ?: return@Function ""
      LocaleManagerCompat.getSystemLocales(context).toLanguageTags()
    }
  }
}
