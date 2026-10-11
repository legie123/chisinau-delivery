import type { ExpoConfig } from "expo/config";

// Courier app — built in the cloud with EAS Build (no Xcode/Android Studio on the
// dev Mac). Supabase config comes ONLY from EXPO_PUBLIC_* (see src/lib/supabase.ts,
// which refuses to start without them). EAS_PROJECT_ID is written by `eas init`
// and is what getExpoPushTokenAsync() needs to mint an Expo push token.

const LOCATION_ALWAYS =
  "Dragons Curier folosește locația ta și în fundal, doar cât ai o livrare activă, ca să vadă clientul unde e comanda lui.";
const LOCATION_WHEN_IN_USE =
  "Dragons Curier folosește locația ta ca să-ți arate poziția pe hartă și distanța până la restaurant.";

// Android map tiles need a Google Maps key (iOS uses Apple Maps). It comes ONLY from
// the build env, never from the repo, and goes ONLY to android.config.googleMaps: prebuild
// writes it into the manifest (proved with `expo prebuild`), and Expo strips android.config
// from the PUBLIC config that ships inside the app and in update manifests. Passing it as a
// react-native-maps plugin prop (as mobile/client does) would also put it in the public config.
// Restrict the key to the package + signing SHA in Google Cloud: a manifest key is readable.
const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

const config: ExpoConfig = {
  name: "Dragons Curier",
  slug: "dragons-curier",
  scheme: "dragonscurier",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/brand-icon.png",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "md.dragonsdelivery.curier",
    supportsTablet: false,
    infoPlist: {
      UIBackgroundModes: ["location", "remote-notification"],
      NSLocationAlwaysAndWhenInUseUsageDescription: LOCATION_ALWAYS,
      NSLocationWhenInUseUsageDescription: LOCATION_WHEN_IN_USE,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "md.dragonsdelivery.curier",
    adaptiveIcon: {
      foregroundImage: "./assets/brand-adaptive-icon.png",
      backgroundColor: "#0D0D1F",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: [
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "POST_NOTIFICATIONS",
    ],
    predictiveBackGestureEnabled: false,
    ...(mapsKey ? { config: { googleMaps: { apiKey: mapsKey } } } : {}),
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-font",
    "expo-status-bar",
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission: LOCATION_ALWAYS,
        locationAlwaysPermission: LOCATION_ALWAYS,
        locationWhenInUsePermission: LOCATION_WHEN_IN_USE,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/android-icon-monochrome.png",
        color: "#E94560",
        enableBackgroundRemoteNotifications: true,
      },
    ],
    "expo-task-manager",
    // Proof-of-delivery photo: camera only. Microphone and photo library are blocked (false removes
    // the iOS key and blocks the Android permission), so the stores see only what the app uses.
    [
      "expo-image-picker",
      {
        cameraPermission: "Dragons Curier folosește camera doar ca să fotografiezi comanda predată, ca dovadă de livrare.",
        microphonePermission: false,
        photosPermission: false,
      },
    ],
    // The app never uses Face ID: without this the plugin adds an English
    // NSFaceIDUsageDescription to Info.plist.
    ["expo-secure-store", { faceIDPermission: false }],
  ],
  extra: {
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
};

export default config;
