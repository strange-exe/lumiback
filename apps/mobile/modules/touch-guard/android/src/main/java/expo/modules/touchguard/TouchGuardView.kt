package expo.modules.touchguard

import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MotionEvent
import android.view.Window
import androidx.annotation.RequiresApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Wraps a control so a tap on it is refused while another app's window covers the screen
 * (tapjacking). React Native reads touches at the root view, so filterTouchesWhenObscured on a
 * child would not stop a JS press; instead this view wraps the activity window's callback while
 * it is attached, and looks at every gesture before React Native does.
 *
 * - A gesture whose ACTION_DOWN lands on this view with FLAG_WINDOW_IS_OBSCURED or
 *   FLAG_WINDOW_IS_PARTIALLY_OBSCURED is dropped whole (down, moves, up): JS never sees it.
 * - A gesture that began here cleanly but ends with an obscured ACTION_UP (an overlay appeared
 *   mid-press) is sent on as ACTION_CANCEL, so the press never fires.
 * Both send onBlockedTouch. Touches anywhere else pass through untouched.
 */
class TouchGuardView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // Named like the event in TouchGuardModule's Events(...), as the Expo docs require.
  val onBlockedTouch by EventDispatcher()

  private var window: Window? = null
  private var wrapper: GuardCallback? = null

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    install()
  }

  override fun onDetachedFromWindow() {
    uninstall()
    super.onDetachedFromWindow()
  }

  private fun install() {
    if (wrapper != null) return
    val target = appContext.currentActivity?.window ?: return
    val current = target.callback ?: return
    val guard = GuardCallback(current, this)
    target.callback = guard
    window = target
    wrapper = guard
  }

  private fun uninstall() {
    val guard = wrapper ?: return
    val target = window
    guard.active = false
    // Put the old callback back only if ours is still on top. If something wrapped the window
    // after us, removing ours would drop theirs too, so ours stays in the chain as a pass-through.
    if (target != null && target.callback === guard) {
      target.callback = guard.inner
    }
    wrapper = null
    window = null
  }

  /** Whether a window-relative point falls on the visible part of this view. */
  internal fun covers(event: MotionEvent): Boolean {
    if (!isShown) return false
    val visible = Rect()
    if (!getGlobalVisibleRect(visible)) return false
    return visible.contains(event.x.toInt(), event.y.toInt())
  }

  internal fun blocked(phase: String) {
    onBlockedTouch(mapOf("phase" to phase))
  }
}

private const val OBSCURED_FLAGS =
  MotionEvent.FLAG_WINDOW_IS_OBSCURED or MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED

internal fun isObscured(event: MotionEvent): Boolean = (event.flags and OBSCURED_FLAGS) != 0

/** Passes every window callback through, except touch gestures that start on an obscured guard. */
internal class GuardCallback(
  val inner: Window.Callback,
  private val guard: TouchGuardView,
) : Window.Callback by inner {
  /** Off once the guard detaches; the wrapper then only passes events on. */
  var active = true

  /** The current gesture began on an obscured guard and is being dropped. */
  private var dropping = false

  /** The current gesture began cleanly on the guard, so an obscured UP must cancel it. */
  private var watching = false

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (!active) {
      dropping = false
      watching = false
      return inner.dispatchTouchEvent(event)
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        val onGuard = guard.covers(event)
        dropping = onGuard && isObscured(event)
        watching = onGuard && !dropping
        if (dropping) {
          guard.blocked("down")
          return true
        }
      }
      MotionEvent.ACTION_UP -> {
        if (dropping) {
          dropping = false
          return true
        }
        val cancel = watching && isObscured(event)
        watching = false
        if (cancel) {
          val cancelled = MotionEvent.obtain(event)
          cancelled.action = MotionEvent.ACTION_CANCEL
          try {
            inner.dispatchTouchEvent(cancelled)
          } finally {
            cancelled.recycle()
          }
          guard.blocked("up")
          return true
        }
      }
      MotionEvent.ACTION_CANCEL -> {
        watching = false
        if (dropping) {
          dropping = false
          return true
        }
      }
      else -> if (dropping) return true
    }
    return inner.dispatchTouchEvent(event)
  }

  // Java default methods: pass them on explicitly rather than rely on how delegation treats them.
  // The system calls onPointerCaptureChanged only on API 26+ (minSdk is 24).
  @RequiresApi(Build.VERSION_CODES.O)
  override fun onPointerCaptureChanged(hasCapture: Boolean) {
    inner.onPointerCaptureChanged(hasCapture)
  }

  override fun onProvideKeyboardShortcuts(
    data: MutableList<KeyboardShortcutGroup>?,
    menu: Menu?,
    deviceId: Int,
  ) {
    inner.onProvideKeyboardShortcuts(data, menu, deviceId)
  }
}
