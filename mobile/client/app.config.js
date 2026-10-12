// app.json holds the static config; this only injects build-time values that must
// not be committed: the Google Maps key (Android map tiles; iOS uses Apple Maps) and
// the EAS project id (needed for Expo push tokens). Both come from EAS env / .env.
// Without them (Expo Go, local export) the config is app.json unchanged.
//
// The Maps key goes ONLY to android.config.googleMaps: prebuild writes it into the manifest
// and Expo strips android.config from the PUBLIC config that ships inside the app and in
// update manifests. A react-native-maps plugin prop would also land in the public config
// (scripts/check-public-config.mjs fails on it). Same pattern as mobile/driver/app.config.ts.
// Restrict the key to the package + signing SHA in Google Cloud: a manifest key is readable.
module.exports = ({ config }) => {
  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  const projectId = process.env.EAS_PROJECT_ID;
  return {
    ...config,
    android: {
      ...config.android,
      ...(mapsKey ? { config: { ...(config.android?.config ?? {}), googleMaps: { apiKey: mapsKey } } } : {}),
    },
    extra: {
      ...(config.extra ?? {}),
      ...(projectId ? { eas: { ...(config.extra?.eas ?? {}), projectId } } : {}),
    },
  };
};
