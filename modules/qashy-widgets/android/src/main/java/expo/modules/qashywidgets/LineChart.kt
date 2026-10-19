package expo.modules.qashywidgets

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader

/**
 * Draws a series as an anti-aliased line with a soft fill below it, in white: the Glance Image
 * tints it with the (day/night) accent color.
 */
object LineChart {
  private const val MAX_W = 640
  private const val MAX_H = 240

  fun render(series: List<Double>, widthDp: Float, heightDp: Float, density: Float): Bitmap {
    val w = (widthDp * density).toInt().coerceIn(32, MAX_W)
    val h = (heightDp * density).toInt().coerceIn(16, MAX_H)
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val values = series.filter { it.isFinite() }
    if (values.size < 2) return bitmap

    val strokeW = 2f * density
    val pad = strokeW + 1f
    val min = values.min()
    val range = values.max() - min
    val xStep = (w - 2 * pad) / (values.size - 1)
    fun x(i: Int) = pad + i * xStep
    // A flat series sits in the middle.
    fun y(v: Double) =
      if (range == 0.0) h / 2f else (pad + (1.0 - (v - min) / range) * (h - 2 * pad)).toFloat()

    val line = Path().apply {
      values.forEachIndexed { i, v -> if (i == 0) moveTo(x(i), y(v)) else lineTo(x(i), y(v)) }
    }
    val fill = Path(line).apply {
      lineTo(x(values.size - 1), h.toFloat())
      lineTo(x(0), h.toFloat())
      close()
    }
    val canvas = Canvas(bitmap)
    canvas.drawPath(
      fill,
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        shader = LinearGradient(0f, 0f, 0f, h.toFloat(), 0x4DFFFFFF.toInt(), 0x00FFFFFF, Shader.TileMode.CLAMP)
      },
    )
    canvas.drawPath(
      line,
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = strokeW
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        color = Color.WHITE
      },
    )
    canvas.drawCircle(x(values.size - 1), y(values.last()), strokeW * 1.4f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
    return bitmap
  }
}
