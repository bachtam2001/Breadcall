import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Dimensions,
} from 'react-native';
import {RTCFecEncoding, RTCRtpEncoding, MediaStream} from 'react-native-webrtc';
import SignalingService from '../services/SignalingService';
import WebRTCService from '../services/WebRTCService';
import ScreenShareService from '../services/ScreenShareService';

const {width, height} = Dimensions.get('window');

/**
 * RoomScreen - Main room screen with video grid and controls
 */
const RoomScreen = ({navigation, route}) => {
  const {roomId, serverUrl, participantName} = route.params;

  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [localStream, setLocalStream] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initializeRoom();

    // Set up event listeners
    SignalingService.on('participant-joined', handleParticipantJoined);
    SignalingService.on('participant-left', handleParticipantLeft);
    SignalingService.on('offer', handleOffer);
    SignalingService.on('answer', handleAnswer);
    SignalingService.on('ice-candidate', handleIceCandidate);
    SignalingService.on('joined-room', handleJoinedRoom);
    WebRTCService.on('ice-candidate', handleLocalIceCandidate);
    WebRTCService.on('offer-ready', handleOfferReady);
    WebRTCService.on('answer-ready', handleAnswerReady);
    WebRTCService.on('remote-stream', handleRemoteStream);

    return () => cleanup();
  }, []);

  const initializeRoom = async () => {
    try {
      // Get existing local stream or create new one
      let stream = WebRTCService.getLocalStream();
      if (!stream) {
        stream = await WebRTCService.initLocalStream({
          audio: true,
          video: true,
          front: true,
        });
      }
      setLocalStream(stream);
      setLoading(false);
    } catch (error) {
      console.error('Initialize room error:', error);
      Alert.alert('Error', 'Failed to initialize media');
    }
  };

  const handleJoinedRoom = useCallback(({existingPeers}) => {
    console.log('[RoomScreen] Joined room, existing peers:', existingPeers);

    // Create peer connections for existing participants
    existingPeers.forEach(peer => {
      WebRTCService.createPeerConnection(peer.participantId);
      WebRTCService.createOffer(peer.participantId);
    });

    setParticipants(existingPeers.map(p => ({
      id: p.participantId,
      name: p.name,
    })));
  }, []);

  const handleParticipantJoined = useCallback(({participantId, name}) => {
    console.log('[RoomScreen] Participant joined:', participantId);

    setParticipants(prev => [...prev, {id: participantId, name}]);

    // Create peer connection and send offer
    WebRTCService.createPeerConnection(participantId);
    WebRTCService.createOffer(participantId);
  }, []);

  const handleParticipantLeft = useCallback(({participantId}) => {
    console.log('[RoomScreen] Participant left:', participantId);

    WebRTCService.removePeer(participantId);
    setRemoteStreams(prev => {
      const next = new Map(prev);
      next.delete(participantId);
      return next;
    });
    setParticipants(prev => prev.filter(p => p.id !== participantId));
  }, []);

  const handleOffer = useCallback(async ({from, sdp}) => {
    console.log('[RoomScreen] Received offer from:', from);
    await WebRTCService.handleOffer(from, sdp);
  }, []);

  const handleAnswer = useCallback(async ({from, sdp}) => {
    console.log('[RoomScreen] Received answer from:', from);
    await WebRTCService.handleAnswer(from, sdp);
  }, []);

  const handleIceCandidate = useCallback(async ({from, candidate}) => {
    await WebRTCService.addIceCandidate(from, candidate);
  }, []);

  const handleLocalIceCandidate = useCallback(({peerId, candidate}) => {
    SignalingService.sendIceCandidate(peerId, candidate);
  }, []);

  const handleOfferReady = useCallback(({peerId, sdp}) => {
    SignalingService.sendOffer(peerId, sdp);
  }, []);

  const handleAnswerReady = useCallback(({peerId, sdp}) => {
    SignalingService.sendAnswer(peerId, sdp);
  }, []);

  const handleRemoteStream = useCallback(({peerId, stream}) => {
    console.log('[RoomScreen] Received remote stream from:', peerId);
    setRemoteStreams(prev => new Map(prev).set(peerId, stream));
  }, []);

  const toggleAudio = useCallback(() => {
    WebRTCService.toggleAudio(!audioEnabled);
    setAudioEnabled(!audioEnabled);
    SignalingService.sendMuteStatus(!audioEnabled, !videoEnabled);
  }, [audioEnabled, videoEnabled]);

  const toggleVideo = useCallback(() => {
    WebRTCService.toggleVideo(!videoEnabled);
    setVideoEnabled(!videoEnabled);
    SignalingService.sendMuteStatus(!audioEnabled, !videoEnabled);
  }, [audioEnabled, videoEnabled]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (screenSharing) {
        ScreenShareService.stopCapture();
        setScreenSharing(false);
      } else {
        const stream = await ScreenShareService.startCapture();
        setScreenSharing(true);
        // TODO: Replace local stream tracks with screen share tracks
      }
    } catch (error) {
      console.error('Screen share error:', error);
      Alert.alert('Error', error.message);
    }
  }, [screenSharing]);

  const leaveRoom = useCallback(() => {
    SignalingService.leaveRoom();
    WebRTCService.cleanup();
    navigation.replace('Home');
  }, [navigation]);

  const cleanup = () => {
    SignalingService.removeAllListeners();
    WebRTCService.removeAllListeners();
  };

  const renderParticipant = ({item}) => {
    const stream = remoteStreams.get(item.id);
    const isLocal = item.id === SignalingService.getParticipantId();

    return (
      <View style={styles.participantContainer}>
        <View style={styles.videoContainer}>
          {stream ? (
            <Text style={styles.videoPlaceholder}>Video Stream</Text>
          ) : (
            <View style={styles.noVideo}>
              <Text style={styles.initials}>
                {item.name?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.participantName}>
          {isLocal ? `${item.name} (You)` : item.name}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Joining room...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.roomId}>{roomId}</Text>
        <TouchableOpacity onPress={leaveRoom} style={styles.leaveButton}>
          <Text style={styles.leaveButtonText}>Leave</Text>
        </TouchableOpacity>
      </View>

      {/* Video Grid */}
      <FlatList
        data={participants}
        renderItem={renderParticipant}
        keyExtractor={item => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
      />

      {/* Control Bar */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlButton, !audioEnabled && styles.controlButtonActive]}
          onPress={toggleAudio}>
          <Text style={styles.controlButtonText}>
            {audioEnabled ? '🎤' : '🔇'}
          </Text>
          <Text style={styles.controlButtonLabel}>
            {audioEnabled ? 'Mute' : 'Unmute'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, !videoEnabled && styles.controlButtonActive]}
          onPress={toggleVideo}>
          <Text style={styles.controlButtonText}>
            {videoEnabled ? '📷' : '🚫'}
          </Text>
          <Text style={styles.controlButtonLabel}>
            {videoEnabled ? 'Stop Video' : 'Start Video'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, screenSharing && styles.controlButtonActive]}
          onPress={toggleScreenShare}>
          <Text style={styles.controlButtonText}>📱</Text>
          <Text style={styles.controlButtonLabel}>
            {screenSharing ? 'Stop Share' : 'Share'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, styles.controlButtonDanger]}
          onPress={leaveRoom}>
          <Text style={styles.controlButtonText}>📴</Text>
          <Text style={styles.controlButtonLabel}>Leave</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  roomId: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 3,
  },
  leaveButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  leaveButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  grid: {
    padding: 10,
    flexGrow: 1,
  },
  participantContainer: {
    flex: 1,
    margin: 5,
    minWidth: (width - 30) / 2,
    maxWidth: (width - 30) / 2,
  },
  videoContainer: {
    aspectRatio: 16 / 9,
    backgroundColor: '#2a2a3e',
    borderRadius: 12,
    overflow: 'hidden',
  },
  videoPlaceholder: {
    flex: 1,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: '#666',
  },
  noVideo: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3a3a4e',
  },
  initials: {
    fontSize: 48,
    color: '#fff',
    fontWeight: 'bold',
  },
  participantName: {
    color: '#fff',
    textAlign: 'center',
    marginTop: 5,
    fontSize: 14,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  controlButton: {
    alignItems: 'center',
  },
  controlButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 10,
    borderRadius: 25,
  },
  controlButtonDanger: {
    backgroundColor: 'rgba(244, 67, 54, 0.3)',
    padding: 10,
    borderRadius: 25,
  },
  controlButtonText: {
    fontSize: 24,
  },
  controlButtonLabel: {
    color: '#fff',
    fontSize: 12,
    marginTop: 5,
  },
});

export default RoomScreen;
