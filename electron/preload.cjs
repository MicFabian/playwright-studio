const { contextBridge, ipcRenderer } = require('electron');

// The renderer is sandboxed with context isolation; this is the entire surface
// it can reach, and none of it exposes Node or the filesystem directly.
contextBridge.exposeInMainWorld('studioDesktop', {
  isDesktop: true,
  platform: process.platform,
  onCommand: (handler) => {
    const listener = (_event, command) => handler(command);
    ipcRenderer.on('studio:command', listener);
    return () => ipcRenderer.off('studio:command', listener);
  },
  workspaceRoot: () => ipcRenderer.invoke('studio:workspace-root'),
  chooseWorkspace: () => ipcRenderer.invoke('studio:choose-workspace'),
});
