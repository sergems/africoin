import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowUpRight, Banknote, CheckCircle2, FileCheck2, FileSearch, LockKeyhole, Search, XCircle } from "lucide-react";
import { toast } from "sonner";

type Kind = "deposit" | "withdrawal";
type QueueItem = { kind: Kind; row: any };

export default function Admin() {
  const { user } = useAuth();
  const { data, isLoading } = trpc.adminFunding.queue.useQuery(undefined, { refetchInterval: 10000 });
  const { data: feeLedger } = trpc.adminFunding.feeLedger.useQuery(undefined, { refetchInterval: 15000 });
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [note, setNote] = useState("");
  const [providerReference, setProviderReference] = useState("");
  const [settledAmount, setSettledAmount] = useState("");
  const [externalPayoutReference, setExternalPayoutReference] = useState("");

  const refresh = () => {
    void utils.adminFunding.queue.invalidate();
    void utils.adminFunding.feeLedger.invalidate();
  };
  const decide = trpc.adminFunding.decide.useMutation({
    onSuccess: result => {
      toast.success(result.status === "approved_pending_payout" ? "Retrait approuvé et montant réservé. Effectuez le paiement externe avant de le marquer réglé." : result.status === "completed" ? "Dépôt approuvé et crédité." : "Demande rejetée.");
      setSelected(null);
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const completePayout = trpc.adminFunding.completePayout.useMutation({
    onSuccess: result => {
      toast.success(`Retrait ${result.reference} réglé; frais Africoin comptabilisés.`);
      setSelected(null);
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const cancelPayout = trpc.adminFunding.cancelPayout.useMutation({
    onSuccess: result => {
      toast.success(`Retrait ${result.reference} annulé; montant libéré et aucun frais prélevé.`);
      setSelected(null);
      refresh();
    },
    onError: error => toast.error(error.message),
  });

  const entries = useMemo(() => {
    const all: QueueItem[] = [
      ...(data?.deposits ?? []).map(row => ({ kind: "deposit" as const, row })),
      ...(data?.withdrawals ?? []).map(row => ({ kind: "withdrawal" as const, row })),
    ];
    return all
      .filter(item => (filter === "all" || item.kind === filter)
        && (!search || item.row.reference.toLowerCase().includes(search.toLowerCase()) || String(item.row.userId).includes(search)))
      .sort((a, b) => new Date(b.row.createdAt).getTime() - new Date(a.row.createdAt).getTime());
  }, [data, filter, search]);

  if (user?.role !== "admin" && user?.role !== "super_admin") return <AccessDenied />;

  const canReview = Boolean(selected && (selected.kind === "deposit"
    ? ["requested", "pending_review", "processing"].includes(selected.row.status)
    : ["requested", "pending_review"].includes(selected.row.status)));
  const canComplete = Boolean(selected?.kind === "withdrawal" && selected.row.status === "approved_pending_payout");
  const busy = decide.isPending || completePayout.isPending || cancelPayout.isPending;
  const submitDecision = (decision: "approve" | "reject") => {
    if (!selected || !canReview || note.trim().length < 3) { toast.error("Ajoutez une note de décision d’au moins 3 caractères."); return; }
    decide.mutate({
      kind: selected.kind,
      id: selected.row.id,
      decision,
      note: note.trim(),
      providerReference: selected.kind === "deposit" ? providerReference.trim() || undefined : undefined,
      settledAmount: selected.kind === "deposit" && settledAmount ? Number(settledAmount) : undefined,
    });
  };
  const submitPayout = () => {
    if (!selected || !canComplete || externalPayoutReference.trim().length < 3 || note.trim().length < 3) {
      toast.error("Saisissez une référence de versement externe et une note d’au moins 3 caractères.");
      return;
    }
    completePayout.mutate({ id: selected.row.id, externalPayoutReference: externalPayoutReference.trim(), note: note.trim() });
  };
  const submitCancellation = () => {
    if (!selected || !canComplete || note.trim().length < 3) { toast.error("Ajoutez une justification d’annulation d’au moins 3 caractères."); return; }
    cancelPayout.mutate({ id: selected.row.id, note: note.trim() });
  };

  return (
    <div className="min-h-screen bg-[#f7f7f2] px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#087f78]">Africoin · opérations financières</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#0a2233]">Dépôts, retraits et frais</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Les retraits exigent un KYC approuvé et trois justificatifs acceptés. L’approbation réserve le montant total; le paiement externe reste manuel et doit être confirmé avec une référence.</p>
          </div>
          <Badge className="w-fit border border-[#b9ded4] bg-[#e9f6f2] px-4 py-2 text-[#087f78]"><LockKeyhole className="mr-2 h-4 w-4" />Actions auditées · portée financière contrôlée</Badge>
        </header>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="À traiter" value={String(data?.totals.pending ?? 0)} />
          <Metric label="Dépôts en revue" value={String(data?.totals.deposits ?? 0)} />
          <Metric label="Retraits à approuver" value={String(data?.totals.withdrawals ?? 0)} />
          <Metric label="Paiement à confirmer" value={String(data?.totals.approvedAwaitingPayout ?? 0)} />
          <Metric label="Frais Africoin · USD / CDF" value={`${feeLedger?.totals.USD ?? "0.00"} / ${feeLedger?.totals.CDF ?? "0.00"}`} />
        </div>

        <div className="mt-7 grid gap-6 xl:grid-cols-[1fr_390px]">
          <Card className="rounded-2xl border-slate-200 bg-white">
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle className="text-xl text-[#0a2233]">File des opérations</CardTitle>
                <div className="relative w-full lg:w-64"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Référence ou client" className="pl-9" /></div>
              </div>
              <div className="flex gap-2">
                <Filter active={filter === "all"} onClick={() => setFilter("all")}>Toutes</Filter>
                <Filter active={filter === "deposit"} onClick={() => setFilter("deposit")}>Dépôts</Filter>
                <Filter active={filter === "withdrawal"} onClick={() => setFilter("withdrawal")}>Retraits</Filter>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? <p className="text-sm text-slate-500">Chargement de la file…</p> : entries.length ? <div className="space-y-3">
                {entries.map(item => <button key={`${item.kind}-${item.row.id}`} onClick={() => { setSelected(item); setNote(""); setProviderReference(""); setSettledAmount(""); setExternalPayoutReference(""); }} className={`w-full rounded-2xl border p-4 text-left transition hover:border-[#b9d77a] hover:bg-[#f7f7f2] ${selected?.kind === item.kind && selected?.row.id === item.row.id ? "border-[#9fbf5a] bg-[#e9f6f2]" : "border-slate-100 bg-[#fbfcfb]"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div><div className="flex items-center gap-2"><span className="font-semibold text-[#0a2233]">{item.row.reference}</span><Badge variant="outline">{item.kind === "deposit" ? "Dépôt" : "Retrait"}</Badge></div><p className="mt-1 text-xs text-slate-500">Utilisateur #{item.row.userId} · {item.kind === "deposit" ? item.row.method : item.row.destinationType}</p>
                      {item.kind === "withdrawal" && <p className="mt-1 text-xs text-slate-500">Frais {item.row.feeAmount} {item.row.currency} · net {item.row.payoutAmount} {item.row.currency}</p>}
                    </div>
                    <div className="text-left sm:text-right"><p className="font-semibold text-[#0a2233]">{item.row.amount} {item.row.currency}</p><p className="mt-1 text-xs text-amber-600">{fundingStatusLabel(item.kind, item.row.status)}</p></div>
                  </div>
                </button>)}
              </div> : <div className="rounded-2xl bg-[#e9f6f2] p-6 text-sm text-[#087f78]">Aucune demande ne correspond aux filtres actuels.</div>}
            </CardContent>
          </Card>

          <Card className="h-fit rounded-2xl border-0 bg-[#0a2233] text-white">
            <CardHeader><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#18b89a]">Décision / versement</p><CardTitle className="mt-2 text-xl font-medium">{selected ? selected.row.reference : "Sélectionnez une demande"}</CardTitle></CardHeader>
            <CardContent>
              {selected ? <div className="space-y-5">
                <div className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
                  <Detail label="Type" value={selected.kind === "deposit" ? "Dépôt" : "Retrait"} />
                  <Detail label="Utilisateur" value={`#${selected.row.userId}`} />
                  <Detail label="Montant total" value={`${selected.row.amount} ${selected.row.currency}`} />
                  {selected.kind === "withdrawal" && <>
                    <Detail label="Frais Africoin (2,5 %)" value={`${selected.row.feeAmount} ${selected.row.currency}`} />
                    <Detail label="Versement net" value={`${selected.row.payoutAmount} ${selected.row.currency}`} />
                  </>}
                  <Detail label="Canal" value={selected.kind === "deposit" ? selected.row.method : selected.row.destinationType} />
                  <Detail label="KYC" value={selected.row.kyc?.status ?? "non démarré"} />
                  <Detail label="Limite compte" value={selected.row.limits?.status ?? "non configurée"} />
                  <Detail label="Soldes" value={(selected.row.wallets ?? []).map((wallet: any) => `${wallet.availableBalance} ${wallet.currency} disponible`).join(" · ") || "aucun solde"} />
                  <Detail label="Réconciliation" value={selected.row.reconciliation?.[0]?.status ?? "non rapprochée"} />
                </div>

                {selected.kind === "withdrawal" && <Link href="/compliance" className="inline-flex items-center gap-2 text-xs font-semibold text-[#7ddcca] hover:underline"><FileSearch className="h-4 w-4" />Examiner le KYC et les documents</Link>}
                {selected.kind === "deposit" && <>
                  <div><label className="text-xs font-medium text-slate-300">Référence partenaire</label><Input value={providerReference} onChange={event => setProviderReference(event.target.value)} placeholder="Référence de règlement (facultatif)" className="mt-2 border-white/10 bg-white/10 text-white placeholder:text-slate-500" /></div>
                  <div><label className="text-xs font-medium text-slate-300">Montant réglé</label><Input type="number" value={settledAmount} onChange={event => setSettledAmount(event.target.value)} placeholder="Montant confirmé (facultatif)" className="mt-2 border-white/10 bg-white/10 text-white placeholder:text-slate-500" /></div>
                </>}

                {(canReview || canComplete) && <div><label className="text-xs font-medium text-slate-300">Note obligatoire</label><Input value={note} onChange={event => setNote(event.target.value)} placeholder="Justification de la décision" className="mt-2 border-white/10 bg-white/10 text-white placeholder:text-slate-500" /></div>}
                {selected.kind === "deposit" && canReview && <div className="grid grid-cols-2 gap-2"><Button disabled={busy} onClick={() => submitDecision("reject")} className="border border-[#e9a49b]/30 bg-transparent text-[#f0b4aa] hover:bg-[#e9a49b]/10"><XCircle className="mr-2 h-4 w-4" />Rejeter</Button><Button disabled={busy} onClick={() => submitDecision("approve")} className="bg-[#e6b93f] text-[#0a2233] hover:bg-[#f7e0a4]"><CheckCircle2 className="mr-2 h-4 w-4" />Approuver et créditer</Button></div>}
                {selected.kind === "withdrawal" && canReview && <div className="grid grid-cols-2 gap-2"><Button disabled={busy} onClick={() => submitDecision("reject")} className="border border-[#e9a49b]/30 bg-transparent text-[#f0b4aa] hover:bg-[#e9a49b]/10"><XCircle className="mr-2 h-4 w-4" />Rejeter</Button><Button disabled={busy} onClick={() => submitDecision("approve")} className="bg-[#e6b93f] text-[#0a2233] hover:bg-[#f7e0a4]"><CheckCircle2 className="mr-2 h-4 w-4" />Approuver · réserver</Button></div>}

                {canComplete && <>
                  <div><label className="text-xs font-medium text-slate-300">Référence du paiement externe (obligatoire)</label><Input value={externalPayoutReference} onChange={event => setExternalPayoutReference(event.target.value)} placeholder="Référence de transfert réellement exécuté" className="mt-2 border-white/10 bg-white/10 text-white placeholder:text-slate-500" /></div>
                  <div className="rounded-xl border border-[#e6b93f]/30 bg-[#e6b93f]/10 p-3 text-xs leading-5 text-[#f7e0a4]">Avant d’envoyer le versement de {selected.row.payoutAmount} {selected.row.currency}, vérifiez dans Conformité l’approbation KYC, l’acceptation des trois documents requis et les états actifs du compte, du risque et du portefeuille. Africoin revérifie ces conditions à l’enregistrement; si l’une échoue, le retrait ne sera pas réglé. Cette action ne transfère pas d’argent.</div>
                  <Button disabled={busy || externalPayoutReference.trim().length < 3 || note.trim().length < 3} onClick={submitPayout} className="w-full bg-[#e6b93f] text-[#0a2233] hover:bg-[#f7e0a4]"><CheckCircle2 className="mr-2 h-4 w-4" />Confirmer le paiement effectué</Button>
                  <Button disabled={busy || note.trim().length < 3} onClick={submitCancellation} variant="outline" className="w-full border-white/20 bg-transparent text-white hover:bg-white/10"><XCircle className="mr-2 h-4 w-4" />Annuler et libérer le montant</Button>
                  <p className="text-[11px] leading-5 text-slate-400">Annulez et libérez le montant uniquement si aucun versement externe n’a encore été envoyé.</p>
                </>}
                {!canReview && !canComplete && <div className="rounded-xl border border-white/10 p-3 text-xs text-slate-300">Cette demande a déjà été traitée; aucune nouvelle décision n’est disponible.</div>}
                <Trace selected={selected.row} />
              </div> : <div className="space-y-4 text-sm leading-6 text-slate-300"><FileCheck2 className="h-8 w-8 text-[#e6b93f]" /><p>Choisissez une ligne pour examiner la demande, consigner une justification et appliquer la bonne étape.</p><div className="rounded-2xl border border-white/10 p-4"><p className="font-medium text-white">Retraits</p><p className="mt-2 text-xs text-slate-400">L’approbation réserve le total. Le versement de 97,5 % est manuel; 2,5 % sont enregistrés dans le compte interne de frais Africoin uniquement après confirmation du paiement externe.</p></div></div>}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-7 rounded-2xl border-slate-200 bg-white">
          <CardHeader><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e9f6f2] text-[#087f78]"><Banknote className="h-5 w-5" /></span><div><CardTitle className="text-xl text-[#0a2233]">Compte interne des frais Africoin</CardTitle><p className="mt-1 text-xs text-slate-500">Seuls les frais de retraits dont le versement externe est marqué effectué sont comptabilisés.</p></div></div></CardHeader>
          <CardContent>
            <div className="mb-5 grid gap-3 sm:grid-cols-2"><FeeTotal currency="USD" value={feeLedger?.totals.USD ?? "0.00"} /><FeeTotal currency="CDF" value={feeLedger?.totals.CDF ?? "0.00"} /></div>
            {feeLedger?.transactions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3 pr-4">Retrait</th><th className="py-3 pr-4">Utilisateur</th><th className="py-3 pr-4">Total débité</th><th className="py-3 pr-4">Frais reçus</th><th className="py-3 pr-4">Net payé</th><th className="py-3 pr-4">Réf. externe</th><th className="py-3">Enregistré le</th></tr></thead><tbody>{feeLedger.transactions.map(row => <tr key={row.id} className="border-b border-slate-50 text-[#0a2233]"><td className="py-3 pr-4 font-medium">{row.withdrawalReference}</td><td className="py-3 pr-4">#{row.userId}</td><td className="py-3 pr-4">{row.grossAmount} {row.currency}</td><td className="py-3 pr-4 font-semibold text-[#087f78]">{row.feeAmount} {row.currency}</td><td className="py-3 pr-4">{row.payoutAmount} {row.currency}</td><td className="py-3 pr-4">{row.externalPayoutReference}</td><td className="py-3">{new Date(row.collectedAt).toLocaleString("fr-FR")}</td></tr>)}</tbody></table></div> : <p className="rounded-xl bg-[#f7f9f7] p-5 text-sm text-slate-500">Aucun frais de retrait Africoin n’a encore été collecté.</p>}
          </CardContent>
        </Card>

        <div className="mt-6 grid gap-4 rounded-2xl border border-[#b9ded4] bg-[#e9f6f2] p-5 text-sm text-[#087f78] md:grid-cols-3"><Safety icon={<ArrowUpRight />} title="Versement externe" text="Manuel · référence obligatoire" /><Safety icon={<FileCheck2 />} title="Réconciliation" text="Montants, références et décisions historisés" /><Safety icon={<LockKeyhole />} title="Audit" text="Approbations et frais traçables" /></div>
      </div>
    </div>
  );
}

function fundingStatusLabel(kind: Kind, status: string) {
  if (kind === "withdrawal" && status === "approved_pending_payout") return "Approuvé · paiement à confirmer";
  if (kind === "withdrawal" && ["requested", "pending_review"].includes(status)) return "À approuver";
  if (kind === "withdrawal" && status === "processing") return "État antérieur · à examiner";
  return status;
}

function AccessDenied() {
  return <div className="grid min-h-screen place-items-center bg-[#f7f7f2] p-6"><Card className="max-w-md rounded-2xl border-slate-200 bg-white"><CardContent className="p-8 text-center"><LockKeyhole className="mx-auto h-10 w-10 text-[#087f78]" /><h1 className="mt-4 text-xl font-semibold text-[#0a2233]">Accès Africoin requis</h1><p className="mt-2 text-sm leading-6 text-slate-500">Cet espace est réservé à l’équipe Africoin.</p></CardContent></Card></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card className="rounded-2xl border-0 bg-white shadow-sm"><CardContent className="p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-[#0a2233]">{value}</p><p className="mt-1 text-xs text-slate-400">mise à jour automatique</p></CardContent></Card>;
}

function FeeTotal({ currency, value }: { currency: string; value: string }) {
  return <div className="flex items-center justify-between rounded-xl border border-[#b9ded4] bg-[#e9f6f2] p-4"><span className="text-sm font-medium text-[#087f78]">Total reçu · {currency}</span><span className="font-semibold text-[#0a2233]">{Number(value).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span></div>;
}

function Filter({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-lg px-3 py-2 text-xs font-medium ${active ? "bg-[#0a2233] text-white" : "text-slate-500 hover:bg-slate-100"}`}>{children}</button>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 last:border-0 last:pb-0"><span className="text-slate-400">{label}</span><span className="text-right font-medium text-white">{value}</span></div>;
}

function Trace({ selected }: { selected: any }) {
  return <div className="space-y-3 rounded-2xl border border-white/10 p-3 text-xs text-slate-300">
    <div><p className="font-medium text-white">Traçabilité</p><p className="mt-2">Audit : {selected.audit?.length ?? 0} événement(s) · Réconciliation : {selected.reconciliationHistory?.length ?? 0} événement(s)</p>{selected.audit?.slice(0, 3).map((event: any) => <p key={event.id} className="mt-1 text-[11px] text-slate-400">{event.action} · {new Date(event.createdAt).toLocaleString("fr-FR")}</p>)}</div>
    <div><p className="font-medium text-white">Historique de réconciliation</p>{selected.reconciliationHistory?.length ? [...selected.reconciliationHistory].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((entry: any) => <div key={entry.id} className="mt-2 border-l border-[#e6b93f]/50 pl-3"><p className="text-white">{entry.status} · {entry.settledAmount ?? "—"} {entry.currency}</p><p className="mt-1 text-[11px] text-slate-400">{entry.entityType} · attendu {entry.expectedAmount} {entry.currency} · {entry.providerReference ?? "sans référence externe"}</p><p className="mt-1 text-[11px] text-slate-400">{entry.reviewNote ?? "Aucune note"} · {entry.reviewedBy ? `revu par #${entry.reviewedBy}` : "non revu"}</p></div>) : <p className="mt-2 text-slate-400">Aucun état de réconciliation enregistré.</p>}</div>
  </div>;
}

function Safety({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="flex items-center gap-3"><span className="text-[#087f78]">{icon}</span><div><p className="font-semibold">{title}</p><p className="text-xs">{text}</p></div></div>;
}
