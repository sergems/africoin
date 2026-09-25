import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Watchlist() {
  const { data: rows = [], isLoading } = trpc.watchlist.list.useQuery();
  const utils = trpc.useUtils();
  const remove = trpc.watchlist.remove.useMutation({ onSuccess: () => void utils.watchlist.list.invalidate(), onError: error => toast.error(error.message) });
  return <div className="min-h-screen bg-[#f5f7f5] px-4 py-6 sm:px-8 lg:px-10"><div className="mx-auto max-w-[1050px]"><header className="border-b border-slate-200 pb-6"><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#6b8e23]">Marchés suivis</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#0b1f2a]">Ma watchlist</h1><p className="mt-2 text-sm leading-6 text-slate-500">Les instruments suivis sont synchronisés avec votre compte.</p></header><Card className="mt-7 rounded-[24px] border-slate-200 bg-white"><CardHeader><div className="flex items-center gap-3"><Star className="h-5 w-5 text-[#008f76]" /><CardTitle className="text-lg text-[#0b1f2a]">Instruments favoris</CardTitle></div></CardHeader><CardContent>{isLoading ? <p className="text-sm text-slate-500">Chargement…</p> : rows.length ? <div className="space-y-3">{rows.map(row => <div key={row.id} className="flex items-center justify-between rounded-2xl bg-[#f7f9f7] p-4"><div><p className="font-semibold text-[#0b1f2a]">{row.instrument?.symbol ?? `Instrument #${row.instrumentId}`}</p><p className="mt-1 text-xs text-slate-500">{row.instrument?.name ?? "Donnée partenaire en attente"}</p></div><div className="flex items-center gap-3"><Badge variant="outline">{row.instrument?.price ?? "—"}</Badge><Button size="icon" variant="outline" onClick={() => remove.mutate({ instrumentId: row.instrumentId })} aria-label="Retirer de la watchlist"><Trash2 className="h-4 w-4 text-slate-500" /></Button></div></div>)}</div> : <div className="rounded-2xl bg-[#e8f5f0] p-6 text-sm leading-6 text-[#006b5c]">Votre watchlist est vide. Ajoutez un instrument depuis la page Marchés en cliquant sur l’étoile.</div>}</CardContent></Card></div></div>;
}
