package expo.modules.qashywidgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Every tap goes to the app through its own URL scheme. */
fun viewIntent(context: Context, uri: String): Intent =
  Intent(Intent.ACTION_VIEW, Uri.parse(uri))
    .setPackage(context.packageName)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

fun openAction(context: Context, uri: String): Action = actionStartActivity(viewIntent(context, uri))

fun textStyle(color: ColorProvider, size: Int, bold: Boolean = false, align: TextAlign? = null) = TextStyle(
  color = color,
  fontSize = size.sp,
  fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
  textAlign = align,
)

/** Background, system corner radius, and the optional frosted border + sheen. */
@Composable
fun WidgetContainer(
  radius: Dp,
  background: ColorProvider,
  frosted: Boolean,
  onClick: Action?,
  content: @Composable () -> Unit,
) {
  var root = GlanceModifier.fillMaxSize().appWidgetBackground().cornerRadius(radius)
  if (onClick != null) root = root.clickable(onClick)
  if (!frosted) {
    Box(modifier = root.background(background)) { content() }
  } else {
    // A 1dp light rim: translucent white outer box, the real background inset by 1dp.
    Box(modifier = root.background(Color.White.copy(alpha = 0.25f)).padding(1.dp)) {
      Box(
        modifier = GlanceModifier.fillMaxSize()
          .cornerRadius((radius - 1.dp).coerceAtLeast(0.dp))
          .background(background),
      ) {
        Box(modifier = GlanceModifier.fillMaxSize().background(Color.White.copy(alpha = 0.06f))) {}
        content()
      }
    }
  }
}

abstract class QashyWidget(private val kind: String) : GlanceAppWidget() {
  override val sizeMode: SizeMode = SizeMode.Responsive(
    setOf(
      DpSize(100.dp, 100.dp),
      DpSize(180.dp, 100.dp),
      DpSize(250.dp, 110.dp),
      DpSize(250.dp, 170.dp),
    ),
  )

  @Composable
  protected abstract fun Content(
    context: Context,
    snapshot: Snapshot,
    data: WidgetData,
    colors: WidgetColors,
    size: DpSize,
  )

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val appWidgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
    val snapshot = withContext(Dispatchers.IO) { SnapshotStore.read(context) }
    val data = snapshot?.widgets?.get(appWidgetId)?.takeIf { it.kind == kind }
    // No data for this widget: ask JS (through the refresh worker) to produce it.
    if (data == null) WidgetScheduler.enqueueNowThrottled(context)
    val radius = WidgetTheme.radius(context)
    val openApp = if (snapshot != null) snapshot.labels.openApp
    else context.getString(R.string.qashy_widget_open_app)

    provideContent {
      val style = data?.style ?: WidgetTheme.DEFAULT_STYLE
      val colors = WidgetTheme.resolve(context, style)
      if (snapshot == null || data == null) {
        WidgetContainer(radius, colors.background, style.frosted, openAction(context, "qashy:///")) {
          Box(modifier = GlanceModifier.fillMaxSize().padding(12.dp), contentAlignment = Alignment.Center) {
            Text(openApp, style = textStyle(colors.text, 14, align = TextAlign.Center), maxLines = 4)
          }
        }
      } else {
        // Summary taps anywhere; the transactions widget has per-element targets instead.
        val rootAction = if (kind == KIND_SUMMARY) openAction(context, "qashy:///overview") else null
        WidgetContainer(radius, colors.background, style.frosted, rootAction) {
          Content(context, snapshot, data, colors, LocalSize.current)
        }
      }
    }
  }
}
