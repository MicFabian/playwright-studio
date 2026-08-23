import { app, BrowserWindow, Menu, dialog, shell, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const installRoot = path.resolve(here, '..');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

let mainWindow = null;
let studioUrl = null;

async function readSettings() {
  try {
    const parsed = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSettings(patch) {
  const current = await readSettings();
  const next = { ...current, ...patch };

  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    // Losing a preference is not worth taking the app down for.
    console.warn('Could not save settings:', error.message);
  }

  return next;
}

async function looksLikeWorkspace(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    return false;
  }

  try {
    const stats = await fs.stat(path.join(directory, 'playwright-lowcode'));
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function resolveWorkspace() {
  const fromEnv = process.env.STUDIO_WORKSPACE_ROOT;

  if (fromEnv) {
    return fromEnv;
  }

  const { workspaceRoot } = await readSettings();

  if (workspaceRoot && (await looksLikeWorkspace(workspaceRoot))) {
    return workspaceRoot;
  }

  return null;
}

async function promptForWorkspace() {
  const result = await dialog.showOpenDialog({
    title: 'Choose a project folder',
    message: 'Pick the repository that holds (or should hold) your Playwright tests.',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Use this folder',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const chosen = result.filePaths[0];
  await writeSettings({ workspaceRoot: chosen });
  return chosen;
}

async function bootStudio(workspaceRoot) {
  process.env.STUDIO_WORKSPACE_ROOT = workspaceRoot;
  process.env.STUDIO_INSTALL_ROOT = installRoot;
  process.env.STUDIO_PROD = '1';

  if (app.isPackaged) {
    process.env.STUDIO_PACKAGED = '1';
  }
  process.env.PORT = process.env.PORT || '0';

  const { startStudio } = await import(path.join(installRoot, 'server.mjs'));
  const { url, server } = await startStudio();
  studioServer = server;

  return url;
}

async function restoreWindowBounds() {
  const { windowBounds } = await readSettings();
  return windowBounds ?? { width: 1440, height: 900 };
}

function trackWindowBounds(window) {
  const persist = () => {
    if (!window.isDestroyed() && !window.isMinimized()) {
      void writeSettings({ windowBounds: window.getBounds() });
    }
  };

  window.on('resize', persist);
  window.on('move', persist);
}

function safeProtocol(candidate) {
  try {
    return new URL(candidate).protocol;
  } catch {
    return '';
  }
}

// Compare parsed origins: a startsWith check would let http://127.0.0.1:51730
// pass for a Studio running on port 5173.
function isStudioOrigin(candidate) {
  try {
    return new URL(candidate).origin === new URL(studioUrl).origin;
  } catch {
    return false;
  }
}

async function createWindow() {
  const bounds = await restoreWindowBounds();

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1000,
    minHeight: 640,
    title: 'Playwright Studio',
    backgroundColor: '#141310',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(here, 'preload.cjs'),
    },
  });

  trackWindowBounds(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(safeProtocol(url))) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  // The renderer only ever loads the local Studio; anything else is a bug or an
  // attempt to navigate away, and is refused.
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!studioUrl || !isStudioOrigin(target)) {
      event.preventDefault();

      if (/^https?:$/.test(safeProtocol(target))) {
        void shell.openExternal(target);
      }
    }
  });

  mainWindow.on('page-title-updated', (event) => event.preventDefault());

  await mainWindow.loadURL(studioUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function switchWorkspace() {
  const chosen = await promptForWorkspace();

  if (!chosen) {
    return;
  }

  const unsaved = await mainWindow?.webContents
    .executeJavaScript('Boolean(window.__studioHasUnsavedWork?.())')
    .catch(() => false);

  if (unsaved) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: 'This flow has unsaved changes.',
      detail: 'Save them before opening the other folder?',
      buttons: ['Save and open', 'Discard and open', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });

    if (response === 2) {
      return;
    }

    if (response === 0) {
      await mainWindow?.webContents
        .executeJavaScript('window.__studioSaveNow?.()')
        .catch(() => undefined);
    }
  }

  // The relaunched process inherits this environment, and it takes priority
  // over the stored setting, so it must point at the new folder.
  process.env.STUDIO_WORKSPACE_ROOT = chosen;

  await shutdown();
  app.relaunch();
  app.exit(0);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New flow',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('studio:command', 'new-flow'),
        },
        {
          label: 'Save flow',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('studio:command', 'save'),
        },
        { type: 'separator' },
        {
          label: 'Import a spec…',
          click: () => mainWindow?.webContents.send('studio:command', 'import'),
        },
        {
          label: 'Open project folder…',
          click: () => void switchWorkspace(),
        },
        {
          label: 'Reveal workspace in file manager',
          click: () => void shell.openPath(process.env.STUDIO_WORKSPACE_ROOT ?? installRoot),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('studio:command', 'undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow?.webContents.send('studio:command', 'redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Command palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.send('studio:command', 'palette'),
        },
      ],
    },
    {
      label: 'Run',
      submenu: [
        {
          label: 'Run flow',
          accelerator: 'CmdOrCtrl+Return',
          click: () => mainWindow?.webContents.send('studio:command', 'run'),
        },
        {
          label: 'Run headed',
          accelerator: 'CmdOrCtrl+Shift+Return',
          click: () => mainWindow?.webContents.send('studio:command', 'run-headed'),
        },
        {
          label: 'Stop run',
          accelerator: 'CmdOrCtrl+.',
          click: () => mainWindow?.webContents.send('studio:command', 'cancel'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Studio documentation',
          click: () =>
            void shell.openExternal('https://github.com/MicFabian/playwright-studio#readme'),
        },
        {
          label: 'Playwright documentation',
          click: () => void shell.openExternal('https://playwright.dev/docs/intro'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let studioServer = null;

async function shutdown() {
  await new Promise((resolve) => {
    if (!studioServer) {
      resolve();
      return;
    }

    studioServer.close(() => resolve());
    setTimeout(resolve, 2000).unref?.();
  });
}

async function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow.focus();
    }
  });

  app.on('before-quit', () => {
    void shutdown();
  });

  await app.whenReady();

  ipcMain.handle('studio:workspace-root', () => process.env.STUDIO_WORKSPACE_ROOT ?? null);
  ipcMain.handle('studio:choose-workspace', () => switchWorkspace());

  let workspaceRoot = await resolveWorkspace();

  if (!workspaceRoot) {
    workspaceRoot = await promptForWorkspace();
  }

  if (!workspaceRoot) {
    app.quit();
    return;
  }

  try {
    studioUrl = await bootStudio(workspaceRoot);
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Studio could not start',
      message: error instanceof Error ? error.message : String(error),
      detail: `Workspace: ${workspaceRoot}`,
    });
    app.quit();
    return;
  }

  buildMenu();
  await createWindow();

  if (process.env.STUDIO_SELFTEST === '1' && !app.isPackaged) {
    const report = await mainWindow.webContents.executeJavaScript(
      `(async () => {
         const deadline = Date.now() + 15000;
         while (!document.querySelector('.studio') && Date.now() < deadline) {
           await new Promise((r) => setTimeout(r, 200));
         }
         return {
           rendered: !!document.querySelector('.studio'),
           bridge: !!window.studioDesktop,
           platform: window.studioDesktop?.platform ?? null,
           steps: window.__studioStepCount?.() ?? -1,
           flows: [...document.querySelectorAll('.explorer__list button')].length,
           title: document.title,
         };
       })()`,
    );

    console.log('SELFTEST ' + JSON.stringify(report));
    app.exit(0);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

void main();
