// Font family names — must match keys passed to useFonts()
export const fonts = {
  displayRegular: 'PlayfairDisplay_400Regular',
  displayItalic: 'PlayfairDisplay_400Regular_Italic',
  displayBold: 'PlayfairDisplay_700Bold',
  displayBoldItalic: 'PlayfairDisplay_700Bold_Italic',
  bodyLight: 'Lato_300Light',
  body: 'Lato_400Regular',
  bodyBold: 'Lato_700Bold',
} as const;

// Reusable text style presets
export const textStyles = {
  heroTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 52,
    lineHeight: 60,
    letterSpacing: -0.5,
  },
  pageTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 36,
    lineHeight: 44,
    letterSpacing: -0.3,
  },
  sectionHeading: {
    fontFamily: fonts.displayBold,
    fontSize: 26,
    lineHeight: 32,
  },
  cardTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 26,
  },
  bodyLarge: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 26,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
  },
  bodySmall: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
  },
} as const;
