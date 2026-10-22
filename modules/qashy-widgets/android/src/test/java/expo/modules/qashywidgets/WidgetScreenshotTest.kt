package expo.modules.qashywidgets

import android.content.Context
import android.graphics.Bitmap
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
