/**
 * FileTransfer - P2P file transfer via WebRTC DataChannel
 * Supports chunked transfer for large files with progress tracking
 */
class FileTransfer extends EventEmitter {
  constructor() {
    super();
    this.transfers = new Map(); // transferId -> transfer info
    this.chunkSize = 16384; // 16KB chunks
    this.maxRetries = 3;
  }

  /**
   * Initialize file transfer on a peer connection
   * @param {string} peerId - Peer connection ID
   * @param {RTCPeerConnection} pc - Peer connection
   * @returns {RTCDataChannel}
   */
  initDataChannel(peerId, pc) {
    const channel = pc.createDataChannel('file-transfer', {
      ordered: true,
      maxRetransmits: this.maxRetries
    });

    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log(`[FileTransfer] Data channel open for ${peerId}`);
      this.emit('channel-open', { peerId, channel });
    };

    channel.onclose = () => {
      console.log(`[FileTransfer] Data channel closed for ${peerId}`);
      this.emit('channel-close', { peerId });
    };

    channel.onerror = (error) => {
      console.error(`[FileTransfer] Error for ${peerId}:`, error);
      this.emit('error', { peerId, error });
    };

    channel.onmessage = (event) => {
      this.handleMessage(peerId, event.data);
    };

    return channel;
  }

  /**
   * Handle incoming file transfer request
   * @param {RTCDataChannel} channel - Data channel
   */
  setupReceiver(channel) {
    channel.onmessage = (event) => {
      this.handleMessage(channel.label, event.data);
    };
  }

  /**
   * Handle incoming message
   */
  handleMessage(peerId, data) {
    try {
      // Check if message is metadata (JSON) or binary
      if (data instanceof ArrayBuffer) {
        this.handleBinaryData(peerId, data);
      } else {
        const message = JSON.parse(data);
        switch (message.type) {
          case 'file-info':
            this.handleFileInfo(peerId, message);
            break;
          case 'chunk':
            this.handleChunk(peerId, message);
            break;
          case 'chunk-ack':
            this.handleChunkAck(peerId, message);
            break;
          case 'transfer-complete':
            this.handleTransferComplete(peerId, message);
            break;
          case 'transfer-error':
            this.handleTransferError(peerId, message);
            break;
          case 'ready':
            this.handleReady(peerId, message);
            break;
        }
      }
    } catch (error) {
      console.error('[FileTransfer] Message parse error:', error);
    }
  }

  /**
   * Send file to peer
   * @param {string} peerId - Peer ID
   * @param {File} file - File to send
   * @param {RTCDataChannel} channel - Data channel
   */
  sendFile(peerId, file, channel) {
    const transferId = `${peerId}_${Date.now()}`;

    const transfer = {
      id: transferId,
      peerId,
      file,
      channel,
      totalChunks: Math.ceil(file.size / this.chunkSize),
      sentChunks: 0,
      startTime: Date.now(),
      status: 'pending'
    };

    this.transfers.set(transferId, transfer);

    // Wait for channel to be ready
    if (channel.readyState === 'open') {
      this.startTransfer(transfer);
    } else {
      channel.onopen = () => {
        this.startTransfer(transfer);
      };
    }

    return transferId;
  }

  /**
   * Start file transfer
   */
  startTransfer(transfer) {
    // Send file info
    transfer.channel.send(JSON.stringify({
      type: 'file-info',
      transferId: transfer.id,
      fileName: transfer.file.name,
      fileSize: transfer.file.size,
      fileType: transfer.file.type,
      totalChunks: transfer.totalChunks
    }));

    transfer.status = 'sending';
    this.emit('transfer-start', { transfer });
  }

  /**
   * Read and send file chunks
   */
  async sendChunks(transfer) {
    const reader = new FileReader();
    let currentChunk = 0;

    const sendNextChunk = () => {
      if (currentChunk >= transfer.totalChunks) {
        // Transfer complete
        transfer.channel.send(JSON.stringify({
          type: 'transfer-complete',
          transferId: transfer.id,
          fileName: transfer.file.name
        }));

        transfer.status = 'complete';
        transfer.endTime = Date.now();
        this.emit('transfer-complete', {
          transfer,
          duration: transfer.endTime - transfer.startTime,
          averageSpeed: transfer.file.size / ((transfer.endTime - transfer.startTime) / 1000)
        });
        // Clean up completed transfer after a delay to allow for ack
        setTimeout(() => {
          this.transfers.delete(transfer.id);
        }, 5000);
        return;
      }

      const start = currentChunk * this.chunkSize;
      const end = Math.min(start + this.chunkSize, transfer.file.size);
      const chunk = transfer.file.slice(start, end);

      reader.onload = () => {
        // Send chunk header
        transfer.channel.send(JSON.stringify({
          type: 'chunk',
          transferId: transfer.id,
          chunkIndex: currentChunk,
          chunkSize: end - start
        }));

        // Send binary data
        transfer.channel.send(reader.result);

        currentChunk++;
        transfer.sentChunks = currentChunk;

        this.emit('progress', {
          transfer,
          progress: currentChunk / transfer.totalChunks,
          sentBytes: start + (end - start),
          totalBytes: transfer.file.size
        });

        // Continue with rate limiting
        setTimeout(sendNextChunk, 10);
      };

      reader.onerror = () => {
        transfer.channel.send(JSON.stringify({
          type: 'transfer-error',
          transferId: transfer.id,
          error: 'Failed to read chunk'
        }));
        transfer.status = 'error';
        this.emit('transfer-error', { transfer, error: reader.error });
      };

      reader.readAsArrayBuffer(chunk);
    };

    sendNextChunk();
  }

  /**
   * Handle file info message
   */
  handleFileInfo(peerId, message) {
    const { transferId, fileName, fileSize, fileType, totalChunks } = message;

    const receiveBuffer = {
      id: transferId,
      peerId,
      fileName,
      fileSize,
      fileType,
      totalChunks,
      receivedChunks: new Array(totalChunks),
      receivedCount: 0
    };

    this.transfers.set(transferId, receiveBuffer);

    this.emit('file-received', {
      transferId,
      fileName,
      fileSize,
      fileType,
      totalChunks
    });

    // Signal ready to receive
    const transfer = this.transfers.get(transferId);
    if (transfer) {
      transfer.channel = this.getChannelForPeer(peerId);
      transfer.channel.send(JSON.stringify({
        type: 'ready',
        transferId
      }));
    }
  }

  /**
   * Handle chunk message
   */
  handleChunk(peerId, message) {
    const { transferId, chunkIndex, chunkSize } = message;
    const transfer = this.transfers.get(transferId);

    if (transfer) {
      transfer.currentChunkIndex = chunkIndex;
      transfer.currentChunkSize = chunkSize;
    }
  }

  /**
   * Handle binary data (chunk content)
   */
  handleBinaryData(peerId, data) {
    // Find the active receiving transfer for this peer
    let transfer = null;
    for (const t of this.transfers.values()) {
      if (t.peerId === peerId && t.receivedChunks && t.receivedCount < t.totalChunks) {
        transfer = t;
        break;
      }
    }

    if (transfer && transfer.currentChunkIndex !== undefined) {
      transfer.receivedChunks[transfer.currentChunkIndex] = data;
      transfer.receivedCount++;

      this.emit('chunk-received', {
        transfer,
        chunkIndex: transfer.currentChunkIndex,
        progress: transfer.receivedCount / transfer.totalChunks
      });

      // Check if transfer is complete
      if (transfer.receivedCount === transfer.totalChunks) {
        this.assembleFile(transfer);
      }
    }
  }

  /**
   * Assemble received chunks into file
   */
  assembleFile(transfer) {
    try {
      const blob = new Blob(transfer.receivedChunks, { type: transfer.fileType });

      transfer.status = 'complete';
      this.emit('receive-complete', {
        transfer,
        blob,
        fileName: transfer.fileName
      });

      // Clean up
      this.transfers.delete(transfer.id);
    } catch (error) {
      this.emit('receive-error', { transfer, error });
    }
  }

  /**
   * Handle transfer complete
   */
  handleTransferComplete(peerId, message) {
    const { transferId, fileName } = message;
    this.emit('transfer-ack', { peerId, transferId, fileName });
  }

  /**
   * Handle transfer error
   */
  handleTransferError(peerId, message) {
    const { transferId, error } = message;
    const transfer = this.transfers.get(transferId);
    if (transfer) {
      transfer.status = 'error';
      this.emit('transfer-error', { transfer, error });
      // Clean up failed transfer
      this.transfers.delete(transferId);
    }
  }

  /**
   * Handle ready message
   */
  handleReady(peerId, message) {
    const { transferId } = message;
    const transfer = this.transfers.get(transferId);
    if (transfer && transfer.status === 'pending') {
      this.sendChunks(transfer);
    }
  }

  /**
   * Get channel for peer
   */
  getChannelForPeer(peerId) {
    // Would need to store channels separately
    return null;
  }

  /**
   * Cancel transfer
   * @param {string} transferId - Transfer ID
   */
  cancelTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (transfer) {
      transfer.channel?.send(JSON.stringify({
        type: 'transfer-cancelled',
        transferId
      }));
      transfer.status = 'cancelled';
      this.transfers.delete(transferId);
      this.emit('transfer-cancelled', { transfer });
    }
  }

  /**
   * Get transfer status
   * @param {string} transferId - Transfer ID
   * @returns {Object|null}
   */
  getTransferStatus(transferId) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) return null;

    return {
      id: transfer.id,
      peerId: transfer.peerId,
      fileName: transfer.file?.name,
      fileSize: transfer.file?.size,
      totalChunks: transfer.totalChunks,
      sentChunks: transfer.sentChunks,
      progress: transfer.sentChunks / transfer.totalChunks,
      status: transfer.status,
      startTime: transfer.startTime,
      endTime: transfer.endTime
    };
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.transfers.forEach((transfer, id) => {
      transfer.channel?.close();
    });
    this.transfers.clear();
  }
}

module.exports = { FileTransfer };
