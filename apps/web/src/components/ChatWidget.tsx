import { useState, useRef, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { MessageCircle, X, Send, Bot, Loader2, Mic } from "lucide-react";
import { api } from "../lib/api";
import { TrackingQrCard } from "./TrackingQrCard";
import { useTheme } from "../context/ThemeContext";

interface ChatDisplay {
  type: "revenueChart" | "queueStatus" | "bookingConfirmed" | "bookingPreview";
  data: any;
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  display?: ChatDisplay;
}

// Not in the standard DOM lib types -- browser-native Web Speech API, Chrome/Edge only.
const SpeechRecognitionCtor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

/** Renders the structured result of a chatbot tool call (booking confirmation, a live
 * chart, queue status) inline in the chat bubble, instead of just narrating it in text. */
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
  return null;
}

/** Floating AI assistant available everywhere (public pages too -- /api/ai/chat needs no auth).
 * Local CPU inference is slow (tens of seconds), so the loading state is front-and-center
 * rather than implying an instant reply. */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi! I'm New Class Car Wash's assistant. Ask me about services, pricing, or how to book or track your vehicle." },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [listening, setListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (e: any) => setInput(e.results[0][0].transcript);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function send() {
    if (!input.trim() || pending) return;
    const history = [...messages, { role: "user" as const, content: input.trim() }];
    setMessages(history);
    setInput("");
    setPending(true);
    try {
      const { reply, display } = await api.post<{ reply: string; display?: ChatDisplay }>("/ai/chat", { history: history.slice(-10) });
      setMessages([...history, { role: "assistant", content: reply, display }]);
    } catch {
      setMessages([...history, { role: "assistant", content: "Sorry, something went wrong reaching the assistant." }]);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-brand-600 text-white px-4 py-3 shadow-lg hover:bg-brand-700 transition-colors"
      >
        <MessageCircle size={20} />
        <span className="text-sm font-medium pr-1">Ask AI</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 h-[28rem] bg-ink-900 rounded-2xl shadow-2xl border border-ink-700 flex flex-col overflow-hidden">
      <div className="bg-ink-950 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot size={18} className="text-brand-400" /> New Class Car Wash Assistant
        </div>
        <button onClick={() => setOpen(false)} className="text-ink-300 hover:text-white">
          <X size={18} />
        </button>
      </div>

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
            title={listening ? "Stop listening" : "Speak your question"}
          >
            <Mic size={16} className={listening ? "animate-pulse" : ""} />
          </button>
        )}
        <button className="btn-primary px-3" onClick={send} disabled={pending}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
