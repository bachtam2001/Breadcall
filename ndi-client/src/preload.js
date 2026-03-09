const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  connect: (serverUrl, roomId) => ipcRenderer.invoke('connect', { serverUrl, roomId }),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  toggleNDI: (peerId, enabled) => ipcRenderer.invoke('toggle-ndi', { peerId, enabled }),
  getNDIStatus: () => ipcRenderer.invoke('get-ndi-status'),
  getPeers: () => ipcRenderer.invoke('get-peers'),

  // Event listeners
  onStreamReceived: (callback) => {
    ipcRenderer.on('stream-received', (event, data) => callback(data));
  },
  onPeerJoined: (callback) => {
    ipcRenderer.on('peer-joined', (event, data) => callback(data));
  },
  onPeerLeft: (callback) => {
    ipcRenderer.on('peer-left', (event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on('error', (event, data) => callback(data));
  }
});
