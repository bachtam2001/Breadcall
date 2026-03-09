# BreadCall NDI Client

Desktop application that receives WebRTC streams from BreadCall server and outputs them as NDI sources on the local network.

## Features

- **WebRTC Receiver**: Connect to BreadCall signaling server and receive video/audio streams
- **NDI Output**: Output streams as NDI sources for OBS, vMix, and other NDI-compatible software
- **Multi-Stream**: Receive and output multiple participant streams simultaneously
- **Cross-Platform**: Works on Windows, macOS, and Linux

## Requirements

### Minimum Requirements
- Node.js 18+
- WebRTC-compatible network (STUN/TURN configured if behind NAT)

### For NDI Output (Optional)
- **NewTek NDI SDK** - Download from [ndi.video](https://ndi.video/)
- **Windows**: Visual Studio Build Tools 2019+
- **macOS**: Xcode Command Line Tools
- **Linux**: build-essential, libndi-dev

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Install NDI SDK (Optional)

If you want NDI output functionality:

1. Download NDI SDK from https://ndi.video/
2. Install the SDK
3. Set environment variable:
   - **Windows**: `set NDI_SDK_DIR=C:\Program Files\NewTek\NDI SDK`
   - **macOS**: `export NDI_SDK_DIR=/Library/NDI SDK for macOS`
   - **Linux**: `export NDI_SDK_DIR=/opt/ndi`

### 3. Build Native Addon (For NDI Output)

```bash
# Install NAN (Node.js Native Abstractions)
npm install nan --save

# Build the native addon
npm run build-ndi

# Or manually
node-gyp rebuild
```

## Usage

### Development Mode

```bash
npm run dev
```

### Production Build

```bash
# Build for current platform
npm run build

# Build for specific platform
npm run build:win
npm run build:linux
npm run build:mac
```

### Using the Application

1. **Enter Server URL**: Your BreadCall signaling server URL (e.g., `http://localhost:3000`)
2. **Enter Room ID**: The 4-letter room code
3. **Click Connect**: Join the room as a silent viewer
4. **Enable NDI**: Toggle NDI output for each stream you want to output

### NDI Sources

Once enabled, streams appear as NDI sources on your network:
- Source name format: `BreadCall - [ParticipantName]`
- Accessible by any NDI receiver on the same network
- Use in OBS: Add > NDI Source > Select source

## Project Structure

```
ndi-client/
├── src/
│   ├── main.js              # Electron main process
│   ├── preload.js           # Context bridge for IPC
│   ├── WebRTCReceiver.js    # WebRTC stream receiver
│   ├── NDIOutput.js         # NDI SDK binding
│   ├── lib/
│   │   └── ndi-native.cpp   # Native C++ addon
│   └── ui/
│       ├── index.html       # UI markup
│       ├── styles.css       # UI styles
│       └── renderer.js      # UI logic
├── package.json
├── binding.gyp              # Native addon build config
└── README.md
```

## API

### WebRTCReceiver

```javascript
const { WebRTCReceiver } = require('./WebRTCReceiver');

const receiver = new WebRTCReceiver();

// Connect to room
await receiver.connect('ws://localhost:3000/ws', 'ABCD');

// Handle incoming streams
receiver.on('stream', (peerId, stream) => {
  console.log('Received stream from', peerId);
});

// Get stream for peer
const stream = receiver.getStream('peer-id');

// Disconnect
await receiver.disconnect();
```

### NDIOutput

```javascript
const { NDIOutput } = require('./NDIOutput');

const ndi = new NDIOutput();

// Add source
ndi.addSource('peer-id', stream);

// Remove source
ndi.removeSource('peer-id');

// Get active sources
const sources = ndi.getActiveSources();

// Cleanup
ndi.cleanup();
```

## Troubleshooting

### NDI SDK Not Found

```
[NDIOutput] NDI native addon not available - running in mock mode
```

**Solution**: Ensure NDI SDK is installed and `NDI_SDK_DIR` is set correctly.

### WebRTC Connection Fails

**Solutions**:
1. Check server URL is accessible from your network
2. Configure STUN/TURN servers if behind NAT
3. Check firewall settings (ports 3478, 49152-65535)

### No NDI Sources Appearing

**Solutions**:
1. Enable NDI output for streams in the UI
2. Check NDI SDK is properly installed
3. Verify NDI sources in OBS or NDI Studio Monitor

## License

ISC
