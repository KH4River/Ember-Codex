import type { CapacitorConfig } from '@capacitor/cli';

// Mobile only. Desktop is a separate raw-Electron shell; Electron main owns
// the database there. Mobile runs shared/db in a worker, so the UI thread
// never imports it; a typed native plugin would remove it from the webview.
const config: CapacitorConfig = {
  appId: 'com.embercodex.app',
  appName: 'Ember Codex',
  webDir: 'angular/dist/ember-codex/browser',
};

export default config;
