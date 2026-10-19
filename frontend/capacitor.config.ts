import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kiro.youtube',
  appName: 'YouTube Clone',
  webDir: 'out',
  bundledWebRuntime: false,
  server: {
    cleartext: true
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
