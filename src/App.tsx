import { useEffect, useRef, useState } from 'react';
import type { RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { VoiceSession } from './voice';
import type { ToolStatus } from '../server/mcp';

type State = 'IDLE' | 'CONNECTING' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'ERROR';
type Transcript = { id: string; role: 'user' | 'assistant'; text: string; time: string };
const labels: Record<State, string> = {
  IDLE: 'Lista para comenzar', CONNECTING: 'Conectando', LISTENING: 'Escuchando',
  THINKING: 'Preparando respuesta', SPEAKING: 'Respondiendo', ERROR: 'Revisa la conexión',
};

export default function App() {
  const [state, setState] = useState<State>('IDLE');
  const [error, setError] = useState('');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [tool, setTool] = useState<ToolStatus | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const session = useRef<VoiceSession | null>(null);
  const connected = !['IDLE', 'ERROR'].includes(state);

  useEffect(() => () => session.current?.close(), []);

  function receive(event: RealtimeServerEvent) {
    switch (event.type) {
      case 'input_audio_buffer.speech_started': setState('LISTENING'); break;
      case 'input_audio_buffer.speech_stopped':
      case 'response.created': setState('THINKING'); break;
      case 'output_audio_buffer.started': setState('SPEAKING'); break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared': setState('LISTENING'); break;
      case 'response.done':
        if (event.response.status === 'failed') {
          setError('No se pudo completar la respuesta. Intenta preguntar de nuevo.');
          setState('LISTENING');
        }
        break;
      case 'conversation.item.input_audio_transcription.failed':
        setError('No se pudo transcribir el audio. La conversación de voz puede continuar.');
        break;
      case 'conversation.item.input_audio_transcription.completed':
      case 'response.output_audio_transcript.done': {
        const text = event.transcript.trim().slice(0, 4000);
        if (!text) break;
        const entry: Transcript = {
          id: event.item_id,
          role: event.type === 'conversation.item.input_audio_transcription.completed' ? 'user' : 'assistant',
          text,
          time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
        setTranscripts((previous) => [...previous.filter((item) => item.id !== entry.id), entry].slice(-30));
        break;
      }
    }
  }

  function start() {
    if (!audio.current) return;
    session.current?.close();
    setError('');
    setTranscripts([]);
    setTool(null);
    setState('CONNECTING');
    const next = new VoiceSession(audio.current, {
      onConnected: () => setState('LISTENING'),
      onEvent: receive,
      onTool: setTool,
      onError: (message) => { setError(message); setState('ERROR'); },
    });
    session.current = next;
    void next.connect();
  }

  function stop() {
    session.current?.close();
    session.current = null;
    setState('IDLE');
    setError('');
  }

  return (
    <main>
      <header className="masthead">
        <a className="brand" href="/">LexLatam <span>/ Voz</span></a>
        <span className="stage">Prueba de voz · 01</span>
      </header>

      <section className="intro">
        <p className="eyebrow">CONVERSACIÓN EN TIEMPO REAL</p>
        <h1>Empecemos por<br />una conversación.</h1>
        <p className="lede">Pregunta sobre derecho panameño. LexLatam busca las fuentes y el agente responde en español.</p>
      </section>

      <div className="workspace">
        <section className="session-panel" aria-labelledby="session-title">
          <p className="eyebrow" id="session-title">SESIÓN DE VOZ</p>
          <div className="state" role="status">
            <span className={`status-dot ${connected ? 'active' : ''}`} />{labels[state]}
          </div>
          <p className="prompt">Prueba con: “¿Qué regula la Ley 81 de 2019 en Panamá?”</p>
          <button className={connected ? 'secondary' : 'primary'} onClick={connected ? stop : start}>
            {connected ? 'Terminar conversación' : state === 'ERROR' ? 'Volver a intentar' : 'Iniciar conversación'}
            <span aria-hidden="true">{connected ? '■' : '↗'}</span>
          </button>
          <p className="note">El micrófono se activa al comenzar y se libera al terminar. El audio se envía a OpenAI durante la sesión.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="technical"><span>OpenAI Realtime</span><span>WebRTC · Español</span></div>
          <div className="research" aria-live="polite">
            <h2>Búsqueda jurídica</h2>
            {tool ? <>
              <p><code>{tool.name}</code></p>
              <p>{tool.state === 'running' ? 'Buscando fuentes…' : tool.state === 'success' ? 'Consulta completada' : 'No se pudo verificar la consulta'}
                {tool.latencyMs !== undefined && ` · ${(tool.latencyMs / 1000).toFixed(1)} s`}</p>
              {tool.state === 'success' && tool.sources.length === 0 && <p>No se encontraron fuentes para esta consulta.</p>}
              {tool.sources.map((source, index) => <article key={index}>
                <h3>{source.title}</h3><p>{source.citation}</p><p>{source.excerpt}</p>
                {(source.date || source.gaceta) && <p>{[source.date, source.gaceta && `Gaceta ${source.gaceta}`].filter(Boolean).join(' · ')}</p>}
                {source.official_source_url
                  ? <a href={source.official_source_url} target="_blank" rel="noopener noreferrer">{source.official_source_name || 'Abrir fuente oficial'} ↗</a>
                  : source.official_source_name && <p>{source.official_source_name}</p>}
              </article>)}
            </> : <p>La consulta aparecerá aquí cuando solicites información jurídica.</p>}
          </div>
        </section>

        <section className="conversation" aria-labelledby="conversation-title">
          <div className="section-top"><h2 id="conversation-title">Conversación</h2><span>Solo esta sesión</span></div>
          {transcripts.length === 0 ? (
            <div className="empty"><span aria-hidden="true">“</span><p>Tu conversación aparecerá aquí.</p><small>Las transcripciones llegan al completar cada intervención.</small></div>
          ) : (
            <ol className="transcripts">{transcripts.map((item) => (
              <li key={item.id} className={item.role}>
                <div><strong>{item.role === 'user' ? 'Tú' : 'Agente'}</strong><time>{item.time}</time></div>
                <p>{item.text}</p>
              </li>
            ))}</ol>
          )}
        </section>
      </div>
      <footer><span>Fuentes de LexLatam · MCP</span><span>Información orientativa. Verifica la fuente, vigencia y aplicabilidad.</span></footer>
      <audio ref={audio} autoPlay />
    </main>
  );
}
