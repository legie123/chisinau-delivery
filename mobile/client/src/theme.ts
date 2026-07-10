export const COLORS = {
  background: '#0D0D1F',
  surface: '#1A1A2E',
  surfaceLight: '#252540',
  card: '#1E1E35',
  cardBorder: 'rgba(255,255,255,0.06)',
  primary: '#E94560',
  primaryDark: '#c73050',
  gold: '#F5A623',
  goldLight: '#FFD700',
  white: '#FFFFFF',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.6)',
  textMuted: 'rgba(255,255,255,0.4)',
  success: '#4ade80',
  warning: '#F5A623',
  error: '#E94560',
  border: 'rgba(255,255,255,0.08)',
  glass: 'rgba(30,30,53,0.85)',
};

export const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
  black: 'System',
};

export const SHADOWS = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  button: {
    shadowColor: '#E94560',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
};

// Backend-ul real e Supabase (vezi ../../supabase/) — la conectare, înlocuiește
// mock-urile din screens cu @supabase/supabase-js. Pentru un API HTTP local:
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
