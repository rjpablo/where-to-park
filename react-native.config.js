// @expo/metro-runtime 58 pulls SDK 58 native modules that need
// expo-module-gradle-plugin (SDK 51+). This app is Expo 50.
module.exports = {
  dependencies: {
    '@expo/dom-webview': { platforms: { android: null, ios: null } },
    '@expo/log-box': { platforms: { android: null, ios: null } },
  },
};
