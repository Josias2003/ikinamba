import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Car, CheckCircle2, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { ChatWidget } from "../components/ChatWidget";
import { TrackingQrCard } from "../components/TrackingQrCard";

interface CatalogItem { id: string; name: string; category: string; basePrice: number; durationMinutes: number }
interface Slot { start: string; bookedCount: number; available: boolean }

export function BookingPublic() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slot, setSlot] = useState("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });
  const [vehicle, setVehicle] = useState({ make: "", model: "", year: 2020, plate: "", color: "" });
  const [confirmation, setConfirmation] = useState<any>(null);

  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: () => api.get<CatalogItem[]>("/catalog", { auth: false }) });
  const { data: slots } = useQuery({
    queryKey: ["availability", date],
    queryFn: () => api.get<Slot[]>(`/appointments/availability?date=${date}`, { auth: false }),
  });

  const bookMutation = useMutation({
    mutationFn: () =>
      api.post(
        "/appointments",
        {
          customer: { name: customer.name, phone: customer.phone, email: customer.email || undefined },
          vehicle,
          scheduledAt: slot,
          serviceItemIds: selectedItems,
          source: "ONLINE",
        },
        { auth: false }
      ),
    onSuccess: setConfirmation,
  });

  const total = (catalog || []).filter((c) => selectedItems.includes(c.id)).reduce((s, c) => s + c.basePrice, 0);

  if (confirmation) {
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center p-6">
        <div className="card max-w-md text-center space-y-4">
          <CheckCircle2 className="text-brand-400 mx-auto" size={48} />
          <h2 className="text-xl font-bold text-ink-100">Booking confirmed!</h2>
          <p className="text-ink-400">
            See you on <strong>{new Date(confirmation.scheduledAt).toLocaleString()}</strong>. A confirmation email with
            this same QR code has been sent to you.
          </p>
          <div className="border-t border-ink-800 pt-4">
            <TrackingQrCard token={confirmation.trackingToken} caption="Keep this QR -- show it at check-in and scan it anytime to follow live progress." />
          </div>
          <button className="btn-primary" onClick={() => location.reload()}>Book another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-2 text-ink-100">
          <Car className="text-brand-400" size={28} />
          <h1 className="text-2xl font-bold">Book a service at New Class Car Wash</h1>
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold text-ink-200">1. Choose services</h3>
          <div className="grid grid-cols-2 gap-2">
            {catalog?.map((item) => (
              <label key={item.id} className={`flex items-center justify-between border rounded-sm px-3 py-2 text-sm cursor-pointer ${selectedItems.includes(item.id) ? "border-brand-500 bg-brand-500/10" : "border-ink-700"}`}>
                <span>
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={selectedItems.includes(item.id)}
                    onChange={(e) =>
                      setSelectedItems(e.target.checked ? [...selectedItems, item.id] : selectedItems.filter((id) => id !== item.id))
                    }
                  />
                  {item.name}
                </span>
                <span className="text-ink-500">RWF {item.basePrice.toLocaleString()}</span>
              </label>
            ))}
          </div>
          {total > 0 && <p className="text-sm text-ink-400">Estimated total: <strong>RWF {total.toLocaleString()}</strong></p>}
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold text-ink-200">2. Pick a date &amp; time</h3>
          <input className="input max-w-xs" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
            {slots?.map((s) => (
              <button
                key={s.start}
                disabled={!s.available}
                onClick={() => setSlot(s.start)}
                className={`text-xs px-2 py-1.5 ${slot === s.start ? "btn-primary" : "btn-secondary"}`}
              >
                {new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
          </div>
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold text-ink-200">3. Your details</h3>
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Full name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            <input className="input" placeholder="Phone" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            <input className="input col-span-2" placeholder="Email (optional)" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Vehicle make" value={vehicle.make} onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })} />
            <input className="input" placeholder="Vehicle model" value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} />
            <input className="input" placeholder="Plate number" value={vehicle.plate} onChange={(e) => setVehicle({ ...vehicle, plate: e.target.value })} />
            <input className="input" type="number" placeholder="Year" value={vehicle.year} onChange={(e) => setVehicle({ ...vehicle, year: Number(e.target.value) })} />
          </div>
        </div>

        {bookMutation.isError && <p className="alert-danger">{(bookMutation.error as any)?.message}</p>}

        <button
          className="btn-primary w-full py-3"
          disabled={!slot || !selectedItems.length || !customer.name || !customer.phone || !vehicle.plate || bookMutation.isPending}
          onClick={() => bookMutation.mutate()}
        >
          {bookMutation.isPending && <Loader2 size={16} className="animate-spin" />} Confirm booking
        </button>
      </div>
      <ChatWidget />
    </div>
  );
}
