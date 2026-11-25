import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { DatabaseService } from './shell/database.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Desktop main opens and migrates before the window loads; mobile opens on
    // the first call. A failure is logged rather than fatal: a blank app is a
    // worse experience than a screen that reports the database is unavailable.
    provideAppInitializer(async () => {
      try {
        const database = inject(DatabaseService);
        console.info(`SQLite ${await database.sqliteVersion()}`);
      } catch (error) {
        console.error('Database unavailable', error);
      }
    }),
  ],
};
