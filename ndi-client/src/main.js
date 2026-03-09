const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { WebRTCReceiver } = require('./WebRTCReceiver');
const { NDIOutput } = require('./NDIOutput');

let mainWindow;
let webrtcReceiver;
let ndiOutput;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  mainWindow.loadFile('src/ui/index.html');

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize WebRTC receiver
function initWebRTC() {
  webrtcReceiver = new WebRTCReceiver();

  webrtcReceiver.on('stream', (peerId, stream) => {
    mainWindow.webContents.send('stream-received', { peerId, hasVideo: true, hasAudio: true });
  });

  webrtcReceiver.on('peer-joined', (peerId) => {
    mainWindow.webContents.send('peer-joined', { peerId });
  });

  webrtcReceiver.on('peer-left', (peerId) => {
    mainWindow.webContents.send('peer-left', { peerId });
    if (ndiOutput) {
      ndiOutput.removeSource(peerId);
    }
  });

  webrtcReceiver.on('error', (error) => {
    mainWindow.webContents.send('error', { message: error.message });
  });
}

// Initialize NDI output
function initNDI() {
  try {
    ndiOutput = new NDIOutput();
    console.log('[NDI Client] NDI output initialized');
  } catch (error) {
    console.warn('[NDI Client] NDI initialization failed (NDI SDK not installed):', error.message);
    console.warn('[NDI Client] Running in WebRTC preview mode only');
  }
}

// IPC Handlers
ipcMain.handle('connect', async (event, { serverUrl, roomId }) => {
  try {
    if (!webrtcReceiver) initWebRTC();
    if (!ndiOutput) initNDI();

    await webrtcReceiver.connect(serverUrl, roomId);
    return { success: true };
  } catch (error) {
    console.error('[NDI Client] Connect error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect', async () => {
  if (webrtcReceiver) {
    await webrtcReceiver.disconnect();
  }
  return { success: true };
});

ipcMain.handle('toggle-ndi', async (event, { peerId, enabled }) => {
  if (!ndiOutput) {
    return { success: false, error: 'NDI SDK not available' };
  }

  if (enabled) {
    const stream = webrtcReceiver.getStream(peerId);
    if (stream) {
      ndiOutput.addSource(peerId, stream);
      return { success: true };
    }
    return { success: false, error: 'Stream not found' };
  } else {
    ndiOutput.removeSource(peerId);
    return { success: true };
  }
});

ipcMain.handle('get-ndi-status', async () => {
  if (!ndiOutput) {
    return { available: false };
  }
  return {
    available: true,
    active: ndiOutput.isActive(),
    sources: ndiOutput.getActiveSources()
  };
});

ipcMain.handle('get-peers', async () => {
  if (!webrtcReceiver) return [];
  return webrtcReceiver.getPeers();
});

app.whenReady().then(() => {
  createWindow();
  initWebRTC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (webrtcReceiver) {
    webrtcReceiver.disconnect();
  }
  if (ndiOutput) {
    ndiOutput.cleanup();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (webrtcReceiver) {
    webrtcReceiver.disconnect();
  }
  if (ndiOutput) {
    ndiOutput.cleanup();
  }
});
