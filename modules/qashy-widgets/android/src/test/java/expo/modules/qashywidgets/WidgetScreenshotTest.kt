package expo.modules.qashywidgets

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Renders both widget kinds at every launcher size, in English and Hebrew (RTL), light and dark,
 * with normal and awkward data, to PNGs under `build/outputs/widget-screenshots/`, and fails if
 * any text is wider than its box or any view sticks out of the widget. Run it with
 * `./gradlew :qashy-widgets:testDebugUnitTest` from a generated `android/` project (see README.md
 * next to this file). It is JVM-only and not part of `npm test`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "xxhdpi")
class WidgetScreenshotTest {
  private class SizeCase(val name: String, val size: DpSize)

  private val sizes = listOf(
    SizeCase("1x1", DpSize(WidgetSizes.WIDTHS[0], WidgetSizes.HEIGHTS[0])),
    SizeCase("2x1", DpSize(WidgetSizes.WIDTHS[1], WidgetSizes.HEIGHTS[0])),
    SizeCase("3x1", DpSize(WidgetSizes.WIDTHS[2], WidgetSizes.HEIGHTS[0])),
    SizeCase("4x1", DpSize(WidgetSizes.WIDTHS[3], WidgetSizes.HEIGHTS[0])),
    SizeCase("5x1", DpSize(WidgetSizes.WIDTHS[4], WidgetSizes.HEIGHTS[0])),
    SizeCase("2x2", DpSize(WidgetSizes.WIDTHS[1], WidgetSizes.HEIGHTS[1])),
    SizeCase("3x2", DpSize(WidgetSizes.WIDTHS[2], WidgetSizes.HEIGHTS[1])),
    SizeCase("4x2", DpSize(WidgetSizes.WIDTHS[3], WidgetSizes.HEIGHTS[1])),
    SizeCase("4x3", DpSize(WidgetSizes.WIDTHS[3], WidgetSizes.HEIGHTS[2])),
  )

  private val outDir = File("build/outputs/widget-screenshots")

  private fun context(lang: Fixtures.Lang, night: Boolean): Context {
    RuntimeEnvironment.setQualifiers("+${lang.tag}${if (lang.rtl) "-ldrtl" else ""}-${if (night) "night" else "notnight"}-xxhdpi")
    // Glance's Row and Column use layoutDirection="locale", which reads the JVM default locale.
    RuntimeEnvironment.setFontScale(1f)
    java.util.Locale.setDefault(java.util.Locale.forLanguageTag(if (lang.rtl) "he-IL" else "en-US"))
    return ApplicationProvider.getApplicationContext()
  }

  private fun runKind(kindName: String, widget: () -> QashyWidget, scenarios: List<Fixtures.Scenario>) {
    val problems = mutableListOf<String>()
    for (lang in Fixtures.Lang.values()) for (night in listOf(false, true)) {
      val context = context(lang, night)
      val mode = if (night) "dark" else "light"
      for (scenario in scenarios) {
        SnapshotStore.write(context, scenario.build(lang))
        val tiles = ArrayList<Pair<String, Bitmap>>()
        for (case in sizes) {
          val rendered = WidgetRenderer.render(context, widget(), case.size, lang.rtl, night)
          WidgetRenderer.writePng(rendered.bitmap, File(outDir, "${kindName}_${scenario.id}_${case.name}_${lang.tag}_$mode.png"))
          tiles += case.name to rendered.bitmap
          rendered.problems.forEach { problems += "$kindName ${scenario.id} ${case.name} ${lang.tag} $mode: $it" }
        }
        val bg = if (night) 0xFF17181D.toInt() else 0xFFF1F2F5.toInt()
        val sheet = WidgetRenderer.sheet("$kindName / ${scenario.id} / ${lang.tag} / $mode", tiles, columns = 3, bg = bg)
        WidgetRenderer.writePng(sheet, File(outDir, "sheets/${kindName}_${scenario.id}_${lang.tag}_$mode.png"))
      }
    }
    File(outDir, "problems_$kindName.txt").apply { parentFile?.mkdirs() }.writeText(problems.joinToString("\n"))
    assertTrue("Clipped or overflowing:\n" + problems.joinToString("\n"), problems.isEmpty())
  }

