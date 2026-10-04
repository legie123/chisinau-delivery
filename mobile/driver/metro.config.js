// Metro for an app that is NOT a member of the root npm workspace
// (root workspaces = packages/* only). The shared packages are consumed straight
// from source:
//   - watchFolders: Metro only bundles files under projectRoot or a watch folder.
//   - extraNodeModules: maps the bare @chisinau/* names to the package dirs.
//     On EAS Build only this app's own `npm ci` runs, so the root
//     node_modules/@chisinau symlinks do NOT exist there — this alias is what
//     resolves them (local `expo export` is run without the root node_modules
//     to prove exactly that).
// The packages import @supabase/supabase-js as `import type` only, so no second
// supabase-js copy (and no second auth session) can get bundled.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const packagesRoot = path.resolve(projectRoot, "../../packages");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), packagesRoot];
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "@chisinau/shared-types": path.join(packagesRoot, "shared-types"),
  "@chisinau/shared-api": path.join(packagesRoot, "shared-api"),
  "@chisinau/shared-domain": path.join(packagesRoot, "shared-domain"),
};

module.exports = config;
