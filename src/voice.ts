import type { RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import type { ToolStatus } from '../server/mcp';

type VoiceCallbacks = {
  onConnected: () => void;
  onEvent: (event: RealtimeServerEvent) => void;
  onError: (message: string) => void;
  onTool: (tool: ToolStatus | null) => void;
};

export class VoiceSession {
  private controller = new AbortController();
  private peer?: RTCPeerConnection;
  private microphone?: MediaStream;
  private channel?: RTCDataChannel;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private sessionId?: string;
  private pollTimer?: ReturnType<typeof setTimeout>;

  constructor(private audio: HTMLAudioElement, private callbacks: VoiceCallbacks) {
    window.addEventListener('pagehide', this.handlePageHide);
  }
  private handlePageHide = () => this.close();

  async connect() {
    this.timer = setTimeout(() => this.fail('La conexión tardó demasiado. Vuelve a intentarlo.'), 30_000);
    try {
      const status = await fetch('/api/status', { signal: this.controller.signal });
      const configuration = await status.json();
      if (this.closed) return;
      if (!status.ok || !configuration.ready) {
        throw new Error('Configura OPENAI_API_KEY y LEXLATAM_MCP_TOKEN en .env y reinicia el servidor.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('El micrófono requiere un navegador compatible en localhost o HTTPS.');
      }
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      // A permission prompt can resolve after the user has disconnected.
      if (this.closed) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      this.microphone = microphone;
      const peer = new RTCPeerConnection();
      this.peer = peer;
      for (const track of microphone.getTracks()) {
        peer.addTrack(track, microphone);
        track.addEventListener('ended', () => this.fail('Se perdió el acceso al micrófono. Vuelve a conectar.'));
      }
      peer.ontrack = ({ streams, track }) => {
        if (this.closed) return;
        this.audio.srcObject = streams[0] ?? new MediaStream([track]);
        void this.audio.play().catch(() => this.fail('El navegador bloqueó el audio. Permite la reproducción y vuelve a conectar.'));
      };
      peer.onconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(peer.connectionState)) {
          this.fail('La conexión de voz se interrumpió. Vuelve a conectar.');
        }
      };
      const channel = peer.createDataChannel('oai-events');
      this.channel = channel;
      channel.onopen = () => {
        if (this.closed) return;
        clearTimeout(this.timer);
        this.callbacks.onConnected();
      };
      channel.onclose = () => this.fail('La sesión de voz terminó. Puedes iniciar otra.');
      channel.onerror = () => this.fail('No se pudo mantener la conexión de voz.');
      channel.onmessage = ({ data }) => {
        if (this.closed) return;
        try {
          const event = JSON.parse(data) as RealtimeServerEvent;
          if (event.type === 'error') {
            this.fail('El proveedor informó un error de voz. Vuelve a conectar.');
            return;
          }
          this.callbacks.onEvent(event);
        } catch {
          this.fail('La sesión devolvió un evento no válido.');
        }
      };
      const offer = await peer.createOffer();
      if (this.closed) return;
      await peer.setLocalDescription(offer);
      if (this.closed) return;
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
        signal: this.controller.signal,
      });
      if (this.closed) return;
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(typeof failure?.error === 'string' ? failure.error : 'No se pudo iniciar la sesión.');
      }
      const { id, sdp } = await response.json();
      this.sessionId = id;
      if (this.closed) { this.releaseServer(); return; }
      await peer.setRemoteDescription({ type: 'answer', sdp });
      void this.poll();
    } catch (error) {
      if (this.closed) return;
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      this.fail(denied
        ? 'Permite el acceso al micrófono en el navegador y vuelve a intentarlo.'
        : error instanceof Error ? error.message : 'No se pudo conectar la voz.');
    }
  }

  private async poll() {
    if (this.closed || !this.sessionId) return;
    try {
      const response = await fetch(`/api/session/${this.sessionId}`, { signal: this.controller.signal });
      const status = await response.json();
      if (this.closed) return;
      if (!response.ok || status.closed) { this.fail('La conexión de búsqueda terminó. Vuelve a conectar.'); return; }
      this.callbacks.onTool(status.tool);
      this.pollTimer = setTimeout(() => void this.poll(), 1000);
    } catch {
      if (!this.closed) this.fail('No se pudo mantener la conexión de búsqueda.');
    }
  }

  private releaseServer() {
    if (this.sessionId) void fetch(`/api/session/${this.sessionId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    this.sessionId = undefined;
  }

  private fail(message: string) {
    if (this.closed) return;
    this.close();
    this.callbacks.onError(message);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('pagehide', this.handlePageHide);
    clearTimeout(this.timer);
    clearTimeout(this.pollTimer);
    this.releaseServer();
    this.controller.abort();
    this.channel?.close();
    this.peer?.close();
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.audio.pause();
    this.audio.srcObject = null;
  }
}
