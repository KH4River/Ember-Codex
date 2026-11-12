import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

import { GameDatabase } from './database';
import { registerDatabaseIpc, registerPackIpc } from './ipc';

/** Where the Angular dev server runs. Must match the "serve" target. */
const DEV_SERVER_URL = 'http://localhost:4200/';

/**
 * Loads the dev server, retrying while it starts. `ng serve` binds late on a
 * cold build, so a fixed delay races it. The retry is driven by a failed
 * main-frame navigation rather than a timer, so it stops when the server answers.
 */
const loadDevServer = (win: BrowserWindow, url: string, attempts = 60): void => {
  const onFail = (
    _event: Electron.Event,
    _errorCode: number,
    _description: string,
    _failedUrl: string,
    isMainFrame: boolean,
  ): void => {
    // A failed stylesheet is not this function's problem. Only the document.
    if (!isMainFrame) {
      return;
    }
    win.webContents.removeListener('did-fail-load', onFail);
    if (attempts === 0) {
      console.error(`gave up loading ${url} after 60 attempts -- is "npm run serve" running?`);
      return;
    }
    setTimeout(() => {
      if (!win.isDestroyed()) {
        loadDevServer(win, url, attempts - 1);
      }
    }, 500);
  };

  win.webContents.on('did-fail-load', onFail);
  win.loadURL(url);
};

const createWindow = () => {
  const win = new BrowserWindow({
    show: false,
    // The Reload and Toggle Developer Tools accelerators live in the menu, so
    // removing the menu removes them too. Hide the bar instead and let Alt
    // reveal it.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(app.getAppPath(), 'electron', 'build', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // start window maximized
  win.maximize();

  // show once there is something to show. Showing first is what produced the
  // blank window: it appeared while ng serve was still starting.
  win.webContents.once('did-finish-load', () => win.show());

  // open Angular app with hot module reloading in development mode
  // and in production build when in prod mode
  if (!app.isPackaged) {
    console.log(`waiting for the dev server at ${DEV_SERVER_URL}`);
    loadDevServer(win, DEV_SERVER_URL);
  }

  // TODO: add logic for production (when app is packaged)
};

app.whenReady().then(() => {
  // On desktop the database lives in the main process. The renderer runs the
  // migrations and queries through IPC, so no schema knowledge lives here.
  const db = new GameDatabase(join(app.getPath('userData'), 'dnd.db'));
  registerDatabaseIpc(db);
  registerPackIpc();

  createWindow();

  // macOS apps generally continue running even without any windows open, so this
  // opens a new window if none is available and the app is activated
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// quitting the app when there are no windows open on non-macOS platforms
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});