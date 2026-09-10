/**
 * Expo config plugin: volume-down pressed five times quickly raises a silent SOS.
 *
 * A panic gesture has to work without looking at the screen, and the on-screen
 * hold cannot be used discreetly — it sounds an alarm on purpose. Tapping one
 * volume key is silent, one-handed, doable in a pocket, and unremarkable to
 * anyone watching the phone.
 *
 * WHY NOT BOTH VOLUME KEYS TOGETHER, which is what this used to do: Android
 * reserves that chord for its own accessibility shortcut (hold volume-up and
 * volume-down to toggle TalkBack). PhoneWindowManager consumes both keys the
 * moment the second one goes down, so `onKeyDown` is never called and the app
 * cannot see the gesture at all. Verified on a CPH2613 running Android 15: a
 * single volume key reaches this method every time, the chord reaches it never.
 * That collision is worst for exactly our users — someone who relies on
 * TalkBack has the shortcut bound to that chord already.
 *
 * Five presses is the established emergency idiom (Android's own Emergency SOS
 * is power five times, iOS is the side button five times), which makes it both
 * learnable and unlikely to happen by accident.
 *
 * Nothing is swallowed. Volume still works normally during a journey, including
 * while the pattern is being tapped out — a safety app that breaks the volume
 * keys has traded one problem for another, and the moving volume gives the
 * traveller silent confirmation that the presses are registering.
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
  "import android.view.KeyEvent",
  "import com.facebook.react.ReactApplication",
  "import com.facebook.react.bridge.ReactContext",
  "import com.facebook.react.modules.core.DeviceEventManagerModule",
];

/** How many presses, and how long they may take. Keep in step with services/panicKeys.ts. */
const PANIC_PRESSES = 5;
const PANIC_WINDOW_MS = 3000;

const BODY = `
  ${MARKER}
  private val auraPanicPresses = ArrayDeque<Long>()

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

  /** Records one press and reports whether that completes the pattern. */
  private fun auraRecordPanicPress(now: Long): Boolean {
    while (auraPanicPresses.isNotEmpty() && now - auraPanicPresses.first() > ${PANIC_WINDOW_MS}L) {
      auraPanicPresses.removeFirst()
    }
    auraPanicPresses.addLast(now)
    if (auraPanicPresses.size < ${PANIC_PRESSES}) return false
    auraPanicPresses.clear()
    return true
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    // repeatCount > 0 is the auto-repeat of a key being held, not a new press,
    // so holding volume down to mute never counts towards the pattern.
    if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN && event.repeatCount == 0) {
      if (auraRecordPanicPress(event.eventTime)) auraEmitPanic()
    }
    // Never swallowed: volume control has to keep working during a journey.
    return super.onKeyDown(keyCode, event)
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
