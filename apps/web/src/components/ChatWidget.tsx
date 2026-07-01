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

type VoicePhase = "off" | "listening" | "thinking" | "speaking" | "reviewing";

const SpeechRecognitionCtor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;

/** Strip markdown symbols so the text-to-speech engine reads naturally. */
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
  const [listening, setListening] = useState(false);   // single-dictate mic mode
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("off");
  const [pendingTranscript, setPendingTranscript] = useState("");
  const [reviewCountdown, setReviewCountdown] = useState(0);

  const bottomRef    = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const voiceModeRef = useRef(false);   // used inside async callbacks to avoid stale closure
  const hasResultRef = useRef(false);   // did the current recognition session get speech?
  const messagesRef  = useRef(messages);
  messagesRef.current = messages;       // always up-to-date, safe to read inside callbacks
  const pendingTranscriptRef = useRef(""); // readable inside timer callbacks (avoids stale closure)
  const reviewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
      if (reviewTimerRef.current) clearInterval(reviewTimerRef.current);
    };
  }, []);

  // ── Voice conversation loop ─────────────────────────────────────────────

  function startVoiceListen() {
    if (!SpeechRecognitionCtor || !voiceModeRef.current) return;

    const r = new SpeechRecognitionCtor();
    r.lang = "en-US";
    r.interimResults = false;
    r.continuous = false;
    hasResultRef.current = false;

    r.onresult = (e: any) => {
      hasResultRef.current = true;
      const transcript = e.results[0][0].transcript.trim();
      if (!transcript || !voiceModeRef.current) return;

      // Show the transcript for 3 seconds so the user can correct misrecognised names
      // before it is sent to the server. Auto-sends if untouched.
      pendingTranscriptRef.current = transcript;
      setPendingTranscript(transcript);
      setReviewCountdown(3);
      setVoicePhase("reviewing");

      if (reviewTimerRef.current) clearInterval(reviewTimerRef.current);
      reviewTimerRef.current = setInterval(() => {
        setReviewCountdown((c) => {
          if (c <= 1) {
            clearInterval(reviewTimerRef.current!);
            reviewTimerRef.current = null;
            if (voiceModeRef.current) sendVoiceMessage(pendingTranscriptRef.current);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    };

    r.onend = () => {
      // No speech detected (silence timeout) -- keep listening
      if (voiceModeRef.current && !hasResultRef.current) {
        setTimeout(() => { if (voiceModeRef.current) startVoiceListen(); }, 400);
      }
    };

    r.onerror = (e: any) => {
      const retryDelay = e.error === "no-speech" ? 400 : 1500;
      if (voiceModeRef.current) {
        setTimeout(() => { if (voiceModeRef.current) startVoiceListen(); }, retryDelay);
      }
    };

    recognitionRef.current = r;
    try { r.start(); } catch { /* already started */ }
    setVoicePhase("listening");
  }

  async function sendVoiceMessage(transcript: string) {
    if (!voiceModeRef.current) return;
    setVoicePhase("thinking");
    window.speechSynthesis.cancel();

    const history = [...messagesRef.current, { role: "user" as const, content: transcript }];
    setMessages(history);
    setPending(true);

    try {
      const { reply, display } = await api.post<{ reply: string; display?: ChatDisplay }>(
        "/ai/chat",
        { history: history.slice(-20) }
      );
      setMessages([...history, { role: "assistant" as const, content: reply, display }]);

      if (!voiceModeRef.current) return;
      setVoicePhase("speaking");

      const utterance = new SpeechSynthesisUtterance(cleanForSpeech(reply));
      utterance.rate = 1.05;
      // Prefer a natural local English voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) => v.lang.startsWith("en") && v.localService)
        ?? voices.find((v) => v.lang.startsWith("en"));
      if (preferred) utterance.voice = preferred;

      utterance.onend   = () => { if (voiceModeRef.current) startVoiceListen(); };
      utterance.onerror = () => { if (voiceModeRef.current) startVoiceListen(); };
      window.speechSynthesis.speak(utterance);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant" as const, content: "Sorry, I had a brief technical issue. Please try again." }]);
      if (voiceModeRef.current) {
        setTimeout(() => { if (voiceModeRef.current) startVoiceListen(); }, 1200);
      }
    } finally {
      setPending(false);
    }
  }

  function toggleVoiceMode() {
    if (voiceModeRef.current) {
      voiceModeRef.current = false;
      setVoicePhase("off");
      recognitionRef.current?.stop();
      window.speechSynthesis.cancel();
      if (reviewTimerRef.current) { clearInterval(reviewTimerRef.current); reviewTimerRef.current = null; }
    } else {
      voiceModeRef.current = true;
      setOpen(true);
      startVoiceListen();
    }
  }

  // ── Single-dictate mic (existing behaviour) ─────────────────────────────

  function toggleListening() {
    if (listening) { recognitionRef.current?.stop(); return; }
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
      const { reply, display } = await api.post<{ reply: string; display?: ChatDisplay }>("/ai/chat", { history: history.slice(-20) });
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
              <Loader2 size={14} className="animate-spin" /> Thinking... (local AI can take up to a minute)
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Bottom: voice status bar OR normal input */}
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
          {voicePhase === "reviewing" && (
            <div className="flex-1 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-400">I heard (edit if wrong):</span>
                <span className="text-xs text-ink-500">sending in {reviewCountdown}s</span>
              </div>
              <div className="flex gap-2 items-center">
                <input
                  className="input flex-1 text-sm py-1"
                  value={pendingTranscript}
                  autoFocus
                  onChange={(e) => {
                    setPendingTranscript(e.target.value);
                    pendingTranscriptRef.current = e.target.value;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (reviewTimerRef.current) { clearInterval(reviewTimerRef.current); reviewTimerRef.current = null; }
                      sendVoiceMessage(pendingTranscriptRef.current);
                    }
                  }}
                />
                <button
                  className="btn-primary px-2 py-1 shrink-0"
                  title="Send now"
                  onClick={() => {
                    if (reviewTimerRef.current) { clearInterval(reviewTimerRef.current); reviewTimerRef.current = null; }
                    sendVoiceMessage(pendingTranscriptRef.current);
                  }}
                >
                  <Send size={14} />
                </button>
                <button onClick={toggleVoiceMode} className="btn-secondary text-xs px-2 py-1 shrink-0">End</button>
              </div>
            </div>
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
                <span className="text-xs text-ink-500">(say your reply when done)</span>
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
