import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Car } from "lucide-react";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { ChatWidget } from "../components/ChatWidget";

interface TrackingInfo {
  status: string;
  stageIndex: number;
  stages: string[];
  customerName: string;
  vehicle: { make: string; model: string; plate: string };
  bay: string | null;
  services: string[];
  scheduledAt?: string;
}

const STAGE_LABELS: Record<string, string> = {
  WAITING: "Checked in",
  IN_SERVICE: "In service",
  QUALITY_CHECK: "Quality check",
  READY: "Ready for pickup",
  COMPLETED: "Completed",
};

export function TrackingPublic() {
  const { token } = useParams<{ token: string }>();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["tracking", token],
    queryFn: () => api.get<TrackingInfo>(`/track/${token}`, { auth: false }),
  });

  useEffect(() => {
    if (!token) return;
    socket.connect();
    socket.emit("join:tracking", token);
    const handler = () => qc.invalidateQueries({ queryKey: ["tracking", token] });
    socket.on("tracking:update", handler);
    return () => {
      socket.off("tracking:update", handler);
      socket.disconnect();
    };
  }, [token, qc]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-brand-400" size={32} /></div>;
  if (isError || !data) return <div className="min-h-screen flex items-center justify-center text-ink-500">Tracking link not found.</div>;

  if (data.status === "BOOKED") {
    return (
      <div className="min-h-screen bg-ink-950 py-10 px-4">
        <div className="max-w-lg mx-auto card space-y-3 text-center">
          <Car className="text-brand-400 mx-auto mb-2" size={36} />
          <h1 className="text-xl font-bold text-ink-100">{data.vehicle.make} {data.vehicle.model}</h1>
          <p className="text-ink-500">{data.vehicle.plate}</p>
          <p className="text-ink-300">
            Booked for <strong>{data.scheduledAt && new Date(data.scheduledAt).toLocaleString()}</strong>.
            Live tracking starts once you check in.
          </p>
        </div>
        <ChatWidget />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950 py-10 px-4">
      <div className="max-w-lg mx-auto card space-y-6">
        <div className="text-center">
          <Car className="text-brand-400 mx-auto mb-2" size={36} />
          <h1 className="text-xl font-bold text-ink-100">{data.vehicle.make} {data.vehicle.model}</h1>
          <p className="text-ink-500">{data.vehicle.plate} {data.bay ? `· ${data.bay}` : ""}</p>
        </div>

        <div className="space-y-3">
          {data.stages.map((stage, i) => {
            const done = i < data.stageIndex;
            const current = i === data.stageIndex;
            return (
              <div key={stage} className="flex items-center gap-3">
                {done || current ? (
                  <CheckCircle2 size={22} className={current ? "text-brand-400" : "text-brand-400"} />
                ) : (
                  <Circle size={22} className="text-ink-300" />
                )}
                <span className={`text-sm ${current ? "font-semibold text-ink-100" : "text-ink-500"}`}>
                  {STAGE_LABELS[stage]}
                </span>
                {current && <span className="ml-auto text-xs text-brand-400 animate-pulse">Live</span>}
              </div>
            );
          })}
        </div>

        {data.services.length > 0 && (
          <div className="border-t border-ink-800 pt-3">
            <div className="text-xs text-ink-500 mb-1">Services</div>
            <div className="flex flex-wrap gap-1.5">
              {data.services.map((s) => (
                <span key={s} className="badge bg-ink-800 text-ink-300">{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      <ChatWidget />
    </div>
  );
}
