package expo.modules.qashywidgets

import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The layers of one meter, each a white mask that a Glance Image tints with its own (day/night)
 * color, so a dark-mode toggle needs no re-render. Stacked in a Box, bottom first:
 *
 *  - [base]: the faint track and the first lap (the fill up to 100%), tinted with the accent;
 *  - [shadow]: a soft shadow at the leading end of the overflow, tinted with translucent black;
 *  - [overflow]: the second lap past 100%, tinted with the accent's deeper shade.
 *
 * [shadow] and [overflow] are null while spending is within the limit.
 */
class MeterLayers(val base: Bitmap, val shadow: Bitmap?, val overflow: Bitmap?)

/**
 * The budget widget's ring and bar.
 *
 * Past the limit the meter works like an activity ring that has been closed and keeps going: the
 * first lap stays fully drawn, and the part beyond 100% is drawn on top of it from the start in a
 * deeper shade, with a soft shadow where it ends so it reads as lying above the first lap. A lap
 * is capped at a full second lap for 200% and over. A small gap cut through every layer marks how
 * far through the period today is.
 */
object Meter {
  private const val MAX_RING = 360
  private const val MAX_BAR_W = 640
  private const val TRACK = 0x47FFFFFF

  /** Width of the ring's stroke in dp for a ring of [sizeDp]: 12%, but never thinner than 5dp. */
  fun ringStrokeDp(sizeDp: Float): Float = max(sizeDp * 0.12f, 5f)

  /** Diameter in dp of the empty middle of a ring of [sizeDp]. */
  fun ringHoleDp(sizeDp: Float): Float = sizeDp - 2f * ringStrokeDp(sizeDp)

  /**
   * [progress] is the first lap, 0 to 1. [overflow] is the second lap, 0 to 1 (0.3 is 130%).
   * [elapsed] is how far through the period today is, 0 to 1.
   */
  fun ring(progress: Float, overflow: Float, elapsed: Float, sizeDp: Float, density: Float): MeterLayers {
    val size = (sizeDp * density).roundToInt().coerceIn(24, MAX_RING)
    val scale = size / (sizeDp * density)
    val stroke = max(size * 0.12f, 5f * density * scale)
    val inset = stroke / 2f + 1f
    val rect = RectF(inset, inset, size - inset, size - inset)
    val radius = rect.width() / 2f
    val first = progress.coerceIn(0f, 1f)
    val second = overflow.coerceIn(0f, 1f)

    val base = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    Canvas(base).apply {
      drawArc(rect, -90f, 360f, false, strokePaint(stroke, TRACK, Paint.Cap.BUTT))
      if (first > 0f) {
        val full = first >= 1f
        drawArc(rect, -90f, 360f * first, false, strokePaint(stroke, Color.WHITE, if (full) Paint.Cap.BUTT else Paint.Cap.ROUND))
      }
    }

    var shadow: Bitmap? = null
    var over: Bitmap? = null
    if (second > 0f) {
      over = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      Canvas(over).drawArc(rect, -90f, 360f * second, false, strokePaint(stroke, Color.WHITE, Paint.Cap.ROUND))

      if (second < 0.995f) {
        shadow = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(shadow)
        // Only on the ring itself, never on the surface around it.
        val band = Path().apply {
          fillType = Path.FillType.EVEN_ODD
          addCircle(size / 2f, size / 2f, radius + stroke / 2f, Path.Direction.CW)
          addCircle(size / 2f, size / 2f, radius - stroke / 2f, Path.Direction.CW)
        }
        canvas.clipPath(band)
        // The shadow falls ahead of the tip, onto the first lap: a blurred round blob centered a
        // little past the end of the overflow, kept inside the band of the ring.
        val tip = (-90.0 + 360.0 * second) * PI / 180.0
        val ahead = (stroke * 0.55f) / radius
        val angle = tip + ahead
        val cx = size / 2f + (radius * cos(angle)).toFloat()
        val cy = size / 2f + (radius * sin(angle)).toFloat()
        val blob = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.WHITE
          maskFilter = BlurMaskFilter(stroke * 0.42f, BlurMaskFilter.Blur.NORMAL)
        }
        canvas.drawCircle(cx, cy, stroke * 0.5f, blob)
      }
    }

    if (elapsed > 0f && elapsed < 1f) {
      val cx = size / 2f
      val outer = size / 2f
      val inner = outer - stroke - 2f
      val angle = (-90.0 + 360.0 * elapsed) * PI / 180.0
      val gap = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f * density * scale
        xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
      }
      for (bitmap in listOfNotNull(base, over)) {
        Canvas(bitmap).drawLine(
          cx + (inner * cos(angle)).toFloat(), cx + (inner * sin(angle)).toFloat(),
          cx + (outer * cos(angle)).toFloat(), cx + (outer * sin(angle)).toFloat(),
          gap,
        )
      }
    }
    return MeterLayers(base, shadow, over)
  }

  fun bar(progress: Float, overflow: Float, elapsed: Float, widthDp: Float, heightDp: Float, density: Float): MeterLayers {
    val w = (widthDp * density).roundToInt().coerceIn(48, MAX_BAR_W)
    val h = (heightDp * density).roundToInt().coerceIn(6, 64)
    val radius = (3f * density).coerceAtMost(h / 2f)
    val first = progress.coerceIn(0f, 1f)
    val second = overflow.coerceIn(0f, 1f)
    val shape = RectF(0f, 0f, w.toFloat(), h.toFloat())

    val base = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    Canvas(base).apply {
      drawRoundRect(shape, radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TRACK })
      if (first > 0f) {
        val end = (w * first).coerceAtLeast(radius * 2f)
        drawRoundRect(RectF(0f, 0f, end, h.toFloat()), radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
      }
    }

    var shadow: Bitmap? = null
    var over: Bitmap? = null
    if (second > 0f) {
      val end = (w * second).coerceAtLeast(radius * 2f).coerceAtMost(w.toFloat())
      over = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      Canvas(over).drawRoundRect(RectF(0f, 0f, end, h.toFloat()), radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })

      if (second < 0.995f) {
        shadow = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(shadow)
        canvas.clipPath(Path().apply { addRoundRect(shape, radius, radius, Path.Direction.CW) })
        val blur = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.WHITE
          maskFilter = BlurMaskFilter(h * 0.5f, BlurMaskFilter.Blur.NORMAL)
        }
        // Falls to the right of the overflow's end, onto the first lap.
        canvas.drawRoundRect(RectF(end - h * 0.2f, -h * 0.2f, end + h * 0.55f, h * 1.2f), h * 0.3f, h * 0.3f, blur)
      }
    }

    if (elapsed > 0f && elapsed < 1f) {
      val x = w * elapsed
      val gap = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) }
      for (bitmap in listOfNotNull(base, over)) {
        Canvas(bitmap).drawRect(RectF(x - density, 0f, x + density, h.toFloat()), gap)
      }
    }
    return MeterLayers(base, shadow, over)
  }

  private fun strokePaint(width: Float, argb: Int, cap: Paint.Cap) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = width
    strokeCap = cap
    color = argb
  }
}
