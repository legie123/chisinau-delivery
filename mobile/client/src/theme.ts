import { Platform } from 'react-native';

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

// Luxury "Dragons Alliance Premium" extensions (synced with web identity)
export const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

export const CARD_TINTS: Record<string, [string, string]> = {
  sushi: ['#1a1023', '#58152a'],
  fine_dining: ['#171226', '#4a350f'],
  other: ['#141426', '#263056'],
};