  /**
   * The device case: USD, net worth -$57,306.00, spent $57,306.00, income $0.00 in the Quick add
   * widget, which a Samsung phone showed as "-$57,3…". Rendered at the sizes that show figures with
   * the normal font, a larger font scale, and a font scale with wider glyphs (an OEM font). Fails on
   * any ellipsized or clipped amount, and when full and compact amounts are mixed in one widget.
   */
  @Test
  fun deviceCaseAmountsAreNeverEllipsizedAndCompactIsAllOrNothing() {
    class Variant(val id: String, val fontScale: Float, val scaleX: Float)
    val variants = listOf(Variant("normal", 1f, 1f), Variant("scaled115", 1.15f, 1f), Variant("wide", 1.15f, 1.08f), Variant("wider", 1.3f, 1.1f))
    val deviceSizes = listOf("2x1", "3x1", "4x1", "5x1", "2x2", "3x2", "4x2", "4x3")
    val problems = mutableListOf<String>()
    for (lang in Fixtures.Lang.values()) for (night in listOf(false, true)) {
      val context = context(lang, night)
      val mode = if (night) "dark" else "light"
      for (variant in variants) {
        RuntimeEnvironment.setFontScale(variant.fontScale)
        SnapshotStore.write(context, Fixtures.DEVICE_CASE.build(lang))
        val tiles = ArrayList<Pair<String, Bitmap>>()
        for (case in sizes.filter { it.name in deviceSizes }) {
          val rendered = WidgetRenderer.render(context, QuickAddWidget(), case.size, lang.rtl, night, textScaleX = variant.scaleX)
          WidgetRenderer.writePng(rendered.bitmap, File(outDir, "device_${variant.id}_${case.name}_${lang.tag}_$mode.png"))
          tiles += case.name to rendered.bitmap
          val where = "${variant.id} ${case.name} ${lang.tag} $mode"
          // At 130% a third line cannot fit a 2-row widget's height by any layout; that variant is
          // only held to the amount rules (no ellipsis, no clipping across, no mixing).
          rendered.problems.filter { variant.fontScale <= 1.2f || !it.contains(" tall in ") }.forEach { problems += "$where: $it" }
          val usesFull = rendered.texts.any { it in Fixtures.DEVICE_FULL }
          val usesCompact = rendered.texts.any { it in Fixtures.DEVICE_COMPACT }
          if (usesFull && usesCompact) problems += "$where: full and compact amounts mixed in one widget: ${rendered.texts}"
        }
        val bg = if (night) 0xFF17181D.toInt() else 0xFFF1F2F5.toInt()
        WidgetRenderer.writePng(
          WidgetRenderer.sheet("quickadd / device / ${variant.id} / ${lang.tag} / $mode", tiles, columns = 3, bg = bg),
          File(outDir, "sheets/device_${variant.id}_${lang.tag}_$mode.png"),
        )
      }
    }
    RuntimeEnvironment.setFontScale(1f)
    File(outDir, "problems_device.txt").apply { parentFile?.mkdirs() }.writeText(problems.joinToString("\n"))
    assertTrue("Device case:\n" + problems.joinToString("\n"), problems.isEmpty())
  }

  /** The "+" is on the physical right at every size that has one, in English and Hebrew. */
  @Test
  fun addButtonIsOnTheRightInEveryLanguage() {
    val problems = mutableListOf<String>()
    for (lang in Fixtures.Lang.values()) {
      val context = context(lang, false)
      SnapshotStore.write(context, Fixtures.QUICK_ADD.first().build(lang))
      for (case in sizes) {
        val rendered = WidgetRenderer.render(context, QuickAddWidget(), case.size, lang.rtl, false)
        val bitmap = rendered.bitmap
        // The accent-colored button's pixels (the accent is #5070FF in the fixtures).
        var minX = Int.MAX_VALUE; var maxX = -1
        for (y in 0 until bitmap.height step 2) for (x in 0 until bitmap.width) {
          val c = bitmap.getPixel(x, y)
          if (android.graphics.Color.red(c) in 0x48..0x58 && android.graphics.Color.green(c) in 0x68..0x78 && android.graphics.Color.blue(c) > 0xF0) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
          }
        }
        val mid = bitmap.width / 2
        if (maxX < 0) problems += "${lang.tag} ${case.name}: no button found"
        else if (case.name != "1x1" && minX < mid) problems += "${lang.tag} ${case.name}: button at $minX..$maxX is not on the right of $mid"
      }
    }
    assertTrue("Add button position:\n" + problems.joinToString("\n"), problems.isEmpty())
  }

  /** The overflow lap's shade is clearly different from the accent, on light and dark surfaces. */
  @Test
  fun accentDeepContrastsWithTheAccent() {
    fun lum(c: Int) = android.graphics.Color.luminance(c)
    fun ratio(a: Int, b: Int) = (maxOf(lum(a), lum(b)) + 0.05f) / (minOf(lum(a), lum(b)) + 0.05f)
    val problems = mutableListOf<String>()
    for ((accent, bg) in listOf(
      0xFF5070FF.toInt() to 0xFFFFFFFF.toInt(), 0xFF9DB0FF.toInt() to 0xFF121221.toInt(),
      0xFFE65100.toInt() to 0xFFFFFFFF.toInt(), 0xFFFFB74D.toInt() to 0xFF121221.toInt(),
    )) {
      val deep = WidgetTheme.deepen(androidx.compose.ui.graphics.Color(accent), androidx.compose.ui.graphics.Color(bg)).toArgb()
      val r = ratio(deep, accent)
      if (r < 1.7f) problems += "accent ${Integer.toHexString(accent)} on ${Integer.toHexString(bg)}: deep ${Integer.toHexString(deep)} contrast $r"
    }
    assertTrue(problems.joinToString("\n"), problems.isEmpty())
  }

  /** The picker previews (`providePreview`, fixed sample data) compose and fit at the sizes pickers use. */
  @Test
  fun previews() {
    val problems = mutableListOf<String>()
    for (lang in Fixtures.Lang.values()) for (night in listOf(false, true)) {
      val context = context(lang, night)
      for ((name, widget, case) in listOf(
        Triple("quickadd", QuickAddWidget(), sizes[2]),
        Triple("budget", BudgetWidget(), sizes[6]),
      )) {
        val rendered = WidgetRenderer.render(context, widget, case.size, lang.rtl, night, preview = true)
        WidgetRenderer.writePng(rendered.bitmap, File(outDir, "preview_${name}_${case.name}_${lang.tag}_${if (night) "dark" else "light"}.png"))
        rendered.problems.forEach { problems += "preview $name ${lang.tag} night=$night: $it" }
      }
    }
    assertTrue("Clipped or overflowing:\n" + problems.joinToString("\n"), problems.isEmpty())
  }

  @Test
  fun quickAdd() = runKind("quickadd", ::QuickAddWidget, Fixtures.QUICK_ADD)

  @Test
  fun budget() = runKind("budget", ::BudgetWidget, Fixtures.BUDGET)
}
