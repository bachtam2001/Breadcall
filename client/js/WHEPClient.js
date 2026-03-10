/**
 * WHEPClient - Implementation of WebRTC-HTTP Egress Protocol (WHEP)
 * for consuming streams from OvenMediaEngine.
 */
export class WHEPClient {
    constructor(endpoint, videoElement) {
        this.endpoint = endpoint;
        this.videoElement = videoElement;
        this.pc = null;
        this.resourceURL = null;
    }

    /**
     * Consume a stream and render it to the attached video element
     */
    async consume() {
        this.pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        // In WHEP, we usually start with an offer from the client or an empty POST
        // OME WHEP implementation typically expects Client Offer
        this.pc.addTransceiver('video', { direction: 'recvonly' });
        this.pc.addTransceiver('audio', { direction: 'recvonly' });

        this.pc.ontrack = (event) => {
            console.log('[WHEP] Received remote track', event.track.kind);
            if (this.videoElement.srcObject !== event.streams[0]) {
                this.videoElement.srcObject = event.streams[0];
            }
        };

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        // Wait for ICE gathering
        await new Promise(resolve => {
            if (this.pc.iceGatheringState === 'complete') {
                resolve();
            } else {
                const checkState = () => {
                    if (this.pc.iceGatheringState === 'complete') {
                        this.pc.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                };
                this.pc.addEventListener('icegatheringstatechange', checkState);
                setTimeout(resolve, 3000);
            }
        });

        // Send POST request with SDP offer
        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/sdp'
            },
            body: this.pc.localDescription.sdp
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`WHEP Consume failed (${response.status}): ${errorText}`);
        }

        // Store resource URL for termination
        this.resourceURL = response.headers.get('Location');
        if (this.resourceURL && !this.resourceURL.startsWith('http')) {
            const parsedBase = new URL(this.endpoint);
            this.resourceURL = new URL(this.resourceURL, parsedBase.origin).href;
        }

        const answerSdp = await response.text();
        await this.pc.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: answerSdp
        }));

        console.log(`[WHEP] Consuming stream from ${this.endpoint}`);
    }

    /**
     * Stop consuming and cleanup
     */
    async stop() {
        if (this.resourceURL) {
            try {
                await fetch(this.resourceURL, { method: 'DELETE' });
            } catch (e) {
                console.warn('[WHEP] Failed to notify server about stop', e);
            }
        }

        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }
    }
}
