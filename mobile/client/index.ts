import { registerRootComponent } from 'expo';
import { supabaseConfig } from './src/lib/config';
import ConfigErrorScreen from './src/screens/ConfigErrorScreen';

// Config is checked BEFORE anything imports the Supabase client: a build without
// EXPO_PUBLIC_SUPABASE_* shows a red, readable screen instead of silently talking
// to a wrong backend (the old hard-coded fallback) or crashing on a blank screen.
let configError: string | null = null;
try {
  supabaseConfig();
} catch (err) {
  configError = err instanceof Error ? err.message : String(err);
}

if (configError) {
  const message = configError;
  registerRootComponent(() => ConfigErrorScreen({ message }));
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  registerRootComponent(require('./App').default);
}
