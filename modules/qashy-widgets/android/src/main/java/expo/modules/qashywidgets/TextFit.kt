package expo.modules.qashywidgets

import android.content.Context
import android.graphics.Typeface
import android.text.TextPaint
import android.util.TypedValue
import androidx.compose.ui.unit.Dp

/** An amount in its two lengths, "$12,480.00" and "$12.5K". */
internal class Amount(val full: String, val compact: String)

/**
 * What to draw for a group of amounts: all of them compact or all of them full, at one size.
 * Decided once per layout by [TextFit.plan], never per amount, so figures side by side always use
 * the same form and size.
 */
internal class AmountPlan(val compact: Boolean, val sp: Int) {
  fun text(amount: Amount): String = if (compact) amount.compact else amount.full
}

/**
 * Measures widget text so a layout can choose what fits instead of letting a TextView cut it off.
 * Glance's Text is a plain TextView, which draws an ellipsis when it is too narrow, so nothing may
 * ever be left to overflow.
 *
 * Measured the way it is rendered: the default sans-serif at regular or bold weight (what Glance
 * sets for a normal and a bold font weight), the size in sp through the display metrics, which
 * apply the user's font scale (nonlinearly on Android 14+), and no letter spacing. Widths come out
 * in dp. Because an OEM font (Samsung One UI Sans) can be wider than the default one and a
 * launcher can give a widget less room than it reports, every width is inflated by [MARGIN] (15%).
 * The widths layouts measure against come from [WidgetSizes.fitSize], the smaller of the layout's
 * breakpoint and what the launcher reports, minus every padding, spacer and fixed sibling.
 */
internal class TextFit(context: Context) {
  private val metrics = context.resources.displayMetrics
  private val regular = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.DEFAULT }
  private val bold = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.DEFAULT_BOLD }

  /** The width of [text] in dp, with the safety margin. */
  fun width(text: String, sp: Int, isBold: Boolean = false): Float {
    val paint = if (isBold) bold else regular
    paint.textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp.toFloat(), metrics)
    return (paint.measureText(text) / metrics.density) * MARGIN + 1f
  }

  /** The height of one line of text in dp (no margin). */
  fun lineHeight(sp: Int, isBold: Boolean = false): Float {
    val paint = if (isBold) bold else regular
    paint.textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp.toFloat(), metrics)
    val m = paint.fontMetrics
    return (m.descent - m.ascent) / metrics.density
  }

  fun fits(text: String, sp: Int, isBold: Boolean, max: Dp): Boolean = width(text, sp, isBold) <= max.value

  /** For a label or a name only, never an amount: [text], or its longest prefix with an ellipsis that fits in [max]. */
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

  /**
   * One decision for amounts that share a layout, each with the room [widths] gives it (same
   * order). Full at [preferredSp] if every amount fits; else all compact at that size; else all
   * compact at smaller sizes down to [minSp]; else all compact at [minSp], where the TextView is
   * the last resort and clips.
   */
  fun plan(amounts: List<Amount>, widths: List<Dp>, preferredSp: Int, isBold: Boolean = true, minSp: Int = MIN_AMOUNT_SP): AmountPlan {
    fun fitsAll(compact: Boolean, sp: Int) = amounts.indices.all { i ->
      fits(if (compact) amounts[i].compact else amounts[i].full, sp, isBold, widths[i])
    }
    if (fitsAll(false, preferredSp)) return AmountPlan(false, preferredSp)
    var sp = preferredSp
    while (sp >= minSp) {
      if (fitsAll(true, sp)) return AmountPlan(true, sp)
      sp--
    }
    return AmountPlan(true, minOf(preferredSp, minSp))
  }

  /** The largest size from [maxSp] down to [minSp] at which [text] fits in [max]. */
  fun largestSp(text: String, isBold: Boolean, maxSp: Int, minSp: Int, max: Dp): Int {
    var sp = maxSp
    while (sp > minSp && !fits(text, sp, isBold, max)) sp--
    return sp
  }

  companion object {
    const val MARGIN = 1.15f
    const val MIN_AMOUNT_SP = 10
    private const val ELLIPSIS = "…"
  }
}
