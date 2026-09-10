/**
 * Expo config plugin: volume-up + volume-down held together raises an SOS.
 *
 * A panic gesture has to work without looking at the screen, and the on-screen
 * hold cannot be used discreetly — it sounds an alarm on purpose. Holding both
 * volume keys is silent and can be done one-handed, in a pocket, while the
 * phone is in view of someone else.
 *
 * This patches MainActivity because android/ is generated: editing the file
 * directly would be wiped by the next `expo prebuild`. Re-running the plugin is
 * idempotent — it checks for its own marker first.
 *
 * Android only. iOS gives apps no supported way to intercept the volume keys.
 */

const { withMainActivity } = require("@expo/config-plugins");

const MARKER = "// aura:panic-volume-keys";

const IMPORTS = [
  "import android.os.Handler",
  "import android.os.Looper",
  "import android.view.KeyEvent",
  "import com.facebook.react.ReactApplication",
  "import com.facebook.react.bridge.ReactContext",
  "import com.facebook.react.modules.core.DeviceEventManagerModule",
];

/** Held this long before it counts — long enough not to fire on a fumble. */
const HOLD_MS = 1500;

const BODY = `
  ${MARKER}
  private var auraVolumeUpHeld = false
  private var auraVolumeDownHeld = false
  private val auraPanicHandler = Handler(Looper.getMainLooper())
  private var auraPanicRunnable: Runnable? = null

  private fun auraReactContext(): ReactContext? {
    val app = application as? ReactApplication ?: return null
    return try {
      app.reactHost?.currentReactContext
    } catch (error: Throwable) {
      null
    }
  }

  private fun auraEmitPanic() {
    val context = auraReactContext() ?: return
    try {
      context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("auraPanicVolumeKeys", null)
    } catch (error: Throwable) {
      // JS is not listening yet; the on-screen hold still works.
    }
  }

  private fun auraUpdatePanicWatch() {
    if (auraVolumeUpHeld && auraVolumeDownHeld) {
      if (auraPanicRunnable == null) {
        val runnable = Runnable {
          auraPanicRunnable = null
          auraEmitPanic()
        }
        auraPanicRunnable = runnable
        auraPanicHandler.postDelayed(runnable, ${HOLD_MS}L)
      }
    } else {
      auraPanicRunnable?.let { auraPanicHandler.removeCallbacks(it) }
      auraPanicRunnable = null
    }
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    when (keyCode) {
      KeyEvent.KEYCODE_VOLUME_UP -> auraVolumeUpHeld = true
      KeyEvent.KEYCODE_VOLUME_DOWN -> auraVolumeDownHeld = true
    }
    auraUpdatePanicWatch()
    // Swallowed only while both are held, so ordinary volume control still works.
    if (auraVolumeUpHeld && auraVolumeDownHeld) return true
    return super.onKeyDown(keyCode, event)
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    when (keyCode) {
      KeyEvent.KEYCODE_VOLUME_UP -> auraVolumeUpHeld = false
      KeyEvent.KEYCODE_VOLUME_DOWN -> auraVolumeDownHeld = false
    }
    auraUpdatePanicWatch()
    return super.onKeyUp(keyCode, event)
  }
`;

module.exports = function withPanicVolumeKeys(config) {
  return withMainActivity(config, (cfg) => {
    const { language } = cfg.modResults;
    if (language !== "kt") {
      throw new Error(
        `withPanicVolumeKeys expects a Kotlin MainActivity, found "${language}".`,
      );
    }

    let source = cfg.modResults.contents;
    if (source.includes(MARKER)) return cfg;

    for (const line of IMPORTS) {
      if (!source.includes(line)) {
        source = source.replace(/^(package .*\n)/m, `$1\n${line}`);
      }
    }

    // Insert before the closing brace of the class, which is the last one.
    const lastBrace = source.lastIndexOf("}");
    if (lastBrace === -1) {
      throw new Error("withPanicVolumeKeys could not find the class body.");
    }
    source = source.slice(0, lastBrace) + BODY + source.slice(lastBrace);

    cfg.modResults.contents = source;
    return cfg;
  });
};
