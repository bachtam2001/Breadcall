import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import SignalingService from '../services/SignalingService';
import WebRTCService from '../services/WebRTCService';

/**
 * HomeScreen - Landing screen for creating or joining rooms
 */
const HomeScreen = ({navigation}) => {
  const [serverUrl, setServerUrl] = useState('ws://localhost:3000/ws');
  const [roomId, setRoomId] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);

  const handleCreateRoom = useCallback(async () => {
    if (!serverUrl.trim()) {
      Alert.alert('Error', 'Server URL is required');
      return;
    }

    setConnecting(true);

    try {
      // Connect to signaling server
      await SignalingService.connect(serverUrl);

      // Generate a random room ID
      const newRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();

      // Initialize local media
      await WebRTCService.initLocalStream({
        audio: true,
        video: true,
        front: true,
      });

      // Join the room
      SignalingService.joinRoom(newRoomId, participantName || 'Anonymous');

      // Navigate to room screen
      navigation.replace('Room', {
        roomId: newRoomId,
        serverUrl,
        participantName: participantName || 'Anonymous',
      });
    } catch (error) {
      console.error('Create room error:', error);
      Alert.alert('Error', error.message || 'Failed to create room');
      setConnecting(false);
    }
  }, [serverUrl, participantName, navigation]);

  const handleJoinRoom = useCallback(async () => {
    if (!serverUrl.trim()) {
      Alert.alert('Error', 'Server URL is required');
      return;
    }

    if (!roomId.trim()) {
      Alert.alert('Error', 'Room ID is required');
      return;
    }

    setConnecting(true);

    try {
      // Connect to signaling server
      await SignalingService.connect(serverUrl);

      // Initialize local media
      await WebRTCService.initLocalStream({
        audio: true,
        video: true,
        front: true,
      });

      // Join the room
      SignalingService.joinRoom(roomId.toUpperCase(), participantName || 'Anonymous', password || null);

      // Navigate to room screen
      navigation.replace('Room', {
        roomId: roomId.toUpperCase(),
        serverUrl,
        participantName: participantName || 'Anonymous',
      });
    } catch (error) {
      console.error('Join room error:', error);
      Alert.alert('Error', error.message || 'Failed to join room');
      setConnecting(false);
    }
  }, [serverUrl, roomId, participantName, password, navigation]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>BreadCall</Text>
          <Text style={styles.subtitle}>Mobile</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Server URL"
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!connecting}
          />

          <TextInput
            style={styles.input}
            placeholder="Your Name"
            value={participantName}
            onChangeText={setParticipantName}
            autoCapitalize="words"
            editable={!connecting}
          />

          <View style={styles.roomSection}>
            <TextInput
              style={[styles.input, styles.roomInput]}
              placeholder="Room ID (4 letters)"
              value={roomId}
              onChangeText={text => setRoomId(text.toUpperCase().slice(0, 4))}
              maxLength={4}
              autoCapitalize="characters"
              editable={!connecting}
            />

            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="Password (optional)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!connecting}
            />
          </View>

          <TouchableOpacity
            style={[styles.button, styles.createButton, connecting && styles.buttonDisabled]}
            onPress={handleCreateRoom}
            disabled={connecting}>
            {connecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Create Room</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.joinButton, connecting && styles.buttonDisabled]}
            onPress={handleJoinRoom}
            disabled={connecting}>
            {connecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Join Room</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 18,
    color: '#a0a0a0',
    marginTop: 5,
  },
  form: {
    width: '100%',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 15,
    color: '#fff',
    fontSize: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  roomSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  roomInput: {
    flex: 1,
    marginRight: 10,
    textAlign: 'center',
    letterSpacing: 5,
    textTransform: 'uppercase',
  },
  passwordInput: {
    flex: 2,
  },
  button: {
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  createButton: {
    backgroundColor: '#4CAF50',
  },
  joinButton: {
    backgroundColor: '#2196F3',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default HomeScreen;
