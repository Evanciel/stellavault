// SP4 — audio/video → text preprocessing for chat attachments.
//
// Audio and video can't be understood by the local model (gemma4), so they are turned into
// TEXT in MAIN at pick time and that text is folded into the conversation (so the local model
// AND the distiller see it). Two FIXED cloud endpoints, called with the user's own dedicated
// keys (never the renderer's): OpenAI Whisper for audio transcription, Gemini for video
// description. The URLs are constant (not renderer-derived) so there is no SSRF surface — we
// use electron `net.fetch` directly rather than the GET-only SSRF-guarded safeFetch.

import { net } from 'electron';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
// gemini-2.0-flash is retired (404); 2.5-flash is the current multimodal flash model (verified).
const GEMINI_VIDEO_MODEL = 'gemini-2.5-flash';
const VIDEO_DESCRIBE_PROMPT =
  'Describe this video factually for a knowledge note: what happens (key moments in order), any on-screen or spoken text (verbatim if legible), and the notable visuals. 3-6 sentences. No preamble, no speculation.';

/** Transcribe audio bytes via OpenAI Whisper (multipart). Returns the transcript, or throws.
 *  Timeout/cancel is owned by the caller's AbortController (threaded into net.fetch via signal). */
export async function transcribeAudio(
  apiKey: string, bytes: Buffer, fileName: string, mimeType: string, signal: AbortSignal,
): Promise<string> {
  if (!apiKey) throw new Error('no transcription API key');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType || 'audio/mpeg' }), fileName || 'audio');
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');
  const res = await net.fetch(WHISPER_URL, {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal,
  });
  if (!res.ok) throw new Error(`whisper HTTP ${res.status}`);
  const json = (await res.json()) as { text?: unknown };
  return String(json.text ?? '').trim();
}

/** Describe video bytes via Gemini (inline base64). Returns the description, or throws. */
export async function describeVideo(
  apiKey: string, bytes: Buffer, mimeType: string, signal: AbortSignal,
): Promise<string> {
  if (!apiKey) throw new Error('no video API key');
  const body = JSON.stringify({
    contents: [{
      parts: [
        { text: VIDEO_DESCRIBE_PROMPT },
        { inlineData: { mimeType: mimeType || 'video/mp4', data: bytes.toString('base64') } },
      ],
    }],
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VIDEO_MODEL}:generateContent`;
  const res = await net.fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body, signal,
  });
  if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> };
  return String(json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}
