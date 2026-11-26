// The MainActivity.kt change behind Share → Nexora Watch (used by withShareIntent.js; no requires, so it can be
// tested with plain Node). Android hands a shared link over as ACTION_SEND with the text in EXTRA_TEXT; React
// Native's Linking only reads ACTION_VIEW links. Before React Native sees the intent (in onCreate, before
// super.onCreate, and in onNewIntent while the app runs), a shared text becomes the link nexora://share?text=…:
// Linking.getInitialURL() returns it on a cold start and the "url" event brings it while the app is open.
const MARK = "nexoraShareIntent";

const HELPER = `
  // Nexora (plugins/withShareIntent.js): a link shared from another app (Share -> Nexora Watch) arrives as
  // nexora://share?text=..., so React Native's Linking delivers it like any other link of the app.
  private fun nexoraShareIntent(i: Intent?) {
    if (i == null || i.action != Intent.ACTION_SEND) return
    val text = i.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return
    i.action = Intent.ACTION_VIEW
    i.data = Uri.parse("nexora://share?text=" + Uri.encode(text))
  }
`;

const NEW_INTENT = `
  override fun onNewIntent(intent: Intent) {
    nexoraShareIntent(intent)
    super.onNewIntent(intent)
  }
`;

function addImport(src, name) {
  if (new RegExp(`^import[ \\t]+${name.replace(/\./g, "\\.")}[ \\t]*$`, "m").test(src)) return src;
  const imports = [...src.matchAll(/^import[ \t]+[\w.*]+[ \t]*$/gm)];
  if (imports.length) {
    const last = imports[imports.length - 1];
    const at = last.index + last[0].length;
    return `${src.slice(0, at)}\nimport ${name}${src.slice(at)}`;
  }
  const pkg = src.match(/^package[ \t]+[\w.]+[ \t]*$/m);
  if (!pkg) throw new Error("withShareIntent: no package line in MainActivity.kt");
  const at = pkg.index + pkg[0].length;
  return `${src.slice(0, at)}\n\nimport ${name}${src.slice(at)}`;
}

/** MainActivity.kt with the share handling added. Running it again changes nothing. */
function patchMainActivity(src) {
  if (typeof src !== "string") throw new Error("withShareIntent: MainActivity.kt contents missing");
  if (src.includes(MARK)) return src;
  const cls = src.match(/class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{[^\n]*\n/);
  if (!cls) throw new Error("withShareIntent: `class MainActivity : ReactActivity() {` not found in MainActivity.kt");
  if (!/\n([ \t]*)super\.onCreate\(/.test(src)) throw new Error("withShareIntent: super.onCreate( not found in MainActivity.kt");
  let out = src;
  // before React Native reads the start intent
  out = out.replace(/\n([ \t]*)super\.onCreate\(/, (m, indent) => `\n${indent}${MARK}(intent)\n${indent}super.onCreate(`);
  // while the app runs: an existing onNewIntent gets the call first, otherwise one is added
  const existing = out.match(/override\s+fun\s+onNewIntent\(\s*(\w+)\s*:\s*Intent\??\s*\)\s*\{[^\n]*\n/);
  if (existing) {
    const at = existing.index + existing[0].length;
    out = `${out.slice(0, at)}    ${MARK}(${existing[1]})\n${out.slice(at)}`;
    const head = out.match(/class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{[^\n]*\n/);
    const h = head.index + head[0].length;
    out = `${out.slice(0, h)}${HELPER}${out.slice(h)}`;
  } else {
    const head = out.match(/class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{[^\n]*\n/);
    const h = head.index + head[0].length;
    out = `${out.slice(0, h)}${HELPER}${NEW_INTENT}${out.slice(h)}`;
  }
  out = addImport(out, "android.content.Intent");
  out = addImport(out, "android.net.Uri");
  return out;
}

module.exports = { patchMainActivity, MARK };
