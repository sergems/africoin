import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, LockKeyhole, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AssetFilter = "all" | "equity" | "fx_spot";

export default function AdminMarkets() {
  const { user } = useAuth();
  const { data: instruments = [], isLoading } = trpc.adminMarkets.list.useQuery();
  const utils = trpc.useUtils();
  const updateRate = trpc.adminMarkets.updateRate.useMutation({ onSuccess: () => { toast.success("Cours / taux mis à jour et journalisé."); void utils.adminMarkets.list.invalidate(); }, onError: error => toast.error(error.message) });
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => instruments.filter((item: any) => (filter === "all" || item.assetClass === filter) && (!query || `${item.symbol} ${item.name}`.toLowerCase().includes(query.toLowerCase()))), [instruments, filter, query]);

  if (user?.role !== "admin" && user?.role !== "super_admin") return <AccessDenied />;
  return <div className="min-h-screen bg-[#f5f7f5] px-4 py-6 sm:px-8 lg:px-10"><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between"><div><Link href="/admin" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-[#0b1f2a]"><ArrowLeft className="h-4 w-4" />Retour administration</Link><p className="mt-7 text-xs font-semibold uppercase tracking-[0.22em] text-[#6b8e23]">Contrôle des marchés</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#0b1f2a]">Instruments & taux administrés</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Gérez le catalogue disponible et définissez le cours indicatif ou le taux de change affiché aux utilisateurs. Chaque modification est enregistrée dans l’audit.</p></div><Badge className="w-fit border border-[#a7d8cb] bg-[#e8f5f0] px-4 py-2 text-[#006b5c]"><LockKeyhole className="mr-2 h-4 w-4" />Accès administrateur · taux contrôlés</Badge></header>
    <div className="mt-7 rounded-2xl border border-[#e6b84d]/40 bg-[#fff8e7] p-4 text-sm leading-6 text-[#72531d]"><strong>Important :</strong> les valeurs affichées sont indicatives tant qu’aucun fournisseur partenaire n’est connecté. Pour le forex, le champ « cours / taux » représente le taux de change de la paire, par exemple USD/CDF.</div>
    <Card className="mt-6 rounded-[24px] border-slate-200 bg-white"><CardHeader><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><CardTitle className="flex items-center gap-2 text-xl text-[#0b1f2a]"><Settings2 className="h-5 w-5 text-[#008f76]" />Catalogue administrable <span className="text-sm font-normal text-slate-400">({filtered.length})</span></CardTitle><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher un symbole" className="max-w-sm" /></div><div className="flex flex-wrap gap-2"><Filter active={filter === "all"} onClick={() => setFilter("all")}>Tous</Filter><Filter active={filter === "equity"} onClick={() => setFilter("equity")}>Actions & ETF</Filter><Filter active={filter === "fx_spot"} onClick={() => setFilter("fx_spot")}>Forex</Filter></div></CardHeader><CardContent>{isLoading ? <p className="text-sm text-slate-500">Chargement du catalogue…</p> : <div className="space-y-3">{filtered.map((instrument: any) => <RateRow key={instrument.id} instrument={instrument} pending={updateRate.isPending} onSave={(payload: { price: number; changePercent?: number; status?: "active" | "disabled" | "pending_approval"; note: string }) => updateRate.mutate({ instrumentId: Number(instrument.id), ...payload })} />)}</div>}</CardContent></Card>
  </div></div>;
}

function RateRow({ instrument, pending, onSave }: { instrument: any; pending: boolean; onSave: (payload: { price: number; changePercent?: number; status?: "active" | "disabled" | "pending_approval"; note: string }) => void }) {
  const [price, setPrice] = useState(String(instrument.price));
  const [changePercent, setChangePercent] = useState(String(instrument.changePercent ?? "0"));
  const [status, setStatus] = useState<"active" | "disabled" | "pending_approval">(instrument.status ?? "active");
  const [note, setNote] = useState("");
  return <div className="grid gap-4 rounded-2xl border border-slate-100 bg-[#fbfcfb] p-4 lg:grid-cols-[1.2fr_.7fr_1fr_1fr_1fr_auto] lg:items-end"><div><div className="flex items-center gap-2"><span className="font-semibold text-[#0b1f2a]">{instrument.symbol}</span><Badge variant="outline" className="text-[10px]">{instrument.exchange}</Badge></div><p className="mt-1 text-xs text-slate-500">{instrument.name} · {instrument.baseCurrency}/{instrument.quoteCurrency}</p></div><div><label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Statut</label><select value={status} onChange={event => setStatus(event.target.value as typeof status)} className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700"><option value="active">Actif</option><option value="pending_approval">En attente</option><option value="disabled">Désactivé</option></select></div><div><label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Cours / taux</label><Input type="number" min="0.00000001" step="any" value={price} onChange={event => setPrice(event.target.value)} className="mt-2 bg-white" /></div><div><label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Variation %</label><Input type="number" step="0.0001" value={changePercent} onChange={event => setChangePercent(event.target.value)} className="mt-2 bg-white" /></div><div><label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Note audit</label><Input value={note} onChange={event => setNote(event.target.value)} placeholder="Source / justification" className="mt-2 bg-white" /></div><Button disabled={pending || !note.trim() || Number(price) <= 0} onClick={() => onSave({ price: Number(price), changePercent: Number(changePercent), status, note })} className="bg-[#0b1f2a] text-white hover:bg-[#163747]"><Save className="mr-2 h-4 w-4" />Enregistrer</Button></div>;
}

function Filter({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`rounded-lg px-3 py-2 text-xs font-medium ${active ? "bg-[#0b1f2a] text-white" : "text-slate-500 hover:bg-slate-100"}`}>{children}</button>; }
function AccessDenied() { return <div className="grid min-h-screen place-items-center bg-[#f5f7f5] p-6"><Card className="max-w-md rounded-[24px] border-slate-200 bg-white"><CardContent className="p-8 text-center"><LockKeyhole className="mx-auto h-10 w-10 text-[#008f76]" /><h1 className="mt-4 text-xl font-semibold text-[#0b1f2a]">Accès administrateur requis</h1><p className="mt-2 text-sm leading-6 text-slate-500">Cette console est réservée au rôle administrateur.</p></CardContent></Card></div>; }
