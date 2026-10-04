import React from 'react';
import { registerRootComponent } from 'expo';
import { Text, View } from 'react-native';

// Load order matters:
//  1. src/lib/backgroundLocation defines the GPS TaskManager task at module top
//     level — it must exist before the OS re-launches the app headless to
//     deliver background locations.
//  2. Both it and App create the Supabase client, which THROWS when
//     EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY were not set at build time. A release
//     build must say so on screen, not crash to the home screen with no word.
let Root: React.ComponentType;
try {
  require('./src/lib/backgroundLocation');
  Root = require('./App').default;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  Root = function ConfigError() {
    return React.createElement(
      View,
      { style: { flex: 1, backgroundColor: '#0D0D1F', justifyContent: 'center', padding: 24 } },
      React.createElement(Text, { style: { color: '#E94560', fontSize: 20, fontWeight: '800', marginBottom: 12 } }, 'Aplicația nu poate porni'),
      React.createElement(Text, { style: { color: '#FFFFFF', fontSize: 14, lineHeight: 20 } }, message),
    );
  };
}

registerRootComponent(Root);
