import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { Car, Search, CalendarCheck, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { ChatWidget } from "../components/ChatWidget";

interface CatalogItem { id: string; name: string; category: string; basePrice: number; durationMinutes: number }

/** Public entry point for anonymous visitors -- replaces dropping straight into a login
 * wall or a bare booking form with an actual explanation of what IKINAMBA is, who it's
 * for (New Class Car Wash customers), and the two things a visitor actually wants to do. */
export function Landing() {
  const navigate = useNavigate();
  const [trackingCode, setTrackingCode] = useState("");
  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: () => api.get<CatalogItem[]>("/catalog", { auth: false }) });

  function goTrack(e: React.FormEvent) {
    e.preventDefault();
    const code = trackingCode.trim();
    if (code) navigate(`/track/${code}`);
  }

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="border-b border-ink-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Car className="text-brand-400" size={24} />
          <span className="font-bold text-lg text-ink-100">New Class Car Wash</span>
        </div>
        <Link to="/login" className="text-xs text-ink-400 hover:text-ink-100">
          Staff login &rarr;
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16 space-y-16">
        <section className="text-center space-y-4">
          <span className="panel-title">Gisimenti, Kigali</span>
          <h1 className="text-3xl sm:text-4xl font-bold text-ink-100">
            Book your car wash, track it live, no app required.
          </h1>
          <p className="text-ink-400 max-w-xl mx-auto">
            Book a service online, watch your vehicle's status update in real time from
            check-in to pickup, and get your receipt by email. No account needed.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link to="/book" className="btn-primary">
              <CalendarCheck size={16} /> Book a service
            </Link>
          </div>
        </section>

        <section className="card max-w-md mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <Search size={16} className="text-brand-400" />
            <span className="panel-title">Track my vehicle</span>
          </div>
          <form onSubmit={goTrack} className="flex gap-2">
            <input
              className="input"
              placeholder="Tracking code from your confirmation"
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
            />
            <button className="btn-secondary" type="submit">Track</button>
          </form>
          <p className="text-xs text-ink-500 mt-2">
            Your tracking code/QR was sent by email when you booked or checked in.
          </p>
        </section>

        {catalog && catalog.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <span className="panel-title">Our services</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {catalog.map((item) => (
                <div key={item.id} className="card">
                  <div className="font-medium text-ink-100">{item.name}</div>
                  <div className="text-xs text-ink-500 mt-1">{item.category} &middot; ~{item.durationMinutes} min</div>
                  <div className="font-mono text-brand-400 mt-2">RWF {item.basePrice.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="flex items-center justify-center gap-2 text-xs text-ink-500">
          <ShieldCheck size={14} /> Your booking details are only used to manage your service and contact you about it.
        </section>
      </main>

      <ChatWidget />
    </div>
  );
}
