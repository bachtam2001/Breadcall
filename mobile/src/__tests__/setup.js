// Mock react-native-webrtc
jest.mock('react-native-webrtc', () => ({
  mediaDevices: {
    getUserMedia: jest.fn(() => Promise.resolve({
      getTracks: jest.fn(() => []),
      getVideoTracks: jest.fn(() => []),
      getAudioTracks: jest.fn(() => []),
    })),
    getDisplayMedia: jest.fn(() => Promise.resolve({
      getTracks: jest.fn(() => []),
    })),
    enumerateDevices: jest.fn(() => Promise.resolve([])),
  },
  MediaStream: jest.fn().mockImplementation(() => ({
    id: 'mock-stream-id',
    getTracks: jest.fn(() => []),
    getVideoTracks: jest.fn(() => []),
    getAudioTracks: jest.fn(() => []),
    addTrack: jest.fn(),
    removeTrack: jest.fn(),
  })),
  RTCPeerConnection: jest.fn().mockImplementation(() => ({
    addTrack: jest.fn(),
    removeTrack: jest.fn(),
    createOffer: jest.fn(() => Promise.resolve({})),
    createAnswer: jest.fn(() => Promise.resolve({})),
    setLocalDescription: jest.fn(() => Promise.resolve()),
    setRemoteDescription: jest.fn(() => Promise.resolve()),
    addIceCandidate: jest.fn(() => Promise.resolve()),
    close: jest.fn(),
    getSenders: jest.fn(() => []),
    getReceivers: jest.fn(() => []),
  })),
  RTCSessionDescription: jest.fn().mockImplementation((desc) => desc),
  RTCIceCandidate: jest.fn().mockImplementation((candidate) => candidate),
  registerGlobals: jest.fn(),
}));

// Mock SignalingService
jest.mock('../services/SignalingService', () => ({
  connect: jest.fn(() => Promise.resolve()),
  disconnect: jest.fn(),
  joinRoom: jest.fn(),
  leaveRoom: jest.fn(),
  sendOffer: jest.fn(),
  sendAnswer: jest.fn(),
  sendIceCandidate: jest.fn(),
  sendChatMessage: jest.fn(),
  sendMuteStatus: jest.fn(),
  isConnected: jest.fn(() => true),
  getParticipantId: jest.fn(() => 'mock-participant-id'),
  on: jest.fn(),
  off: jest.fn(),
  removeAllListeners: jest.fn(),
  emit: jest.fn(),
}));

// Mock WebRTCService
jest.mock('../services/WebRTCService', () => ({
  initLocalStream: jest.fn(() => Promise.resolve({})),
  createPeerConnection: jest.fn(),
  createOffer: jest.fn(() => Promise.resolve({})),
  handleOffer: jest.fn(() => Promise.resolve({})),
  handleAnswer: jest.fn(() => Promise.resolve({})),
  addIceCandidate: jest.fn(() => Promise.resolve()),
  removePeer: jest.fn(),
  toggleAudio: jest.fn(),
  toggleVideo: jest.fn(),
  switchCamera: jest.fn(() => Promise.resolve(true)),
  getPeers: jest.fn(() => new Map()),
  getLocalStream: jest.fn(() => null),
  cleanup: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  removeAllListeners: jest.fn(),
  emit: jest.fn(),
}));

// Mock ScreenShareService
jest.mock('../services/ScreenShareService', () => ({
  startCapture: jest.fn(() => Promise.resolve({})),
  stopCapture: jest.fn(),
  isSupported: jest.fn(() => true),
  isAudioCaptureSupported: jest.fn(() => true),
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
}));
