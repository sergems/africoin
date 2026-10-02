import { ArrowLeft, CircleAlert, CircleCheck, Clock3, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

function shouldPollResult(status: string, providerStatus: string | null) {
  if (status === "processing") return true;
  if (status !== "pending_review") return false;
  return !["VERIFICATION_EXCEPTION", "SUCCESS_COMPLIANCE_HOLD"].includes(providerStatus ?? "");
}

function getPresentation(status: string, providerStatus: string | null) {
  if (status === "completed") {
    return {
      title: "Dépôt confirmé",
      icon: CircleCheck,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      badge: "Confirmé",
    };
  }
  if (status === "failed" || status === "rejected") {
    return {
      title: "Paiement non confirmé",
      icon: CircleAlert,
      tone: "border-rose-200 bg-rose-50 text-rose-700",
      badge: "Échoué",
    };
  }
  if (providerStatus === "SUCCESS_COMPLIANCE_HOLD") {
    return {
      title: "Paiement reçu — revue nécessaire",
      icon: CircleAlert,
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      badge: "Revue conformité",
    };
  }
  if (providerStatus === "VERIFICATION_EXCEPTION") {
    return {
      title: "Vérification manuelle requise",
      icon: CircleAlert,
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      badge: "À vérifier",
    };
  }
  return {
    title: "Résultat du paiement en cours",
    icon: Clock3,
    tone: "border-[#e6b93f]/40 bg-[#fff9e8] text-[#765710]",
    badge: "En cours",
  };
}

export default function PaymentSuccess() {
  const [, setLocation] = useLocation();
  const reference = new URLSearchParams(window.location.search).get("reference")?.trim() ?? "";
  const resultQuery = trpc.wallets.getDepositStatus.useQuery(
    { reference },
    {
      enabled: reference.length >= 8,
      refetchInterval: query => {
        const result = query.state.data;
        return result && shouldPollResult(result.status, result.providerStatus) ? 5_000 : false;
      },
      refetchIntervalInBackground: false,
    },
  );
  const refreshStatus = trpc.wallets.refreshKelpayStatus.useMutation({
    onSuccess: async () => {
      await resultQuery.refetch();
    },
    onError: error => toast.error(error.message),
  });

  const result = resultQuery.data;
  const presentation = result ? getPresentation(result.status, result.providerStatus) : null;
  const Icon = presentation?.icon;
  const hasReference = reference.length >= 8;
  const formattedAmount = result
    ? Number(result.amount).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
  const formattedDate = result && !Number.isNaN(Date.parse(result.createdAt))
    ? new Date(result.createdAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })
    : "—";

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-[#f7f7f2] px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <Button variant="ghost" onClick={() => setLocation("/wallets")} className="mb-5 text-[#0a2233]">
          <ArrowLeft className="mr-2 h-4 w-4" /> Retour aux portefeuilles
        </Button>

        <Card className="overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm">
          <div className="h-1.5 bg-[#087f78]" />
          <CardContent className="p-6 sm:p-9">
            {resultQuery.isLoading ? (
              <div className="py-12 text-center" role="status" aria-live="polite">
                <RefreshCw className="mx-auto h-8 w-8 animate-spin text-[#087f78]" />
                <p className="mt-4 text-sm text-slate-500">Chargement du résultat de la transaction…</p>
              </div>
            ) : !hasReference || resultQuery.isError || !result || !presentation || !Icon ? (
              <div className="py-10 text-center">
                <CircleAlert className="mx-auto h-10 w-10 text-amber-600" />
                <h1 className="mt-4 text-2xl font-semibold text-[#0a2233]">Résultat indisponible</h1>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Cette référence de transaction est introuvable pour votre compte. Consultez votre portefeuille ou réessayez avec la référence reçue.
                </p>
                <Button onClick={() => setLocation("/wallets")} className="mt-6 bg-[#0a2233] text-white hover:bg-[#0d2638]">
                  Ouvrir mes portefeuilles
                </Button>
              </div>
            ) : (
              <>
                <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full border ${presentation.tone}`}>
                  <Icon className="h-8 w-8" aria-hidden="true" />
                </div>
                <div className="mt-5 text-center">
                  <Badge variant="outline" className={presentation.tone}>{presentation.badge}</Badge>
                  <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#0a2233] sm:text-3xl">{presentation.title}</h1>
                  <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-500" aria-live="polite">{result.message}</p>
                </div>

                <div className="mt-8 grid gap-3 rounded-2xl border border-slate-200 bg-[#fbfcfa] p-4 sm:grid-cols-2 sm:p-5">
                  <Detail label="Montant" value={`${formattedAmount} ${result.currency}`} />
                  <Detail label="Référence Africoin" value={result.reference} mono />
                  <Detail label="Demandé le" value={formattedDate} />
                  <Detail label="Fournisseur" value="Africoin" />
                </div>

                {result.status === "processing" && result.providerStatus !== "SUCCESS_COMPLIANCE_HOLD" && result.providerStatus !== "VERIFICATION_EXCEPTION" && (
                  <p className="mt-5 rounded-xl bg-[#fff9e8] px-4 py-3 text-sm leading-6 text-[#765710]">
                    Ne soumettez pas un second dépôt pour cette transaction. Le résultat se met à jour automatiquement lorsque Africoin le confirme.
                  </p>
                )}
                {result.providerStatus === "SUCCESS_COMPLIANCE_HOLD" && (
                  <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                    Le paiement est confirmé, mais aucun solde n’a été crédité. Contactez le support pour la revue de conformité.
                  </p>
                )}

                <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  {result.canCheckStatus && (
                    <Button
                      variant="outline"
                      disabled={refreshStatus.isPending}
                      onClick={() => refreshStatus.mutate({ reference })}
                      className="border-[#087f78]/30 text-[#0a2233]"
                    >
                      <RefreshCw className={`mr-2 h-4 w-4 ${refreshStatus.isPending ? "animate-spin" : ""}`} />
                      {refreshStatus.isPending ? "Vérification auprès de Africoin…" : "Vérifier auprès de Africoin"}
                    </Button>
                  )}
                  <Button onClick={() => setLocation("/wallets")} className="bg-[#0a2233] text-white hover:bg-[#0d2638]">
                    Voir mon portefeuille
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className={`mt-1 break-all text-sm font-semibold text-[#0a2233] ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}
