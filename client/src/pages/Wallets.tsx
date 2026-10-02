import { useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDownLeft, ArrowUpRight, Banknote, Clock3, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type Currency = "USD" | "CDF";

export default function Wallets() {
  const [, setLocation] = useLocation();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [amount, setAmount] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalCurrency, setWithdrawalCurrency] = useState<Currency>("USD");
  const [destinationType, setDestinationType] = useState<"bank_account" | "mobile_money" | "partner">("mobile_money");
  const [withdrawalIdempotencyKey, setWithdrawalIdempotencyKey] = useState(() => crypto.randomUUID());
  const [checkingReference, setCheckingReference] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const { data: wallets = [] } = trpc.wallets.balances.useQuery();
  const { data: requests } = trpc.portfolio.requests.useQuery();

  const refreshWalletData = async () => {
    await Promise.all([utils.portfolio.requests.invalidate(), utils.wallets.balances.invalidate()]);
  };

  const deposit = trpc.wallets.requestDeposit.useMutation({
    onSuccess: async result => {
      setDepositOpen(false);
      setAmount("");
      setMobileNumber("");
      setIdempotencyKey(crypto.randomUUID());
      await refreshWalletData();
      setLocation(`/payment/success?reference=${encodeURIComponent(result.reference)}`);
    },
    onError: error => toast.error(error.message),
  });

  const withdrawal = trpc.wallets.requestWithdrawal.useMutation({
    onSuccess: async result => {
      setWithdrawalOpen(false);
      setWithdrawalAmount("");
      setWithdrawalIdempotencyKey(crypto.randomUUID());
      await refreshWalletData();
      toast.success(`${result.reference} · demande envoyée à l’approbation. Aucun fonds n’a été réservé ou transféré.`);
    },
    onError: error => toast.error(error.message),
  });

  const refreshStatus = trpc.wallets.refreshKelpayStatus.useMutation({
    onSuccess: async result => {
      setCheckingReference(null);
      toast.message(result.message);
      await refreshWalletData();
    },
    onError: error => {
      setCheckingReference(null);
      toast.error(error.message);
    },
  });

  const walletFor = (code: Currency) => wallets.find(wallet => wallet.currency === code) ?? {
    availableBalance: "0.00",
    pendingBalance: "0.00",
    currency: code,
  };
  const normalizedPhone = mobileNumber.trim().replace(/^\+/, "");
  const validPhone = /^243\d{9}$/.test(normalizedPhone);
  const parsedAmount = Number(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= 1_000_000 && Number(parsedAmount.toFixed(2)) === parsedAmount;
  const parsedWithdrawalAmount = Number(withdrawalAmount);
  const withdrawalAvailable = Number(walletFor(withdrawalCurrency).availableBalance);
  const validWithdrawalAmount = Number.isFinite(parsedWithdrawalAmount) && parsedWithdrawalAmount > 0 && parsedWithdrawalAmount <= 1_000_000 && Number(parsedWithdrawalAmount.toFixed(2)) === parsedWithdrawalAmount && parsedWithdrawalAmount <= withdrawalAvailable;

  const startDeposit = () => {
    deposit.mutate({
      amount: parsedAmount,
      currency,
      mobileNumber: normalizedPhone,
      idempotencyKey,
    });
  };

  const startWithdrawal = () => {
    withdrawal.mutate({ amount: parsedWithdrawalAmount, currency: withdrawalCurrency, destinationType, idempotencyKey: withdrawalIdempotencyKey });
  };

  return (
    <div className="min-h-screen bg-[#f7f7f2] px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#087f78]">Portefeuille</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#0a2233]">Vos liquidités, séparées par devise</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Les dépôts CDF et USD sont traités par Keccel KelPay sur Orange Money, M-PESA, Airtel Money et AfriMoney.
              Le portefeuille est crédité uniquement après confirmation de la transaction par Keccel.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            <LockKeyhole className="h-4 w-4 text-[#087f78]" /> Fonds logiquement ségrégués
          </div>
        </header>

        <div className="mt-7 grid gap-4 md:grid-cols-2">
          <WalletCard currency="USD" balance={walletFor("USD")} onDeposit={() => { setCurrency("USD"); setDepositOpen(true); }} onWithdraw={() => { setWithdrawalCurrency("USD"); setWithdrawalOpen(true); }} />
          <WalletCard currency="CDF" balance={walletFor("CDF")} onDeposit={() => { setCurrency("CDF"); setDepositOpen(true); }} onWithdraw={() => { setWithdrawalCurrency("CDF"); setWithdrawalOpen(true); }} />
        </div>

        <div className="mt-7 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <Card className="rounded-2xl border-slate-200 bg-white">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Traçabilité</p>
                  <CardTitle className="mt-2 text-xl text-[#0a2233]">Demandes récentes</CardTitle>
                </div>
                <Banknote className="h-5 w-5 text-[#087f78]" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <RequestList
                title="Dépôts"
                rows={requests?.deposits ?? []}
                icon={<ArrowDownLeft className="h-4 w-4" />}
                onCheck={reference => {
                  setCheckingReference(reference);
                  refreshStatus.mutate({ reference });
                }}
                checkingReference={checkingReference}
              />
              <RequestList title="Retraits" rows={requests?.withdrawals ?? []} icon={<ArrowUpRight className="h-4 w-4" />} />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-0 bg-[#0a2233] text-white">
            <CardHeader><CardTitle className="text-xl font-medium">Avant tout mouvement</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-slate-300">
              <div className="flex gap-3"><ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-[#e6b93f]" /><p>Votre identité et votre profil de risque doivent être validés avant l’accès aux mouvements financiers.</p></div>
              <div className="flex gap-3"><Clock3 className="mt-1 h-4 w-4 shrink-0 text-[#e6b93f]" /><p>Les dépôts Keccel sont vérifiés côté serveur. Les retraits restent soumis à une décision administrative auditable.</p></div>
              <div className="rounded-2xl border border-[#e6b93f]/20 bg-[#e6b93f]/10 p-4 text-xs text-[#f7e0a4]">
                Vous pouvez soumettre une demande de retrait pour approbation par un Admin ou Super Admin. L’approbation ne réserve ni ne débite de fonds et n’envoie aucun transfert; le payout Keccel reste désactivé.
              </div>
            </CardContent>
          </Card>
        </div>

        <Dialog open={depositOpen} onOpenChange={open => !open && setDepositOpen(false)}>
          <DialogContent className="rounded-2xl border-[#dce4e5] bg-[#f7f7f2] text-[#0a2233] shadow-[0_24px_80px_rgba(7,26,42,.28)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-[#0a2233]">Déposer avec Keccel KelPay</DialogTitle>
              <DialogDescription>
                Vous recevrez une demande de validation sur votre téléphone. Aucun solde n’est crédité avant confirmation par Keccel.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              {(["USD", "CDF"] as const).map(code => (
                <Button key={code} onClick={() => setCurrency(code)} className={currency === code ? "bg-[#0a2233] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}>{code}</Button>
              ))}
            </div>
            <div>
              <label htmlFor="deposit-amount" className="text-xs font-medium text-slate-600">Montant</label>
              <Input id="deposit-amount" type="number" min="0.01" max="1000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" className="mt-2" />
            </div>
            <div>
              <label htmlFor="deposit-mobile" className="text-xs font-medium text-slate-600">Numéro Mobile Money (RDC)</label>
              <Input id="deposit-mobile" type="tel" inputMode="tel" autoComplete="tel" value={mobileNumber} onChange={event => setMobileNumber(event.target.value)} placeholder="+243XXXXXXXXX" className="mt-2" />
              <p className="mt-1 text-xs text-slate-500">Keccel KelPay prend en charge Orange Money, M-PESA, Airtel Money et AfriMoney.</p>
            </div>
            <DialogFooter>
              <Button disabled={!validAmount || !validPhone || deposit.isPending} onClick={startDeposit} className="w-full bg-[#0a2233] text-white hover:bg-[#0d2638]">
                {deposit.isPending ? "Envoi à Keccel…" : "Envoyer la demande de paiement"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={withdrawalOpen} onOpenChange={open => !open && setWithdrawalOpen(false)}>
          <DialogContent className="rounded-2xl border-[#dce4e5] bg-[#f7f7f2] text-[#0a2233] shadow-[0_24px_80px_rgba(7,26,42,.28)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-[#0a2233]">Demander un retrait</DialogTitle>
              <DialogDescription>
                Un Admin ou Super Admin doit approuver la demande. Les transferts Keccel sont désactivés : aucun fonds ne sera réservé, débité ou envoyé par cette demande.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              {(["USD", "CDF"] as const).map(code => (
                <Button key={code} onClick={() => setWithdrawalCurrency(code)} className={withdrawalCurrency === code ? "bg-[#0a2233] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}>{code}</Button>
              ))}
            </div>
            <div>
              <label htmlFor="withdrawal-amount" className="text-xs font-medium text-slate-600">Montant · disponible {withdrawalAvailable.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {withdrawalCurrency}</label>
              <Input id="withdrawal-amount" type="number" min="0.01" max="1000000" step="0.01" value={withdrawalAmount} onChange={event => setWithdrawalAmount(event.target.value)} placeholder="0.00" className="mt-2" />
            </div>
            <div>
              <label htmlFor="withdrawal-destination" className="text-xs font-medium text-slate-600">Type de destination</label>
              <select id="withdrawal-destination" value={destinationType} onChange={event => setDestinationType(event.target.value as typeof destinationType)} className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#0a2233]">
                <option value="mobile_money">Mobile Money</option>
                <option value="bank_account">Compte bancaire</option>
                <option value="partner">Partenaire</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">Les coordonnées de paiement ne sont pas collectées tant que le payout Keccel n’est pas activé.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWithdrawalOpen(false)} className="border-slate-200">Annuler</Button>
              <Button disabled={!validWithdrawalAmount || withdrawal.isPending} onClick={startWithdrawal} className="bg-[#0a2233] text-white hover:bg-[#0d2638]">
                {withdrawal.isPending ? "Enregistrement…" : "Soumettre pour approbation"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function WalletCard({ currency, balance, onDeposit, onWithdraw }: { currency: Currency; balance: { availableBalance: string; pendingBalance: string }; onDeposit: () => void; onWithdraw: () => void }) {
  return (
    <Card className={`rounded-2xl border-0 shadow-sm ${currency === "USD" ? "bg-[#0a2233] text-white" : "border-[#b9ded4] bg-[#e9f6f2] text-[#0a2233]"}`}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${currency === "USD" ? "text-[#e6b93f]" : "text-[#087f78]"}`}>Portefeuille {currency}</p>
            <p className="mt-4 text-4xl font-semibold tracking-tight">{Number(balance.availableBalance).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-lg font-medium opacity-60">{currency}</span></p>
            <p className={`mt-2 text-xs ${currency === "USD" ? "text-slate-400" : "text-slate-500"}`}>Disponible · {Number(balance.pendingBalance).toFixed(2)} en attente</p>
          </div>
          <div className={`grid h-11 w-11 place-items-center rounded-2xl ${currency === "USD" ? "bg-white/10 text-[#e6b93f]" : "bg-white/70 text-[#087f78]"}`}><WalletCards className="h-5 w-5" /></div>
        </div>
        <div className="mt-7 flex flex-wrap gap-2">
          <Button onClick={onDeposit} className={currency === "USD" ? "bg-[#e6b93f] text-[#0a2233] hover:bg-[#f7e0a4]" : "bg-[#0a2233] text-white hover:bg-[#0d2638]"}>
            <ArrowDownLeft className="mr-2 h-4 w-4" /> Déposer
          </Button>
          <Button onClick={onWithdraw} variant="outline" className={currency === "USD" ? "border-white/30 bg-transparent text-white hover:bg-white/10" : "border-[#087f78]/30 bg-transparent text-[#087f78] hover:bg-white/60"}>
            <ArrowUpRight className="mr-2 h-4 w-4" /> Demander un retrait
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RequestList({ title, rows, icon, onCheck, checkingReference }: {
  title: string;
  rows: any[];
  icon: ReactNode;
  onCheck?: (reference: string) => void;
  checkingReference?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#0a2233]">{icon}{title}</div>
      {rows.length ? rows.slice(0, 4).map(row => {
        const isChecking = checkingReference === row.reference;
        const canCheck = row.paymentProvider === "KECCEL" && ["processing", "pending_review"].includes(row.status) && !["VERIFICATION_EXCEPTION", "SUCCESS_COMPLIANCE_HOLD"].includes(row.providerStatus) && Boolean(row.providerReference || row.candidateTransactionId) && Number(row.providerCheckCount ?? 0) < 3;
        return (
          <div key={row.id} className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-slate-100 pt-3 text-xs">
            <span className="min-w-0 flex-1 truncate text-slate-500">{row.reference}</span>
            <Badge variant="outline">{statusLabel(row.status, Boolean(row.destinationType))}</Badge>
            <span className="shrink-0 font-medium text-[#0a2233]">{row.amount} {row.currency}</span>
            {canCheck && onCheck && <Button size="sm" variant="outline" disabled={isChecking} onClick={() => onCheck(row.reference)}>{isChecking ? "Vérification…" : "Vérifier"}</Button>}
            {row.paymentProvider === "KECCEL" && row.providerStatus === "VERIFICATION_EXCEPTION" && <span className="w-full text-amber-700">Réconciliation manuelle requise ; aucun crédit effectué.</span>}
            {row.paymentProvider === "KECCEL" && row.providerStatus === "SUCCESS_COMPLIANCE_HOLD" && <span className="w-full text-amber-700">Paiement confirmé, mais fonds retenus pour revue conformité ; contactez le support.</span>}
            {row.paymentProvider === "KECCEL" && row.providerStatus === "SUBMISSION_UNKNOWN" && !row.providerReference && !row.candidateTransactionId && <span className="w-full text-amber-700">Résultat Keccel incertain. Ne lancez pas un nouveau dépôt ; contactez le support avec cette référence.</span>}
            {row.paymentProvider === "KECCEL" && ["processing", "pending_review"].includes(row.status) && Number(row.providerCheckCount ?? 0) >= 3 && <span className="w-full text-amber-700">Maximum de vérifications Keccel atteint ; contactez le support pour réconciliation. Aucun crédit n’a été effectué sans confirmation.</span>}
            {row.destinationType && row.status === "pending_review" && <span className="w-full text-amber-700">En attente d’approbation Admin/Super Admin. Aucun fonds n’a été réservé ni transféré.</span>}
            {row.destinationType && row.status === "approved_pending_payout" && <span className="w-full text-amber-700">Approuvé administrativement; aucun transfert envoyé et aucun solde modifié. Payout Keccel désactivé.</span>}
          </div>
        );
      }) : <p className="mt-3 text-xs text-slate-400">Aucune demande enregistrée.</p>}
    </div>
  );
}

function statusLabel(status: string, isWithdrawal = false) {
  if (isWithdrawal && status === "approved_pending_payout") return "Approuvé · payout désactivé";
  if (isWithdrawal && ["requested", "pending_review"].includes(status)) return "À approuver";
  switch (status) {
    case "completed": return "Confirmé";
    case "failed": return isWithdrawal ? "Échec de la demande" : "Échoué";
    case "rejected": return isWithdrawal ? "Refusé par l’administration" : "Refusé";
    case "processing": return "En cours";
    case "pending_review": return "À vérifier";
    case "requested": return "Soumis";
    default: return status;
  }
}
