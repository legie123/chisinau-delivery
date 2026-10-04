// app.json holds the static config; this only injects build-time values that must
// not be committed: the Google Maps key (Android map tiles; iOS uses Apple Maps) and
// the EAS project id (needed for Expo push tokens). Both come from EAS env / .env.
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
