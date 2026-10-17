import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { DatabaseService } from './data/database.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Open the database and apply migrations before the first render. A failure
    // is logged rather than fatal: a blank app is a worse experience than a
    // screen that reports the database is unavailable.
    provideAppInitializer(async () => {
      try {
        const database = inject(DatabaseService);
        await database.initialize();
        console.info(`SQLite ${await database.sqliteVersion()}`);
      } catch (error) {
        console.error('Database initialization failed', error);
      }
    }),
  ],
};
