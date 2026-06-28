# Local AI setup (Ollama)

IKINAMBA's AI features (dashboard insights narration + booking chatbot) run on a local model
via [Ollama](https://ollama.com) -- no cloud API key needed.

## One-time setup

```sh
ollama pull qwen2.5:1.5b-instruct
# from apps/server/ollama
ollama create ikinamba-ai -f Modelfile
```

This layers IKINAMBA's system prompt over `qwen2.5:1.5b-instruct` (~1GB) as a new Ollama
model named `ikinamba-ai`. Chosen over the previous Phi-3-mini-4k (3.8B, ~2.4GB) base for
materially faster CPU-only inference -- still coherent enough for short, grounded replies
(FAQ chat, dashboard narration) at a fraction of the response time.

## Verify it works

```sh
ollama run ikinamba-ai "Say hello in one sentence."
```

## Running

Ollama runs as a background service after installation (`ollama serve` if you need to start it manually).
The server reads `OLLAMA_BASE_URL` / `OLLAMA_MODEL` from `.env` (defaults: `http://localhost:11434` / `ikinamba-ai`).

If Ollama isn't running, AI endpoints don't fail -- they return a clearly-labeled fallback message so the rest
of the app stays usable during a demo.
