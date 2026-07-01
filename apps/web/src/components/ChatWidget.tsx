import { useState, useRef, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { MessageCircle, X, Send, Bot, Loader2, Mic, MicOff, Volume2, Phone } from "lucide-react";
import { api } from "../lib/api";
import { TrackingQrCard } from "./TrackingQrCard";
import { useTheme } from "../context/ThemeContext";

interface ChatDisplay {
  type: "revenueChart" | "queueStatus" | "bookingConfirmed" | "bookingPreview" | "vehicleStatus" | "availabilitySlots" | "appointmentLookup";
  data: any;
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  display?: ChatDisplay;
}

type VoicePhase = "off" | "listening" | "thinking" | "speaking";

const SpeechRecognitionCtor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;

function cleanForSpeech(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/[*#`_]/g, "")
    .replace(/\bRWF\b/g, "Rwandan francs")
    .replace(/\bQR\b/g, "Q R code")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/\s+/g, " ")
    .trim();
}

function ChatDisplayPanel({ display }: { display: ChatDisplay }) {
  const { theme } = useTheme();
  const tickFill = theme === "dark" ? "#9aa7ae" : "#566873";

  if (display.type === "revenueChart") {
    return (
      <div className="mt-2 bg-ink-950 rounded-sm p-2">
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={display.data}>
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: tickFill }} />
            <YAxis tick={{ fontSize: 9, fill: tickFill }} width={28} />
            <Bar dataKey="total" fill="#1ea696" radius={2} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  if (display.type === "queueStatus") {
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {display.data.bays.map((b: { name: string; status: string }) => (
          <span key={b.name} className={b.status === "OCCUPIED" ? "badge-live" : b.status === "MAINTENANCE" ? "badge-danger" : "badge-neutral"}>
            {b.name}
          </span>
        ))}
      </div>
    );
  }
  if (display.type === "bookingConfirmed") {
    return (
      <div className="mt-2">
        <TrackingQrCard token={display.data.trackingToken} caption="Your booking QR -- scan anytime to track live status." />
      </div>
    );
  }
  if (display.type === "bookingPreview") {
    const when = new Date(display.data.scheduledAt).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return (
      <div className="mt-2 border border-ink-700 rounded-sm p-2 text-xs text-ink-300 space-y-0.5">
        <div><span className="text-ink-500">Service:</span> {display.data.serviceNames.join(", ")}</div>
        <div><span className="text-ink-500">Vehicle:</span> {display.data.vehicleMake} {display.data.vehicleModel} ({display.data.plate})</div>
        <div><span className="text-ink-500">When:</span> {when}</div>
        <div><span className="text-ink-500">Name/phone:</span> {display.data.customerName}, {display.data.phone}</div>
        <span className="badge-warn mt-1">Not booked yet -- reply to confirm</span>
      </div>
    );
  }
  if (display.type === "vehicleStatus") {
    const STATUS_COLOR: Record<string, string> = {
      WAITING: "badge-warn", IN_SERVICE: "badge-live", QUALITY_CHECK: "badge-live",
      READY: "badge-success", BOOKED: "badge-neutral", COMPLETED: "badge-neutral",
    };
    const STATUS_LABEL: Record<string, string> = {
      WAITING: "Waiting in queue", IN_SERVICE: "In service", QUALITY_CHECK: "Quality check",
      READY: "Ready for pickup", BOOKED: "Appointment booked", COMPLETED: "Completed",
    };
    return (
      <div className="mt-2 border border-ink-700 rounded-sm p-2 text-xs text-ink-300 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={STATUS_COLOR[display.data.status] ?? "badge-neutral"}>
            {STATUS_LABEL[display.data.status] ?? display.data.status}
          </span>
          {display.data.bay && <span className="text-ink-400">Bay: <strong>{display.data.bay}</strong></span>}
        </div>
        <div><span className="text-ink-500">Vehicle:</span> {display.data.vehicle.make} {display.data.vehicle.model} ({display.data.plate})</div>
        {display.data.services?.length > 0 && <div><span className="text-ink-500">Services:</span> {display.data.services.join(", ")}</div>}
        {display.data.scheduledAt && (
          <div><span className="text-ink-500">Appointment:</span> {new Date(display.data.scheduledAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
        )}
      </div>
    );
  }
  if (display.type === "availabilitySlots") {
    const day = new Date(display.data.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    return (
      <div className="mt-2 space-y-1.5">
        <p className="text-xs text-ink-400 font-medium">{day}</p>
        <div className="flex flex-wrap gap-1">
          {display.data.slots.map((s: string) => (
            <span key={s} className="badge-live text-xs">
              {new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          ))}
        </div>
        <p className="text-xs text-ink-500">Tell me which time you'd like and I'll book it.</p>
      </div>
    );
  }
  if (display.type === "appointmentLookup") {
    const when = new Date(display.data.scheduledAt).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return (
      <div className="mt-2 border border-ink-700 rounded-sm p-2 text-xs text-ink-300 space-y-0.5">
        <div><span className="text-ink-500">Service:</span> {display.data.services}</div>
        <div><span className="text-ink-500">Vehicle:</span> {display.data.vehicle.make} {display.data.vehicle.model} ({display.data.vehicle.plate})</div>
        <div><span className="text-ink-500">When:</span> {when}</div>
        <span className="badge-live mt-1">{display.data.status}</span>
        {display.data.trackingToken && (
          <div className="pt-2">
            <TrackingQrCard token={display.data.trackingToken} caption="Your tracking QR" />
          </div>
        )}
      </div>
    );
  }
  return null;
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi! I'm New Class Car Wash's assistant. Ask me about services, pricing, or how to book or track your vehicle." },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("off");

  const bottomRef     = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const voiceModeRef  = useRef(false);
  const messagesRef   = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.abort(); recognitionRef.current?.stop(); } catch {}
      window.speechSynthesis?.cancel();
    };
  }, []);

  // ── Voice conversation loop ─────────────────────────────────────────────

  /**
   * Speaks text aloud and returns a Promise that resolves when the utterance
   * finishes (or after a 30-second safety timeout so the loop never hangs).
   */
  function speakReply(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!hasTTS) { resolve(); return; }
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(cleanForSpeech(text));
      utt.rate = 1.05;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => v.lang.startsWith("en") && v.localService) ??
        voices.find((v) => v.lang.startsWith("en"));
      if (preferred) utt.voice = preferred;
      const safety = setTimeout(resolve, 30_000);
      const done = () => { clearTimeout(safety); resolve(); };
      utt.onend  = done;
      utt.onerror = done;
      window.speechSynthesis.speak(utt);
    });
  }

  /**
   * One iteration of the voice loop.
   * Opens the mic, waits for a single utterance, sends it to the server,
   * speaks the reply, then calls itself again via setTimeout (no call-stack growth).
   * Returns immediately if voice mode has been turned off.
   */
  function startVoiceLoop() {
    if (!SpeechRecognitionCtor || !voiceModeRef.current) return;

    const r = new SpeechRecognitionCtor();
    r.lang = "en-US";
    r.interimResults = false;
    r.continuous = false;
    recognitionRef.current = r;

    let gotResult = false;

    r.onresult = async (e: any) => {
      gotResult = true;
      const transcript = Array.from(e.results as any)
        .map((res: any) => (res as any)[0].transcript)
        .join(" ")
        .trim();

      if (!transcript || !voiceModeRef.current) return;

      // Stop the mic immediately so it doesn't keep recording during processing
      try { r.abort(); } catch {}

      setVoicePhase("thinking");
      window.speechSynthesis?.cancel();

      const userMsg  = { role: "user" as const, content: transcript };
      const history  = [...messagesRef.current, userMsg];
      setMessages(history);
      setPending(true);

      try {
        const { reply, display } = await api.post<{ reply: string; display?: ChatDisplay }>(
          "/ai/chat",
          { history: history.slice(-20) }
        );
        setMessages([...history, { role: "assistant" as const, content: reply, display }]);
        setPending(false);

        if (!voiceModeRef.current) return;
        setVoicePhase("speaking");
        await speakReply(reply);

        if (!voiceModeRef.current) return;
        // Short gap so the mic doesn't catch the tail end of TTS audio
        setTimeout(startVoiceLoop, 400);
      } catch {
        setPending(false);
        setMessages((m) => [
          ...m,
          { role: "assistant" as const, content: "Sorry, I had a brief technical issue. Please try again." },
        ]);
        if (voiceModeRef.current) setTimeout(startVoiceLoop, 1200);
      }
    };

    r.onend = () => {
      // onend fires after onresult (normal) OR when there's silence with no speech.
      // Only restart if we never got a result (silence timeout).
      if (!gotResult && voiceModeRef.current) {
        setTimeout(startVoiceLoop, 300);
      }
    };

    r.onerror = (ev: any) => {
      const delay = ev.error === "no-speech" ? 300 : 1200;
      if (voiceModeRef.current) setTimeout(startVoiceLoop, delay);
    };

    setVoicePhase("listening");
    try { r.start(); } catch { setTimeout(startVoiceLoop, 500); }
  }

  function toggleVoiceMode() {
    if (voiceModeRef.current) {
      voiceModeRef.current = false;
      setVoicePhase("off");
      try { recognitionRef.current?.abort(); recognitionRef.current?.stop(); } catch {}
      window.speechSynthesis?.cancel();
    } else {
      voiceModeRef.current = true;
      setOpen(true);
      startVoiceLoop();
    }
  }

  // ── Single-dictate mic (fills text input, user reviews and sends manually) ──

  function toggleListening() {
    if (listening) { recognitionRef.current?.stop(); return; }
    if (!SpeechRecognitionCtor) return;
    const r = new SpeechRecognitionCtor();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e: any) => setInput(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognitionRef.current = r;
    r.start();
    setListening(true);
  }

  // ── Text send ───────────────────────────────────────────────────────────

  async function send() {
    if (!input.trim() || pending) return;
    const history = [...messages, { role: "user" as const, content: input.trim() }];
    setMessages(history);
    setInput("");
    setPending(true);
    try {
      const { reply, display } = await api.post<{ reply: string; display?: ChatDisplay }>(
        "/ai/chat",
        { history: history.slice(-20) }
      );
      setMessages([...history, { role: "assistant", content: reply, display }]);
    } catch {
      setMessages([...history, { role: "assistant", content: "Sorry, something went wrong reaching the assistant." }]);
    } finally {
      setPending(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const voiceOn = voicePhase !== "off";

  if (!open) {
    return (
      <button
        onClick={() => { voiceModeRef.current ? toggleVoiceMode() : setOpen(true); }}
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full text-white px-4 py-3 shadow-lg transition-colors ${
          voiceOn ? "bg-green-600 hover:bg-green-700 animate-pulse" : "bg-brand-600 hover:bg-brand-700"
        }`}
      >
        {voiceOn ? <Phone size={20} /> : <MessageCircle size={20} />}
        <span className="text-sm font-medium pr-1">{voiceOn ? "Voice active" : "Ask AI"}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 h-[28rem] bg-ink-900 rounded-2xl shadow-2xl border border-ink-700 flex flex-col overflow-hidden">

      {/* Header */}
      <div className="bg-ink-950 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot size={18} className="text-brand-400" /> New Class Car Wash Assistant
        </div>
        <div className="flex items-center gap-2">
          {SpeechRecognitionCtor && hasTTS && (
            <button
              onClick={toggleVoiceMode}
              title={voiceOn ? "End voice conversation" : "Start hands-free voice conversation"}
              className={`rounded-full p-1.5 transition-colors ${
                voiceOn
                  ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                  : "text-ink-400 hover:text-white hover:bg-ink-700"
              }`}
            >
              <Phone size={16} className={voiceOn ? "animate-pulse" : ""} />
            </button>
          )}
          <button onClick={() => setOpen(false)} className="text-ink-300 hover:text-white">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-ink-950">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-brand-600 text-white" : "bg-ink-900 border border-ink-700 text-ink-200"
              }`}
            >
              {m.content}
              {m.display && <ChatDisplayPanel display={m.display} />}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm bg-ink-900 border border-ink-700 text-ink-500 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Bottom bar: voice status OR normal input */}
      {voiceOn ? (
        <div className="p-3 border-t border-ink-700 bg-ink-900 flex items-center gap-3">
          {voicePhase === "listening" && (
            <>
              <div className="flex items-center gap-2 flex-1">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                </span>
                <Mic size={16} className="text-green-400 animate-pulse" />
                <span className="text-sm text-green-400 font-medium">Listening...</span>
              </div>
              <button onClick={toggleVoiceMode} className="btn-secondary text-xs px-3 py-1.5">End</button>
            </>
          )}
          {voicePhase === "thinking" && (
            <>
              <div className="flex items-center gap-2 flex-1">
                <Loader2 size={16} className="text-yellow-400 animate-spin" />
                <span className="text-sm text-yellow-400 font-medium">Thinking...</span>
              </div>
              <button onClick={toggleVoiceMode} className="btn-secondary text-xs px-3 py-1.5">End</button>
            </>
          )}
          {voicePhase === "speaking" && (
            <>
              <div className="flex items-center gap-2 flex-1">
                <Volume2 size={16} className="text-brand-400 animate-pulse" />
                <span className="text-sm text-brand-400 font-medium">Speaking...</span>
                <span className="text-xs text-ink-500">(speak your reply when done)</span>
              </div>
              <button onClick={toggleVoiceMode} className="btn-secondary text-xs px-3 py-1.5">End</button>
            </>
          )}
        </div>
      ) : (
        <div className="p-2 border-t border-ink-700 flex gap-2">
          <input
            className="input flex-1"
            placeholder={listening ? "Listening..." : "Ask about services, pricing..."}
            value={input}
            disabled={pending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          {SpeechRecognitionCtor && (
            <button
              className={listening ? "btn-danger px-3" : "btn-secondary px-3"}
              onClick={toggleListening}
              disabled={pending}
              title={listening ? "Stop listening" : "Dictate (tap to speak, tap to stop)"}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          )}
          <button className="btn-primary px-3" onClick={send} disabled={pending}>
            <Send size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
