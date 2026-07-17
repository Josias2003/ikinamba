import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

/**
 * Transcribe an audio buffer using Groq's Whisper-large-v3.
 * Returns null if GROQ_API_KEY is not set or the call fails, so the caller
 * can fall back to the browser's Web Speech API transcript.
 *
 * No language hint is given so Whisper auto-detects — this handles mixed
 * Kinyarwanda/English utterances (names, places) far better than en-US STT.
 */
export async function transcribeWithGroq(
  audioBuf: Buffer,
  mimeType: string
): Promise<string | null> {
  if (!env.groq.apiKey) return null;

  try {
    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";
    const body = new FormData();
    body.append("file", new Blob([audioBuf], { type: mimeType }), `audio.${ext}`);
    body.append("model", "whisper-large-v3");
    body.append("response_format", "json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.groq.apiKey}` },
      body,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      logger.warn({ status: res.status, body: text }, "Groq transcription failed");
      return null;
    }

    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch (err) {
    logger.warn({ err }, "Groq transcribe error");
    return null;
  }
}
