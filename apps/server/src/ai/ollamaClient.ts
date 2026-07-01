import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string; items?: { type: string } }>;
      required: string[];
    };
  };
}

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface LocalAIReply {
  content: string;
  toolCalls?: ToolCall[];
}

const FALLBACK_NOTICE =
  "[AI offline] Local Ollama model is not reachable. Start it with `ollama serve` and ensure the `ikinamba-ai` model is created (see apps/server/ollama/README.md). Showing a placeholder response.";

/** Thin wrapper over Ollama's chat API. Never throws -- if the local model isn't running,
 * callers get a clearly-labeled fallback string instead of a hard failure, so the rest of the
 * app (dashboard, chatbot) keeps working during the demo even if Ollama isn't started. */
export async function chatWithLocalAI(
  messages: ChatMessage[],
  opts: { temperature?: number; tools?: ToolDefinition[] } = {}
): Promise<LocalAIReply> {
  try {
    const res = await fetch(`${env.ollama.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.ollama.model,
        messages,
        stream: false,
        keep_alive: "10m",
        options: { temperature: opts.temperature ?? 0.4 },
        ...(opts.tools ? { tools: opts.tools } : {}),
      }),
      // This CPU-only model can take well over a minute to respond on modest hardware --
      // generous timeout so slow-but-working isn't misreported as offline.
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string; tool_calls?: ToolCall[] } };
    return {
      content: data.message?.content?.trim() || (data.message?.tool_calls?.length ? "" : FALLBACK_NOTICE),
      toolCalls: data.message?.tool_calls,
    };
  } catch (err) {
    logger.warn({ err }, "Ollama call failed, returning fallback notice");
    return { content: FALLBACK_NOTICE };
  }
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${env.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
