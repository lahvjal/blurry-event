export const colors = {
  // Backgrounds
  bg: '#131715',
  bgElevated: '#1b201d',
  bgCard: '#161917',
  bgDeep: '#0f1110',
  bgInput: '#121d17',

  // Gradients (top, bottom)
  gradCta: ['#203329', '#1b2a22'] as const,
  gradPanel: ['#203329', '#151e19'] as const,
  gradCardDark: ['#0f1110', '#111513'] as const,
  gradCardActive: ['#203329', '#17261e'] as const,

  // Text
  textPrimary: '#ffffff',
  textSupporting: '#b6d8c6',
  textMuted: '#5b645b',
  highlight: '#7bffb2',
  link: '#5d9273',

  // Misc
  border: 'rgba(255,255,255,0.08)',
  navGlass: 'rgba(30,36,33,0.5)',
  badgeGlass: 'rgba(255,255,255,0.11)',
  scorePill: 'rgba(209,231,209,0.06)',
  buttonMuted: '#5b645b',
} as const;

export const fonts = {
  serif: 'InstrumentSerif_400Regular',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const spacing = {
  '2xs': 4,
  xs: 6,
  sm: 8,
  md: 10,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
} as const;
