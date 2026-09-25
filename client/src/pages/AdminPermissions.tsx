import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CheckCircle2, Clock3, Gavel, LockKeyhole, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { hasPermission, permissionMatrix, roleLabel, roleScope, type Permission, type PlatformRole } from "@shared/permissions";

const roleOrder: PlatformRole[] = ["admin", "super_admin", "compliance"];
const permissionLabels: Record<Permission, string> = {
  "funding.review": "Dépôts et retraits",
  "kyc.review": "Dossiers KYC",
  "compliance.alerts": "Alertes conformité",
  "limits.manage": "Limites de risque",
  "user.status": "Statut des comptes",
  "user.role": "Gestion des rôles",
  "approvals.read": "Lecture des approbations",
  "approvals.decide": "Décision des approbations",
  "audit.read": "Lecture de l’audit",
  "system.manage": "Réglages système",
};

export default function AdminPermissions() {
  const { user } = useAuth();
  const allowed = user?.role === "admin" || user?.role === "super_admin" || user?.role === "compliance";
  const approvals = trpc.adminApprovals.list.useQuery(undefined, { enabled: allowed, refetchInterval: 10000 });
  const utils = trpc.useUtils();
  const [note, setNote] = useState("");
  const decide = trpc.adminApprovals.decide.useMutation({
    onSuccess: result => {
      toast.success(result.executed ? "Quorum atteint : action exécutée et auditée." : "Décision enregistrée. Un second approbateur est requis.");
      setNote("");
      void utils.adminApprovals.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  if (!allowed) return <AccessDenied />;
  const pending = approvals.data?.pending ?? [];
  const history = approvals.data?.history ?? [];
  const decideRequest = (requestId: number, decision: "approve" | "reject") => {
    decide.mutate({ requestId, decision, note: note.trim() || undefined });
  };

  return <div className="min-h-screen bg-[#f5f7f5] px-4 py-6 sm:px-8 lg:px-10"><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div><Link href="/admin" className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#006b5c] hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Administration</Link><p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-[#6b8e23]">Version 2.2 · gouvernance</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#0b1f2a]">Permissions & approbations</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Une matrice lisible et une règle des deux personnes pour les changements sensibles. Les demandes restent en attente tant que deux approbateurs distincts n’ont pas validé.</p></div>
      <div className="flex flex-col items-start gap-2"><Badge className="w-fit border border-[#a7d8cb] bg-[#e8f5f0] px-4 py-2 text-[#006b5c]"><ShieldCheck className="mr-2 h-4 w-4" />{roleLabel(user!.role)} · périmètre audité</Badge><p className="text-xs text-slate-500">{roleScope(user!.role)}</p></div>
    </header>

    <section className="mt-7 grid gap-4 sm:grid-cols-3"><Metric label="Demandes en attente" value={String(pending.length)} icon={<Clock3 />} tone="gold" /><Metric label="Historique récent" value={String(history.length)} icon={<Gavel />} tone="teal" /><Metric label="Approbations requises" value="2" icon={<LockKeyhole />} tone="navy" /></section>

    <section className="mt-7 grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
      <Card className="rounded-[24px] border-slate-200 bg-white"><CardHeader><CardTitle className="text-xl text-[#0b1f2a]">Matrice de permissions</CardTitle><p className="text-sm text-slate-500">Les gardes sont appliquées côté serveur, avant chaque lecture ou mutation sensible.</p></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs uppercase tracking-[0.12em] text-slate-400"><th className="px-3 py-3 font-medium">Capacité</th>{roleOrder.map(role => <th key={role} className="px-3 py-3 font-medium">{roleLabel(role)}</th>)}</tr></thead><tbody>{Object.keys(permissionLabels).map(permission => <tr key={permission} className="border-b border-slate-50 last:border-0"><td className="px-3 py-3 font-medium text-[#0b1f2a]">{permissionLabels[permission as Permission]}</td>{roleOrder.map(role => <td key={role} className="px-3 py-3">{hasPermission(role, permission as Permission) ? <Badge className="bg-[#e8f5f0] text-[#006b5c]">Autorisé</Badge> : <Badge variant="outline" className="text-slate-400">Refusé</Badge>}</td>)}</tr>)}</tbody></table></div></CardContent></Card>
      <Card className="rounded-[24px] border-0 bg-[#0b1f2a] text-white shadow-xl"><CardHeader><CardTitle className="flex items-center gap-2 text-xl text-white"><LockKeyhole className="h-5 w-5 text-[#e6b84d]" />Règle des deux personnes</CardTitle></CardHeader><CardContent className="space-y-4 text-sm leading-6 text-slate-300"><p>Une demande sensible est créée par un opérateur autorisé, mais ne s’exécute jamais sur sa seule action.</p><div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1"><Rule step="01" text="Demandeur" detail="Justification obligatoire" /><Rule step="02" text="Premier avis" detail="Approver distinct" /><Rule step="03" text="Exécution" detail="Après le second avis" /></div><div className="rounded-2xl border border-[#e6b84d]/30 bg-[#e6b84d]/10 p-4 text-xs text-[#f7e0a4]">Auto-approbation, double décision du même compte et auto-blocage sont refusés par l’API.</div></CardContent></Card>
    </section>

    <section className="mt-7"><div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b8e23]">File de contrôle</p><h2 className="mt-1 text-2xl font-semibold text-[#0b1f2a]">Demandes en attente</h2></div><p className="text-xs text-slate-500">Actualisation automatique toutes les 10 secondes</p></div>{pending.length ? <div className="grid gap-4 lg:grid-cols-2">{pending.map(request => <ApprovalCard key={request.id} request={request} currentUserId={user!.id} currentRole={user!.role} note={note} setNote={setNote} isPending={decide.isPending} onDecide={decideRequest} />)}</div> : <div className="rounded-[24px] border border-[#a7d8cb] bg-[#e8f5f0] p-6 text-sm text-[#006b5c]"><CheckCircle2 className="mb-2 h-5 w-5" />Aucune demande en attente. La file de gouvernance est à jour.</div>}</section>

    <section className="mt-7"><Card className="rounded-[24px] border-slate-200 bg-white"><CardHeader><CardTitle className="text-xl text-[#0b1f2a]">Historique des décisions</CardTitle></CardHeader><CardContent>{history.length ? <div className="space-y-3">{history.map(request => <div key={request.id} className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-[#fbfcfb] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[#0b1f2a]">#{request.id} · {request.actionLabel}</span><Badge className={request.status === "approved" ? "bg-[#e8f5f0] text-[#006b5c]" : "bg-rose-100 text-rose-700"}>{request.status === "approved" ? "Exécutée" : request.status === "rejected" ? "Rejetée" : request.status}</Badge></div><p className="mt-1 text-xs text-slate-500">Demandeur : {request.requester?.name || `#${request.requesterUserId}`} · {new Date(request.createdAt).toLocaleString("fr-FR")}</p><p className="mt-1 text-xs text-slate-500">{request.reason}</p></div><p className="shrink-0 text-xs text-slate-500">{request.decisions.length}/{request.requiredApprovals} avis</p></div>)}</div> : <p className="text-sm text-slate-500">Aucun historique de gouvernance.</p>}</CardContent></Card></section>
  </div></div>;
}

function ApprovalCard({ request, currentUserId, currentRole, note, setNote, isPending, onDecide }: { request: any; currentUserId: number; currentRole: PlatformRole; note: string; setNote: (value: string) => void; isPending: boolean; onDecide: (id: number, decision: "approve" | "reject") => void }) {
  const alreadyDecided = request.decisions.some((decision: { approverUserId: number }) => decision.approverUserId === currentUserId);
  const isRequester = request.requesterUserId === currentUserId;
  const roleCanDecide = request.actionType === "role_change" ? currentRole === "super_admin" : request.actionType === "account_status" ? currentRole === "admin" || currentRole === "super_admin" : currentRole === "compliance" || currentRole === "super_admin";
  const blocked = alreadyDecided || isRequester || !roleCanDecide;
  return <Card className="rounded-[22px] border-slate-200 bg-white shadow-sm"><CardContent className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b8e23]">Demande #{request.id}</p><h3 className="mt-1 text-lg font-semibold text-[#0b1f2a]">{request.actionLabel}</h3></div><Badge className="bg-[#fff7df] text-[#8a6815]">{request.decisions.length}/{request.requiredApprovals} avis</Badge></div><div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><Info label="Demandeur" value={request.requester?.name || `#${request.requesterUserId}`} /><Info label="Cible" value={request.target?.name || `#${request.payload.targetUserId}`} /><Info label="Justification" value={request.reason} /><Info label="Créée" value={new Date(request.createdAt).toLocaleString("fr-FR")} /></div>{request.decisions.length > 0 && <div className="mt-4 rounded-xl bg-[#f5f8f2] p-3 text-xs text-slate-600">Avis déjà enregistrés : {request.decisions.map((decision: { approver: string; decision: string }) => `${decision.approver} · ${decision.decision === "approve" || decision.decision === "approved" ? "approuve" : "rejette"}`).join(" · ")}</div>}<Input value={note} onChange={event => setNote(event.target.value)} placeholder="Note de décision (optionnelle)" className="mt-4" disabled={blocked || isPending} /><div className="mt-4 flex flex-col gap-2 sm:flex-row"><Button onClick={() => onDecide(request.id, "approve")} disabled={blocked || isPending} className="flex-1 bg-[#008f76] text-white hover:bg-[#006b5c]"><CheckCircle2 className="mr-2 h-4 w-4" />Approuver</Button><Button onClick={() => onDecide(request.id, "reject")} disabled={blocked || isPending} variant="outline" className="flex-1 border-rose-200 text-rose-700 hover:bg-rose-50"><XCircle className="mr-2 h-4 w-4" />Rejeter</Button></div>{isRequester && <p className="mt-3 text-xs text-amber-700">Vous êtes le demandeur : un autre opérateur doit décider.</p>}{alreadyDecided && <p className="mt-3 text-xs text-slate-500">Votre décision est déjà enregistrée.</p>}{!roleCanDecide && !isRequester && <p className="mt-3 text-xs text-slate-500">Votre rôle n’est pas habilité pour cette action.</p>}</CardContent></Card>;
}

function Rule({ step, text, detail }: { step: string; text: string; detail: string }) { return <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e6b84d] text-xs font-bold text-[#0b1f2a]">{step}</span><div><p className="font-medium text-white">{text}</p><p className="text-xs text-slate-400">{detail}</p></div></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-1 break-words text-sm text-[#0b1f2a]">{value}</p></div>; }
function Metric({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: "gold" | "teal" | "navy" }) { const styles = { gold: "bg-[#fff7df] text-[#8a6815]", teal: "bg-[#e8f5f0] text-[#008f76]", navy: "bg-[#e9f0f5] text-[#0b1f2a]" }; return <Card className="rounded-[22px] border-0 bg-white shadow-sm"><CardContent className="flex items-center gap-4 p-5"><span className={`grid h-10 w-10 place-items-center rounded-xl ${styles[tone]}`}>{icon}</span><div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-[#0b1f2a]">{value}</p></div></CardContent></Card>; }
function AccessDenied() { return <div className="grid min-h-screen place-items-center bg-[#f5f7f5] p-6"><Card className="max-w-md rounded-[24px] border-slate-200 bg-white"><CardContent className="p-8 text-center"><LockKeyhole className="mx-auto h-10 w-10 text-[#008f76]" /><h1 className="mt-4 text-xl font-semibold text-[#0b1f2a]">Accès gouvernance requis</h1><p className="mt-2 text-sm leading-6 text-slate-500">La matrice et les approbations sont réservées aux rôles administratifs et conformité.</p></CardContent></Card></div>; }
