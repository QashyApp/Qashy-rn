package expo.modules.qashydynamiccolors

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads Android 12+ system tonal palettes (the wallpaper-derived "Material You" colors) as hex
 * strings, so the JS theme engine can derive tokens from them like from any seed. Read-only,
 * no permissions, no data leaves the device.
 */
class QashyDynamicColorsModule : Module() {
  private val palettes = listOf("accent1", "accent2", "accent3", "neutral1", "neutral2")
  private val shades = listOf("0", "10", "50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000")

  override fun definition() = ModuleDefinition {
    Name("QashyDynamicColors")

    Function("isAvailable") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.S }

    // { accent1: { "0": "#FFFFFF", "10": "...", ... }, accent2: ..., neutral2: ... } or null below Android 12.
    Function("getPalettes") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function null
      val context = appContext.reactContext ?: return@Function null
      val resources = context.resources
      val theme = context.theme
      val result = HashMap<String, Map<String, String>>()
      for (palette in palettes) {
        val tones = HashMap<String, String>()
        for (shade in shades) {
          val id = resources.getIdentifier("system_${palette}_$shade", "color", "android")
          if (id == 0) return@Function null
          val color = resources.getColor(id, theme)
          tones[shade] = String.format("#%06X", color and 0xFFFFFF)
        }
        result[palette] = tones
      }
      result
    }
  }
}
