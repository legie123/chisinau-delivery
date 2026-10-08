// app.json holds the static config; this only injects build-time values that must
// not be committed: the Google Maps key (Android map tiles; iOS uses Apple Maps) and
// the EAS project id (needed for Expo push tokens). Both come from EAS env / .env.
// Without them (Expo Go, local export) the config is app.json unchanged.
module.exports = ({ config }) => {
  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  const projectId = process.env.EAS_PROJECT_ID;
  return {
    ...config,
    // The key is given twice on purpose. react-native-maps ships its own config plugin (the
    // documented SDK 57 setup) which REMOVES the manifest key unless it gets it as a prop;
    // prebuild's built-in fallback reads `android.config.googleMaps` instead. Which one runs
    // depends on autolinking, so both get the key and neither can strip it.
    android: {
      ...config.android,
      ...(mapsKey ? { config: { ...(config.android?.config ?? {}), googleMaps: { apiKey: mapsKey } } } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      ...(mapsKey ? [["react-native-maps", { androidGoogleMapsApiKey: mapsKey }]] : []),
    ],
    extra: {
      ...(config.extra ?? {}),
      ...(projectId ? { eas: { ...(config.extra?.eas ?? {}), projectId } } : {}),
    },
  };
};
