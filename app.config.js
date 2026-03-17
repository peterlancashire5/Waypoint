/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'Waypoint',
  slug: 'waypoint',
  scheme: 'waypoint',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#F8F7F5',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.peterlancashire.waypoint',
    infoPlist: {
      LSApplicationQueriesSchemes: ['comgooglemaps', 'maps'],
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#F8F7F5',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    package: 'com.waypoint.app',
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    'expo-web-browser',
    './plugins/withoutAppleSignInEntitlement',
    'expo-apple-authentication',
  ],
  experiments: {
    typedRoutes: true,
  },
};

module.exports = config;
