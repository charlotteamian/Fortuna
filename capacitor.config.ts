import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fortuna.wealthtracker',
  appName: 'Fortuna',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#06080f',
  },
  ios: {
    backgroundColor: '#06080f',
  },
};

export default config;
