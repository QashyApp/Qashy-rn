package expo.modules.qashywidgets

import android.content.Context
import android.graphics.Typeface
import android.text.TextPaint
import android.util.TypedValue
import androidx.compose.ui.unit.Dp

/**
 * Measures widget text so a layout can choose what fits instead of letting a TextView cut it off.
 * Glance's Text is a plain TextView without an ellipsis, so a label that is too long would simply
 * stop at the edge. Everything here works in dp and uses the system font at the user's font scale,
 * with a small margin because the launcher may draw with a slightly different face.
 */
internal class TextFit(context: Context) {
  private val metrics = context.resources.displayMetrics
  private val regular = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.DEFAULT }
  private val bold = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.DEFAULT_BOLD }

  /** The width of [text] in dp. */
  fun width(text: String, sp: Int, isBold: Boolean = false): Float {
    val paint = if (isBold) bold else regular
    paint.textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp.toFloat(), metrics)
    return (paint.measureText(text) / metrics.density) * MARGIN + 1f
  }

  fun fits(text: String, sp: Int, isBold: Boolean, max: Dp): Boolean = width(text, sp, isBold) <= max.value

  /** [text], or its longest prefix with an ellipsis that fits in [max]. */
  fun ellipsize(text: String, sp: Int, isBold: Boolean, max: Dp): String {
    if (fits(text, sp, isBold, max)) return text
    var end = text.length
    while (end > 0) {
      end--
      val cut = text.substring(0, end).trimEnd() + ELLIPSIS
      if (fits(cut, sp, isBold, max)) return cut
    }
    return ELLIPSIS
  }

  /** [full] when it fits in [max], else [compact] (which is cut with an ellipsis if it still does not). */
  fun amount(full: String, compact: String, sp: Int, isBold: Boolean, max: Dp): String =
    if (fits(full, sp, isBold, max)) full else ellipsize(compact, sp, isBold, max)

  /** The largest size from [maxSp] down to [minSp] at which [text] fits in [max]. */
  fun largestSp(text: String, isBold: Boolean, maxSp: Int, minSp: Int, max: Dp): Int {
    var sp = maxSp
    while (sp > minSp && !fits(text, sp, isBold, max)) sp--
    return sp
  }

  private companion object {
    const val MARGIN = 1.05f
    const val ELLIPSIS = "…"
  }
}
