# BreadCall Mobile

React Native mobile application for BreadCall - WebRTC live production platform.

## Features

- **WebRTC Video Calls**: Join rooms and participate in video calls
- **Screen Sharing**: Share your screen with system audio (Android 10+, iOS 14+)
- **Multi-Participant**: Support for multiple participants in a room
- **Auto-Reconnect**: Automatic reconnection to signaling server
- **Dark Theme**: Modern dark theme UI

## Requirements

### Android
- Android 5.0 (API 21) or higher
- Android Studio Arctic Fox or newer
- JDK 11 or higher

### iOS
- iOS 13.0 or higher
- Xcode 15.0 or newer
- CocoaPods

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. iOS Setup

```bash
cd ios
pod install
cd ..
```

### 3. Android Setup

Ensure you have Android SDK and Android Studio set up. Create `android/local.properties` with:

```
sdk.dir=/path/to/android/sdk
```

## Running the App

### Android

```bash
# Debug
npm run android

# Release build
npm run build:android
```

### iOS

```bash
# Debug
npm run ios

# Release build
npm run build:ios
```

### Metro Bundler

```bash
npm start
```

## Project Structure

```
mobile/
├── src/
│   ├── App.js                    # Main app component with navigation
│   ├── services/
│   │   ├── SignalingService.js   # WebSocket signaling client
│   │   ├── WebRTCService.js      # WebRTC PeerConnection manager
│   │   └── ScreenShareService.js # Screen capture with system audio
│   ├── screens/
│   │   ├── HomeScreen.js         # Landing screen (create/join room)
│   │   └── RoomScreen.js         # Room with video grid and controls
│   ├── components/               # Reusable UI components
│   └── navigation/               # Navigation configuration
├── android/
│   └── app/src/main/java/com/breadcall/
│       ├── ScreenCaptureModule.java    # Native screen capture module
│       ├── ScreenCaptureService.java   # Foreground service
│       └── BreadCallPackage.java       # React Native package
├── ios/
│   └── BreadCall/
│       └── ScreenCaptureModule.m       # iOS native module (ReplayKit)
├── package.json
└── README.md
```

## Native Modules

### Android Screen Capture

Uses `MediaProjection` API for screen capture and `AudioPlaybackCapture` API for system audio (Android 10+).

**Permissions required in `AndroidManifest.xml`:**

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

### iOS Screen Capture

Uses `ReplayKit` for screen capture. Requires a Broadcast Upload Extension.

**To create the extension:**

1. Open `ios/BreadCall.xcworkspace` in Xcode
2. File > New > Target > Broadcast Upload Extension
3. Name it `BroadcastUploadExtension`
4. Add to App Group: `group.com.breadcall`
5. Copy `SampleHandler.swift` code from `ScreenCaptureModule.m` comments

## WebRTC Integration

The app uses `react-native-webrtc` for WebRTC functionality:

- **PeerConnection**: Mesh topology (P2P connections between all participants)
- **ICE Servers**: Google STUN servers + optional TURN servers
- **Codecs**: H.264 (preferred), VP8, VP9
- **Simulcast**: Not yet implemented

## Signaling Protocol

Compatible with BreadCall signaling server:

```javascript
// Join room
{ type: 'join-room', payload: { roomId, name, password } }

// WebRTC signaling
{ type: 'offer', payload: { targetPeerId, sdp } }
{ type: 'answer', payload: { targetPeerId, sdp } }
{ type: 'ice-candidate', payload: { targetPeerId, candidate } }

// Room events
{ type: 'participant-joined', participantId, name }
{ type: 'participant-left', participantId }
```

## Screen Sharing

### Android (10+)

1. Request `MediaProjection` permission
2. Start foreground service (required for Android 10+)
3. Create `VirtualDisplay` for screen capture
4. Use `AudioPlaybackCapture` API for system audio

### iOS (14+)

1. Show `RPSystemBroadcastPickerView`
2. User selects Broadcast Upload Extension
3. Extension captures frames via `ReplayKit`
4. Frames sent to app via App Group IPC

## Troubleshooting

### Android: Can't get screen capture

1. Ensure app has overlay permission
2. Check foreground service is running
3. Android 10+ requires user to grant screen capture permission each time

### iOS: Broadcast extension not appearing

1. Ensure App Group is configured in both app and extension
2. Check Bundle Identifier matches in code
3. Verify extension is added to scheme

### WebRTC connection fails

1. Check server URL is accessible from mobile network
2. Configure TURN servers if behind NAT
3. Check firewall settings

## License

ISC
