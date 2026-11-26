package expo.modules.nexorashare

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Share -> Nexora Watch: once a link shared from another app (TikTok, YouTube…) has reached the room, the person goes
 * straight back to that app, which is still where it was. Nexora's task only moves behind it: the room keeps running.
 */
class NexoraShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NexoraShare")

    Function("moveToBack") {
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread {
        try {
          activity.moveTaskToBack(true)
        } catch (t: Throwable) {
          Log.w("NexoraShare", "moveTaskToBack failed", t)
        }
      }
      true
    }
  }
}
