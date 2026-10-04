// Metro must reach the repo's shared TypeScript packages (../../packages/*), which
// live OUTSIDE this app root and are NOT installed into this app's node_modules.
// - watchFolders: lets Metro read + watch files under packages/.
// - extraNodeModules: maps the @chisinau/* names straight to the package dirs, so the
//   import works with no root `npm install` (EAS Build installs only this app's deps).
// - nodeModulesPaths: a file under packages/ resolves third-party imports from THIS
//   app's node_modules (one React / one supabase-js), never from a stray root copy.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');
const packagesDir = path.join(repoRoot, 'packages');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), packagesDir];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@chisinau/shared-types': path.join(packagesDir, 'shared-types'),
  '@chisinau/shared-api': path.join(packagesDir, 'shared-api'),
  '@chisinau/shared-domain': path.join(packagesDir, 'shared-domain'),
};

module.exports = config;
