// Plain Node test for the MainActivity.kt change behind Share -> Nexora Watch. The template below is Expo SDK 52's
// generated MainActivity.kt as written from memory (prebuild could not be run here): the anchors the patch needs
// (the class line, super.onCreate) are the ones every recent Expo template has.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { patchMainActivity } = require("./shareIntentPatch");

const SDK52 = `package com.lenstedreal.nexorawatch

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
`;

const count = (s, sub) => s.split(sub).length - 1;

test("the share intent becomes a nexora://share link before React Native reads it", () => {
  const out = patchMainActivity(SDK52);
  // the start intent is rewritten right before super.onCreate
  assert.match(out, /setTheme\(R\.style\.AppTheme\);\n    nexoraShareIntent\(intent\)\n    super\.onCreate\(null\)/);
  // a running app gets it through onNewIntent, rewritten before React Native's delegate sees it
  assert.match(out, /override fun onNewIntent\(intent: Intent\) \{\n    nexoraShareIntent\(intent\)\n    super\.onNewIntent\(intent\)\n  \}/);
  assert.match(out, /private fun nexoraShareIntent\(i: Intent\?\) \{\n    if \(i == null \|\| i\.action != Intent\.ACTION_SEND\) return\n/);
  assert.match(out, /i\.data = Uri\.parse\("nexora:\/\/share\?text=" \+ Uri\.encode\(text\)\)/);
  assert.match(out, /^import android\.content\.Intent$/m);
  assert.match(out, /^import android\.net\.Uri$/m);
  // imports stay in the import block, after the last one
  assert.ok(out.indexOf("import android.net.Uri") > out.indexOf("import expo.modules.ReactActivityDelegateWrapper"));
  assert.ok(out.indexOf("import android.net.Uri") < out.indexOf("class MainActivity"));
  // everything else is untouched
  for (const keep of ["override fun getMainComponentName(): String = \"main\"", "override fun invokeDefaultOnBackPressed()", "ReactActivityDelegateWrapper(", "package com.lenstedreal.nexorawatch"])
    assert.equal(count(out, keep), 1, keep);
  assert.equal(count(out, "super.onCreate("), 1);
  // balanced braces (a cheap check that the Kotlin still closes where it did)
  assert.equal(count(out, "{"), count(out, "}"));
});

test("running the plugin twice changes nothing", () => {
  const once = patchMainActivity(SDK52);
  assert.equal(patchMainActivity(once), once);
});

test("an onNewIntent that another plugin added gets the call first, not a second override", () => {
  const withOwn = SDK52.replace("  override fun getMainComponentName()", "  override fun onNewIntent(intent: Intent?) {\n    super.onNewIntent(intent)\n    setIntent(intent)\n  }\n\n  override fun getMainComponentName()")
    .replace("import android.os.Bundle", "import android.os.Bundle\nimport android.content.Intent");
  const out = patchMainActivity(withOwn);
  assert.equal(count(out, "override fun onNewIntent("), 1);
  assert.match(out, /override fun onNewIntent\(intent: Intent\?\) \{\n    nexoraShareIntent\(intent\)\n    super\.onNewIntent\(intent\)/);
  assert.equal(count(out, "import android.content.Intent"), 1);
  assert.equal(count(out, "private fun nexoraShareIntent"), 1);
});

test("a MainActivity the patch does not understand stops the build with a clear message", () => {
  assert.throws(() => patchMainActivity("package x\n\nclass Other : Activity() {\n}\n"), /class MainActivity : ReactActivity\(\)/);
  assert.throws(() => patchMainActivity("package x\n\nclass MainActivity : ReactActivity() {\n}\n"), /super\.onCreate/);
  assert.throws(() => patchMainActivity(undefined), /contents missing/);
});
