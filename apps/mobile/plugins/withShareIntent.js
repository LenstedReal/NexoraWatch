// Expo config plugin: Share -> Nexora Watch. app.json registers MainActivity for shared text (ACTION_SEND,
// text/plain); this plugin makes React Native's Linking deliver such a share as nexora://share?text=… (see
// shareIntentPatch.js). App.tsx takes the link out of it and sends it to the room.
const { withMainActivity } = require("expo/config-plugins");
const { patchMainActivity } = require("./shareIntentPatch");

module.exports = function withShareIntent(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== "kt") throw new Error("withShareIntent: MainActivity is not Kotlin");
    cfg.modResults.contents = patchMainActivity(cfg.modResults.contents);
    return cfg;
  });
};
