import { Badge } from "@/components/ui/badge";
import type { ConnectionState } from "@/hooks/useMarketStream";
import { CircleCheck, CloudOff, LoaderCircle, Radio, WifiOff } from "lucide-react";

export function MarketStreamStatus({ connection, providerState, message, lastUpdate, compact = false }: { connection: ConnectionState; providerState: "pending_activation" | "live"; message: string; lastUpdate: number | null; compact?: boolean }) {
  const live = connection === "connected" && providerState === "live";
  const offline = connection === "offline";
  const error = connection === "fallback";
  const icon = offline ? <WifiOff className="h-3.5 w-3.5" /> : error ? <CloudOff className="h-3.5 w-3.5" /> : connection === "connecting" || connection === "reconnecting" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : live ? <CircleCheck className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />;
  const tone = offline || error ? "border-rose-200 bg-rose-50 text-rose-700" : live ? "border-[#a7d8cb] bg-[#e8f5f0] text-[#006b5c]" : "border-[#d8e5b4] bg-[#f3f8e5] text-[#5e7529]";
  const label = offline ? "Hors ligne" : error ? "Repli catalogue" : connection === "connecting" || connection === "reconnecting" ? "Connexion WebSocket" : live ? "Flux partenaire actif" : "Catalogue partenaire en attente";
  return <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`} title={message}><span className="shrink-0">{icon}</span><span className="min-w-0 flex-1 truncate">{label}</span>{!compact && lastUpdate && <span className="hidden shrink-0 text-[10px] opacity-70 sm:inline">Mis à jour à {new Date(lastUpdate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>}</div>;
}
