package expo.modules.qashywidgets

import android.R.color as sys
import android.content.Context
import android.os.Build
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
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
  val onAccent: Color,
  val positive: Color,
  val negative: Color,
) {
  /** The accent's deeper shade: what a budget's overflow lap is drawn in on top of the first lap. */
  val accentDeep: Color get() = WidgetTheme.deepen(accent, background)
}

/**
 * The colors a widget draws with, after mode, theme and background choice. In "system" mode each
 * one is a day/night pair the launcher resolves itself, so a dark-mode toggle needs no re-render.
 */
class WidgetColors(
  val background: ColorProvider,
  val text: ColorProvider,
  val muted: ColorProvider,
  val accent: ColorProvider,
  /** What is drawn on top of a surface filled with [accent]. */
  val onAccent: ColorProvider,
  val positive: ColorProvider,
  val negative: ColorProvider,
  /** The accent's deeper shade, for the overflow lap of a meter that is past 100%. */
  val accentDeep: ColorProvider,
  /** A soft shadow (a translucent black) for the overflow lap's leading end. */
  val shadow: ColorProvider,
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
      fun pair(withAlpha: Float = 1f, pick: (ColorSet) -> Color) = DayNightColorProvider(
        day = pick(day).copy(alpha = withAlpha),
        night = pick(night).copy(alpha = withAlpha),
      )
      return WidgetColors(
        pair(alpha) { it.background }, pair { it.text }, pair { it.muted },
        pair { it.accent }, pair { it.onAccent }, pair { it.positive }, pair { it.negative },
        pair { it.accentDeep },
        DayNightColorProvider(day = Color.Black.copy(alpha = SHADOW_DAY), night = Color.Black.copy(alpha = SHADOW_NIGHT)),
      )
    }
    val c = set(style.mode == "dark")
    return WidgetColors(
      ColorProvider(c.background.copy(alpha = alpha)), ColorProvider(c.text), ColorProvider(c.muted),
      ColorProvider(c.accent), ColorProvider(c.onAccent), ColorProvider(c.positive), ColorProvider(c.negative),
      ColorProvider(c.accentDeep),
      ColorProvider(Color.Black.copy(alpha = if (style.mode == "dark") SHADOW_NIGHT else SHADOW_DAY)),
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
      // The status colors are tuned for the surface and unreadable on the accent (red on blue), so
      // amounts take the text color here; their sign still says income from expense.
      ColorSet(
        Color(p.accent), Color(p.onAccent), Color(p.onAccent).copy(alpha = 0.78f), Color(p.onAccent),
        Color(p.accent), Color(p.onAccent), Color(p.onAccent),
      )
    } else {
      ColorSet(
        Color(p.background), Color(p.text), Color(p.textMuted), Color(p.accent),
        Color(p.onAccent), Color(p.positive), Color(p.negative),
      )
    }

  /** Material You tones from the system palette; positive/negative stay the app's own. */
  private fun dynamicColors(context: Context, night: Boolean, accentBg: Boolean, p: Palette): ColorSet {
    fun c(id: Int) = Color(context.getColor(id))
    return when {
      accentBg && night -> ColorSet(
        c(sys.system_accent1_700), c(sys.system_accent1_100), c(sys.system_accent1_200), c(sys.system_accent1_100),
        c(sys.system_accent1_700), Color(p.positive), Color(p.negative),
      )
      accentBg -> ColorSet(
        c(sys.system_accent1_100), c(sys.system_accent1_900), c(sys.system_accent1_700), c(sys.system_accent1_700),
        c(sys.system_accent1_100), Color(p.positive), Color(p.negative),
      )
      night -> ColorSet(
        c(sys.system_neutral1_900), c(sys.system_neutral1_100), c(sys.system_neutral2_300), c(sys.system_accent1_200),
        c(sys.system_accent1_800), Color(p.positive), Color(p.negative),
      )
      else -> ColorSet(
        c(sys.system_neutral1_10), c(sys.system_neutral1_900), c(sys.system_neutral2_700), c(sys.system_accent1_600),
        c(sys.system_accent1_0), Color(p.positive), Color(p.negative),
      )
    }
  }

  /** Opacity of the overflow shadow on a light and on a dark surface (the dark one needs more to show). */
  private const val SHADOW_DAY = 0.42f
  private const val SHADOW_NIGHT = 0.8f

  /**
   * A deeper shade of [accent] for the overflow lap of a meter, in the same hue so it reads as
   * "more of the same". On a light surface the accent is a mid or dark color and the shade is the
   * same color darkened; on a dark surface the accent is a pale tint, and the shade is a richer,
   * more saturated and darker version of it that still shows against the surface.
   */
  internal fun deepen(accent: Color, background: Color): Color {
    val hsv = FloatArray(3)
    android.graphics.Color.colorToHSV(accent.toArgb(), hsv)
    val darkSurface = background.luminance() < 0.5f
    when {
      // Already dark (text on an accent surface): a darker shade would vanish into the lap, so
      // the "deeper" one is the lighter step.
      hsv[2] < 0.4f -> hsv[2] = (hsv[2] + 0.38f).coerceAtMost(1f)
      // White or gray (text on an accent surface): only the value can move.
      hsv[1] < 0.15f -> hsv[2] *= 0.6f
      darkSurface -> {
        hsv[1] = (hsv[1] + 0.4f).coerceAtMost(1f)
        hsv[2] = (hsv[2] * 0.72f).coerceIn(0.45f, 0.8f)
      }
      else -> {
        hsv[1] = (hsv[1] * 1.08f + 0.06f).coerceAtMost(1f)
        hsv[2] = hsv[2] * 0.6f
      }
    }
    return Color(android.graphics.Color.HSVToColor(hsv)).copy(alpha = accent.alpha)
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
