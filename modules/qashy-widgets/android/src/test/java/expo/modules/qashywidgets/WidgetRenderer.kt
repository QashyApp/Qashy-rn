package expo.modules.qashywidgets

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.compose.ui.unit.DpSize
import androidx.glance.GlanceId
import androidx.glance.appwidget.compose
import androidx.glance.appwidget.composeForPreview
import kotlinx.coroutines.runBlocking
import java.io.File
import java.io.FileOutputStream
import kotlin.math.roundToInt

/**
 * Renders a widget's Glance content to a bitmap on the JVM: `GlanceAppWidget.compose` for an exact
 * size, then `RemoteViews.apply` into a real view tree, measured and laid out at the exact pixel
 * size and drawn with Robolectric's native graphics.
 *
 * Fidelity: layout, text wrapping and clipping, images, tints, the day/night colors and RTL are
 * the framework's own code, so what clips here clips on a device. Glyph shapes come from the
 * fonts Robolectric ships (Roboto-like, with no Hebrew face, so Hebrew text is drawn with
 * fallback boxes but is measured by the fallback font); the launcher's rounded-corner clipping and
 * the real wallpaper are not reproduced, so the widget sits on a flat neutral backdrop instead.
 */
internal object WidgetRenderer {
  /** The widget id every test snapshot is addressed to. */
  const val APP_WIDGET_ID = 7

  class Result(val bitmap: Bitmap, val problems: List<String>, val texts: List<String>)

  /** Glance's `AppWidgetId` is internal to its module; a test needs one with a chosen id. */
  private fun glanceId(appWidgetId: Int): GlanceId =
    Class.forName("androidx.glance.appwidget.AppWidgetId")
      .getConstructor(Int::class.javaPrimitiveType)
      .newInstance(appWidgetId) as GlanceId

  fun render(context: Context, widget: QashyWidget, size: DpSize, rtl: Boolean, night: Boolean, preview: Boolean = false, textScaleX: Float = 1f): Result {
    val views = runBlocking {
      if (preview) {
        widget.composeForPreview(context, android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN)
      } else {
        widget.compose(context, glanceId(APP_WIDGET_ID), size = size)
      }
    }
    val density = context.resources.displayMetrics.density
    val w = (size.width.value * density).roundToInt()
    val h = (size.height.value * density).roundToInt()

    val root = FrameLayout(context)
    root.layoutDirection = if (rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
    val view = views.apply(context, root)
    // Emulates an OEM font that is wider than the one the layouts measure with.
    if (textScaleX != 1f) widen(view, textScaleX)
    root.addView(view, FrameLayout.LayoutParams(w, h))
    root.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
    root.layout(0, 0, w, h)

    val margin = (12 * density).roundToInt()
    val out = Bitmap.createBitmap(w + 2 * margin, h + 2 * margin, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(if (night) 0xFF2A2B33.toInt() else 0xFFCBD0D9.toInt())
    canvas.translate(margin.toFloat(), margin.toFloat())
    root.draw(canvas)
    return Result(out, problems(root, density), texts(root))
  }

  private fun widen(v: View, scaleX: Float) {
    if (v is TextView) v.textScaleX = scaleX
    if (v is ViewGroup) for (i in 0 until v.childCount) widen(v.getChildAt(i), scaleX)
  }

  /** The text of every TextView in the widget. */
  private fun texts(v: View): List<String> =
    (if (v is TextView && v.text.isNotEmpty()) listOf(v.text.toString()) else emptyList()) +
      (if (v is ViewGroup) (0 until v.childCount).flatMap { texts(v.getChildAt(it)) } else emptyList())

  /** What is clipped or sticks out: a text wider than its box, or any view outside the widget. */
  private fun problems(root: View, density: Float): List<String> {
    val found = mutableListOf<String>()
    val bounds = Rect(0, 0, root.width, root.height)
    fun visit(v: View, origin: Rect) {
      val abs = Rect(origin.left + v.left, origin.top + v.top, origin.left + v.right, origin.top + v.bottom)
      if (v !== root && v.visibility == View.VISIBLE) {
        if (abs.left < bounds.left - 1 || abs.top < bounds.top - 1 || abs.right > bounds.right + 1 || abs.bottom > bounds.bottom + 1) {
          found += "${describe(v)} sticks out of the widget: $abs in $bounds"
        }
        if (v is TextView && v.text.isNotEmpty()) {
          val layout = v.layout
          val room = v.width - v.compoundPaddingLeft - v.compoundPaddingRight
          if (layout != null) {
            val widest = (0 until layout.lineCount).maxOf { layout.getLineWidth(it) }
            if (widest > room + 1) found += "\"${v.text}\" is ${(widest / density).roundToInt()}dp wide in ${(room / density).roundToInt()}dp"
            // The TextView's own ellipsis, or ours on something with figures in it: an amount was cut.
            if ((0 until layout.lineCount).any { layout.getEllipsisCount(it) > 0 }) found += "\"${v.text}\" is ellipsized by the TextView"
            if (v.text.any { it in "$₪•" } && v.text.contains('…')) found += "\"${v.text}\" has an ellipsis"
            if (layout.lineCount > 1 && v.maxLines == 1) found += "\"${v.text}\" wraps"
            if (v.height > 0 && layout.height > v.height - v.compoundPaddingTop - v.compoundPaddingBottom + 1) {
              found += "\"${v.text}\" is ${(layout.height / density).roundToInt()}dp tall in ${(v.height / density).roundToInt()}dp"
            }
          }
        }
      }
      if (v is ViewGroup) for (i in 0 until v.childCount) visit(v.getChildAt(i), Rect(abs.left, abs.top, abs.right, abs.bottom))
    }
    visit(root, Rect(0, 0, 0, 0))
    return found
  }

  private fun describe(v: View): String =
    if (v is TextView) "text \"${v.text}\"" else v.javaClass.simpleName

  fun writePng(bitmap: Bitmap, file: File) {
    file.parentFile?.mkdirs()
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
  }

  /** A grid of titled bitmaps, [columns] wide, for reading many sizes at a glance. */
  fun sheet(title: String, tiles: List<Pair<String, Bitmap>>, columns: Int, bg: Int): Bitmap {
    val pad = 24
    val titleHeight = 48
    val cellW = tiles.maxOf { it.second.width } + pad
    val rows = (tiles.size + columns - 1) / columns
    val rowHeights = (0 until rows).map { r ->
      tiles.drop(r * columns).take(columns).maxOf { it.second.height } + titleHeight
    }
    val out = Bitmap.createBitmap(columns * cellW + pad, rowHeights.sum() + pad * (rows + 1) + titleHeight, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(bg)
    val ink = if (Color.luminance(bg) > 0.5f) Color.BLACK else Color.WHITE
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ink; textSize = 28f; typeface = Typeface.DEFAULT_BOLD }
    canvas.drawText(title, pad.toFloat(), 36f, paint)
    paint.typeface = Typeface.DEFAULT
    paint.textSize = 22f
    var y = pad + titleHeight
    for (r in 0 until rows) {
      tiles.drop(r * columns).take(columns).forEachIndexed { c, (label, bitmap) ->
        val x = pad + c * cellW
        canvas.drawText(label, x.toFloat(), (y + 22).toFloat(), paint)
        canvas.drawBitmap(bitmap, x.toFloat(), (y + 30).toFloat(), null)
      }
      y += rowHeights[r] + pad
    }
    return out
  }
}
