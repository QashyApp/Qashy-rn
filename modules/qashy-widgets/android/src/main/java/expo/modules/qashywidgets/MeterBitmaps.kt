package expo.modules.qashywidgets

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The budget widget's ring and bar, drawn in white (a faint track, a solid fill): the Glance Image
 * tints them with a (day/night) color, so they follow dark mode without a re-render.
 *
 * Over budget is carried by shape as well as by the tint: the fill is broken into segments, so it
 * reads as different from a budget that is exactly full. A small gap cut through the track marks
 * how far through the period today is.
 */
object Meter {
  private const val MAX_RING = 360
  private const val MAX_BAR_W = 640
  private val TRACK = 0x47FFFFFF

  fun ring(progress: Float, elapsed: Float, over: Boolean, sizeDp: Float, density: Float): Bitmap {
    val size = (sizeDp * density).roundToInt().coerceIn(48, MAX_RING)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val stroke = (size * 0.12f).coerceAtLeast(5f * density)
    val inset = stroke / 2f + 1f
    val rect = RectF(inset, inset, size - inset, size - inset)

    canvas.drawArc(rect, -90f, 360f, false, strokePaint(stroke, TRACK, Paint.Cap.BUTT))

    val value = progress.coerceIn(0f, 1f)
    if (value > 0f) {
      val fill = strokePaint(stroke, Color.WHITE, if (over) Paint.Cap.BUTT else Paint.Cap.ROUND)
      if (over) {
        // Even segments all the way round: the circumference split into a whole number of dashes.
        val circumference = (PI * rect.width()).toFloat()
        val count = (circumference / (stroke * 1.5f)).roundToInt().coerceAtLeast(8)
        val period = circumference / count
        fill.pathEffect = DashPathEffect(floatArrayOf(period * 0.68f, period * 0.32f), 0f)
      }
      canvas.drawArc(rect, -90f, 360f * value, false, fill)
    }

    if (elapsed > 0f && elapsed < 1f) {
      val angle = (-90.0 + 360.0 * elapsed) * PI / 180.0
      val cx = size / 2f
      val outer = size / 2f
      val inner = outer - stroke - 2f
      canvas.drawLine(
        cx + (inner * cos(angle)).toFloat(), cx + (inner * sin(angle)).toFloat(),
        cx + (outer * cos(angle)).toFloat(), cx + (outer * sin(angle)).toFloat(),
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
          style = Paint.Style.STROKE
          strokeWidth = 2f * density
          xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
        },
      )
    }
    return bitmap
  }

  fun bar(progress: Float, elapsed: Float, over: Boolean, widthDp: Float, heightDp: Float, density: Float): Bitmap {
    val w = (widthDp * density).roundToInt().coerceIn(48, MAX_BAR_W)
    val h = (heightDp * density).roundToInt().coerceIn(6, 64)
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val radius = (3f * density).coerceAtMost(h / 2f)
    val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TRACK }
    canvas.drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), radius, radius, track)

    val value = progress.coerceIn(0f, 1f)
    if (value > 0f) {
      val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
      if (over) {
        val segment = 10f * density
        val gap = 4f * density
        var x = 0f
        while (x < w) {
          canvas.drawRoundRect(RectF(x, 0f, (x + segment).coerceAtMost(w.toFloat()), h.toFloat()), 1f, 1f, fill)
          x += segment + gap
        }
      } else {
        val end = (w * value).coerceAtLeast(radius * 2f)
        canvas.drawRoundRect(RectF(0f, 0f, end, h.toFloat()), radius, radius, fill)
      }
    }

    if (elapsed > 0f && elapsed < 1f) {
      val x = w * elapsed
      canvas.drawRect(
        RectF(x - density, 0f, x + density, h.toFloat()),
        Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) },
      )
    }
    return bitmap
  }

  private fun strokePaint(width: Float, argb: Int, cap: Paint.Cap) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = width
    strokeCap = cap
    color = argb
  }
}
