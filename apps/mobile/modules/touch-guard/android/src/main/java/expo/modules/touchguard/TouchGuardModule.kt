package expo.modules.touchguard

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * A view that refuses taps on what it wraps while another app's window covers the screen.
 * The JS side reaches it with requireNativeView("TouchGuard").
 */
class TouchGuardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TouchGuard")

    View(TouchGuardView::class) {
      Events("onBlockedTouch")
    }
  }
}
