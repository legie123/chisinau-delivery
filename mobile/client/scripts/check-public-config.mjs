// Gate: the Google Maps key must never reach the PUBLIC Expo config (it ships inside the app and
// in update manifests). Runs `expo config --type public` with a sentinel value in the build env
// and fails if the sentinel shows up anywhere in the output. No real key is needed or used.
import { execFileSync } from "node:child_process";

const SENTINEL = "SENTINEL-NOT-A-REAL-MAPS-VALUE-7731";
const out = execFileSync("npx", ["expo", "config", "--type", "public", "--json"], {
  env: { ...process.env, ["GOOGLE_MAPS_" + "ANDROID_API_KEY"]: SENTINEL },
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
const hits = out.split(SENTINEL).length - 1;
if (hits > 0) {
  console.error(`✗ Maps value present ${hits}x in the public Expo config`);
  process.exit(1);
}
console.log("✓ public Expo config carries no Maps value");
