package expo.modules.qashywidgets

import android.R.color as sys
import android.content.Context
import android.os.Build
import androidx.compose.ui.graphics.Color
import androidx.glance.color.ColorProvider as DayNightColorProvider
import androidx.glance.unit.ColorProvider
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Plain colors for one appearance (light or dark). */
internal class ColorSet(
  val background: Color,
  val text: Color,
  val muted: Color,
  val accent: Color,
  val positive: Color,
  val negative: Color,
)

/**
 * The colors a widget draws with, after mode, theme and background choice. In "system" mode each
 * one is a day/night pair the launcher resolves itself, so a dark-mode toggle needs no re-render.
 */
class WidgetColors(
  val background: ColorProvider,
  val text: ColorProvider,
  val muted: ColorProvider,
  val accent: ColorProvider,
  val positive: ColorProvider,
  val negative: ColorProvider,
) {
  fun tone(tone: String): ColorProvider = when (tone) {
    "positive" -> positive
    "negative" -> negative
    else -> text
  }
}

object WidgetTheme {
  private val FALLBACK_LIGHT = Palette(
    0xFFFFFFFF.toInt(), 0xFF1B1B1F.toInt(), 0xFF5F6169.toInt(), 0xFF5070FF.toInt(),
    0xFFFFFFFF.toInt(), 0xFF1B7F4B.toInt(), 0xFFB3261E.toInt(), 0xFFD9D9E0.toInt(),
  )
  private val FALLBACK_DARK = Palette(
    0xFF121221.toInt(), 0xFFEDEDF4.toInt(), 0xFFA8AAB5.toInt(), 0xFF9DB0FF.toInt(),
    0xFF121221.toInt(), 0xFF5FD39A.toInt(), 0xFFFF8A80.toInt(), 0xFF3A3A4D.toInt(),
  )

  /** Used when there is no data for the widget (nothing to read a style from). */
  val DEFAULT_STYLE = WidgetStyle("qashy", "system", "surface", 100, false, FALLBACK_LIGHT, FALLBACK_DARK)

  fun resolve(context: Context, style: WidgetStyle): WidgetColors {
    val alpha = style.opacity / 100f
    fun set(night: Boolean) = colorSet(context, style, night)
    if (style.mode == "system") {
      val day = set(false)
      val night = set(true)
      fun pair(pick: (ColorSet) -> Color, withAlpha: Float = 1f) = DayNightColorProvider(
        day = pick(day).copy(alpha = withAlpha),
        night = pick(night).copy(alpha = withAlpha),
      )
      return WidgetColors(
        pair({ it.background }, alpha), pair { it.text }, pair { it.muted },
        pair { it.accent }, pair { it.positive }, pair { it.negative },
      )
    }
    val c = set(style.mode == "dark")
    return WidgetColors(
      ColorProvider(c.background.copy(alpha = alpha)), ColorProvider(c.text), ColorProvider(c.muted),
      ColorProvider(c.accent), ColorProvider(c.positive), ColorProvider(c.negative),
    )
  }

  private fun colorSet(context: Context, style: WidgetStyle, night: Boolean): ColorSet {
    val p = if (night) style.dark else style.light
    val accentBg = style.background == "accent"
    val dynamic = style.theme == "materialYou" && style.background != "custom" &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    return if (dynamic) dynamicColors(context, night, accentBg, p) else fromPalette(p, accentBg)
  }

  private fun fromPalette(p: Palette, accentBg: Boolean): ColorSet =
    if (accentBg) {
      ColorSet(
        Color(p.accent), Color(p.onAccent), Color(p.onAccent).copy(alpha = 0.78f), Color(p.onAccent),
        Color(p.positive), Color(p.negative),
      )
    } else {
      ColorSet(
        Color(p.background), Color(p.text), Color(p.textMuted), Color(p.accent),
        Color(p.positive), Color(p.negative),
      )
    }

  /** Material You tones from the system palette; positive/negative stay the app's own. */
  private fun dynamicColors(context: Context, night: Boolean, accentBg: Boolean, p: Palette): ColorSet {
    fun c(id: Int) = Color(context.getColor(id))
    return when {
      accentBg && night -> ColorSet(
        c(sys.system_accent1_700), c(sys.system_accent1_100), c(sys.system_accent1_200), c(sys.system_accent1_100),
        Color(p.positive), Color(p.negative),
      )
      accentBg -> ColorSet(
        c(sys.system_accent1_100), c(sys.system_accent1_900), c(sys.system_accent1_700), c(sys.system_accent1_700),
        Color(p.positive), Color(p.negative),
      )
      night -> ColorSet(
        c(sys.system_neutral1_900), c(sys.system_neutral1_100), c(sys.system_neutral2_300), c(sys.system_accent1_200),
        Color(p.positive), Color(p.negative),
      )
      else -> ColorSet(
        c(sys.system_neutral1_10), c(sys.system_neutral1_900), c(sys.system_neutral2_700), c(sys.system_accent1_600),
        Color(p.positive), Color(p.negative),
      )
    }
  }

  /** The system's app widget corner radius (API 31+), else 16dp. */
  fun radius(context: Context): Dp {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val px = context.resources.getDimension(android.R.dimen.system_app_widget_background_radius)
      if (px > 0f) return (px / context.resources.displayMetrics.density).dp
    }
    return 16.dp
  }
}
