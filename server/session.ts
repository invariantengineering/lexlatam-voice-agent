import type { RealtimeSessionCreateRequest } from 'openai/resources/realtime/realtime';

export const sessionConfig = {
  type: 'realtime',
  model: 'gpt-realtime-2.1',
  output_modalities: ['audio'],
  max_output_tokens: 600,
  instructions: [
    'Habla en español de forma natural, clara y concisa. Responde en dos o tres frases.',
    'Esta es una prueba de conversación por voz. La búsqueda jurídica todavía no está conectada.',
    'No afirmes haber consultado LexLatam ni inventes fuentes o citas jurídicas.',
    'Si te preguntan sobre derecho, explica que aún no puedes verificarlo con fuentes.',
  ].join(' '),
  audio: {
    input: {
      transcription: { model: 'gpt-4o-mini-transcribe', language: 'es' },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: true,
        interrupt_response: true,
      },
    },
    output: { voice: 'marin' },
  },
  tools: [],
  tracing: null,
} satisfies RealtimeSessionCreateRequest;
