package expo.modules.qashywidgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.coerceAtLeast
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.PreviewSizeMode
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
  // One set of breakpoints for every kind, so a launcher cell count always maps to one layout.
  override val sizeMode: SizeMode = SizeMode.Responsive(WidgetSizes.BREAKPOINTS)

  override val previewSizeMode: PreviewSizeMode = SizeMode.Responsive(WidgetSizes.BREAKPOINTS)

  /** Where a tap anywhere on the widget goes; null when the kind has per-element targets instead. */
  protected open val rootUri: String? = null

  @Composable
  protected abstract fun Content(
    context: Context,
    snapshot: Snapshot,
    data: WidgetData,
    colors: WidgetColors,
    size: DpSize,
  )

  /**
   * The picker preview of this kind (Android 15+), drawn from fixed sample data and never from the
   * snapshot or the user's data. A kind overrides `providePreview` and calls this with its own
   * sample payload and sample labels, both built from string resources.
   */
  protected suspend fun providePreviewContent(context: Context, labels: Labels, payload: Any) {
    val snapshot = Snapshot(hideAmounts = false, labels = labels, widgets = emptyMap())
    val data = WidgetData(kind, WidgetTheme.DEFAULT_STYLE, payload)
    val radius = WidgetTheme.radius(context)
    provideContent {
      val colors = WidgetTheme.resolve(context, data.style)
      WidgetContainer(radius, colors.background, false, null) {
        Content(context, snapshot, data, colors, LocalSize.current)
      }
    }
  }

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val appWidgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
    // Loaded before provideContent so the first frame already has the data (no empty flash).
    val initial = SnapshotStore.load(context)
    val radius = WidgetTheme.radius(context)

    provideContent {
      // Read the snapshot inside the composition: values captured before provideContent are
      // frozen for the whole session, and update() does not re-run provideGlance on a live one.
      val snapshot by SnapshotStore.flow.collectAsState(initial)
      val data = snapshot?.widgets?.get(appWidgetId)?.takeIf { it.kind == kind }
      val openApp = snapshot?.labels?.openApp ?: context.getString(R.string.qashy_widget_open_app)
      // No data for this widget: ask JS (through the refresh worker) to produce it.
      LaunchedEffect(data == null) {
        if (data == null) WidgetScheduler.enqueueNowThrottled(context, appWidgetId)
      }
      val style = data?.style ?: WidgetTheme.DEFAULT_STYLE
      val colors = WidgetTheme.resolve(context, style)
      val current = snapshot
      if (current == null || data == null) {
        WidgetContainer(radius, colors.background, style.frosted, openAction(context, "qashy:///")) {
          Box(modifier = GlanceModifier.fillMaxSize().padding(12.dp), contentAlignment = Alignment.Center) {
            Text(openApp, style = textStyle(colors.text, 14, align = TextAlign.Center), maxLines = 4)
          }
        }
      } else {
        val rootAction = rootUri?.let { openAction(context, it) }
        WidgetContainer(radius, colors.background, style.frosted, rootAction) {
          Content(context, current, data, colors, LocalSize.current)
        }
      }
    }
  }
}

/** The receiver of a kind: on top of the Glance one, it drops the data and schedule with the last widget. */
abstract class QashyWidgetReceiver : GlanceAppWidgetReceiver() {
  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    super.onDeleted(context, appWidgetIds)
    WidgetScheduler.cleanupIfNoWidgets(context, appWidgetIds.toSet())
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    WidgetScheduler.cleanupIfNoWidgets(context)
  }
}
