import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ArrowRight, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AccessMode = "register" | "login";
type SourceOfFunds = "salary" | "business" | "investments" | "savings" | "inheritance" | "other";
type InvestorExperience = "none" | "beginner" | "intermediate" | "advanced";

const inputClass = "mt-2 border-white/15 bg-white/10 text-white placeholder:text-slate-500";
const selectClass = "mt-2 h-10 w-full rounded-md border border-white/15 bg-[#15283a] px-3 text-sm text-white outline-none focus:border-[#20c9a5]";

export default function AccountAccess({ mode }: { mode: AccessMode }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [activeMode, setActiveMode] = useState(mode);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("RDC");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [occupation, setOccupation] = useState("");
  const [sourceOfFunds, setSourceOfFunds] = useState<SourceOfFunds>("salary");
  const [preferredCurrency, setPreferredCurrency] = useState<"CDF" | "USD">("USD");
  const [investorExperience, setInvestorExperience] = useState<InvestorExperience>("none");
  const [accepted, setAccepted] = useState(false);
  const register = trpc.auth.register.useMutation({
    onSuccess: () => { setActiveMode("login"); setPassword(""); toast.success("Compte créé. Vous pouvez maintenant vous connecter."); },
    onError: error => toast.error(error.message),
  });
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => { await utils.auth.me.invalidate(); navigate("/dashboard"); toast.success("Bienvenue dans votre espace Africoin."); },
    onError: error => toast.error(error.message),
  });

  const submit = () => {
    if (activeMode === "register") {
      if (!accepted) return;
      if (password !== passwordConfirm) { toast.error("Les mots de passe ne correspondent pas."); return; }
      register.mutate({ firstName, lastName, email, password, phone, country, dateOfBirth, address, city, occupation, sourceOfFunds, preferredCurrency, investorExperience, acceptTerms: true });
    } else {
      login.mutate({ email, password });
    }
  };

  const isPending = register.isPending || login.isPending;
  const switchMode = (next: AccessMode) => setActiveMode(next);

  return <div className="min-h-screen bg-[#061526] px-5 py-8 text-white sm:px-8"><div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-10 lg:grid-cols-[.8fr_1.2fr]">
    <div className="hidden lg:block"><Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-300 transition hover:text-white"><ArrowLeft className="h-4 w-4" />Retour à l’accueil</Link><p className="mt-16 text-xs font-semibold uppercase tracking-[0.24em] text-[#20c9a5]">AFRICOIN TRADING GROUP</p><h1 className="mt-5 max-w-xl text-5xl font-semibold leading-tight tracking-[-0.04em]">Un profil plus complet pour un parcours plus sûr.</h1><p className="mt-6 max-w-lg text-base leading-8 text-slate-300">Ces informations nous aident à préparer votre profil investisseur, votre adéquation et les contrôles KYC avant toute opération réelle.</p><div className="mt-10 grid gap-4 text-sm text-slate-300"><Feature icon={<ShieldCheck />} text="Profil rattaché à la gouvernance et à la conformité." /><Feature icon={<LockKeyhole />} text="Mot de passe protégé par un hachage scrypt." /><Feature icon={<ArrowRight />} text="Marchés, watchlist et ordres en attente après inscription." /></div></div>
    <Card className="mx-auto w-full max-w-2xl rounded-[28px] border-white/10 bg-white/[0.07] text-white shadow-2xl backdrop-blur-xl"><CardHeader className="p-7 pb-4 sm:p-9 sm:pb-5"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e6b84d] text-[#061526]"><UserRound className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#20c9a5]">Espace client</p><CardTitle className="mt-1 text-2xl text-white">{activeMode === "register" ? "Créer votre compte" : "Se connecter"}</CardTitle></div></div>{activeMode === "register" && <p className="mt-4 text-sm leading-6 text-slate-400">Informations personnelles et profil investisseur</p>}</CardHeader><CardContent className="space-y-5 p-7 pt-3 sm:p-9 sm:pt-4">
      {activeMode === "register" && <>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Prénom" htmlFor="firstName"><Input id="firstName" value={firstName} onChange={event => setFirstName(event.target.value)} placeholder="Votre prénom" className={inputClass} /></Field><Field label="Nom" htmlFor="lastName"><Input id="lastName" value={lastName} onChange={event => setLastName(event.target.value)} placeholder="Votre nom" className={inputClass} /></Field></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Adresse email" htmlFor="email"><div className="relative mt-2"><Mail className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><Input id="email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="vous@exemple.com" className={`${inputClass} mt-0 pl-9`} /></div></Field><Field label="Téléphone" htmlFor="phone"><Input id="phone" type="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+243 ..." className={inputClass} /></Field></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Pays de résidence" htmlFor="country"><Input id="country" value={country} onChange={event => setCountry(event.target.value)} placeholder="RDC" className={inputClass} /></Field><Field label="Date de naissance" htmlFor="dateOfBirth"><Input id="dateOfBirth" type="date" value={dateOfBirth} onChange={event => setDateOfBirth(event.target.value)} className={inputClass} /></Field></div>
        <div className="grid gap-4 sm:grid-cols-[1.4fr_.8fr]"><Field label="Adresse de résidence" htmlFor="address"><Input id="address" value={address} onChange={event => setAddress(event.target.value)} placeholder="Rue, avenue, numéro" className={inputClass} /></Field><Field label="Ville" htmlFor="city"><Input id="city" value={city} onChange={event => setCity(event.target.value)} placeholder="Goma" className={inputClass} /></Field></div>
        <Field label="Profession ou activité principale" htmlFor="occupation"><Input id="occupation" value={occupation} onChange={event => setOccupation(event.target.value)} placeholder="Entrepreneur, salarié, étudiant…" className={inputClass} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Source principale des fonds" htmlFor="sourceOfFunds"><select id="sourceOfFunds" value={sourceOfFunds} onChange={event => setSourceOfFunds(event.target.value as SourceOfFunds)} className={selectClass}><option value="salary">Salaire</option><option value="business">Activité commerciale</option><option value="investments">Investissements</option><option value="savings">Épargne</option><option value="inheritance">Héritage</option><option value="other">Autre</option></select></Field><Field label="Devise préférée" htmlFor="preferredCurrency"><select id="preferredCurrency" value={preferredCurrency} onChange={event => setPreferredCurrency(event.target.value as "CDF" | "USD")} className={selectClass}><option value="USD">USD — Dollar américain</option><option value="CDF">CDF — Franc congolais</option></select></Field></div>
        <Field label="Expérience d’investissement" htmlFor="investorExperience"><select id="investorExperience" value={investorExperience} onChange={event => setInvestorExperience(event.target.value as InvestorExperience)} className={selectClass}><option value="none">Je débute</option><option value="beginner">Débutant</option><option value="intermediate">Intermédiaire</option><option value="advanced">Avancé</option></select></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Mot de passe" htmlFor="password"><Input id="password" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="8 caractères minimum" className={inputClass} /></Field><Field label="Confirmer le mot de passe" htmlFor="passwordConfirm"><Input id="passwordConfirm" type="password" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} placeholder="Répétez le mot de passe" className={inputClass} /></Field></div>
        <label className="flex items-start gap-3 text-xs leading-5 text-slate-300"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-1 accent-[#e6b84d]" />J’accepte les conditions d’utilisation, les informations sur les risques et le traitement de mes données pour l’ouverture du compte.</label>
      </>}
      {activeMode === "login" && <><Field label="Adresse email" htmlFor="loginEmail"><div className="relative mt-2"><Mail className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><Input id="loginEmail" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="vous@exemple.com" className={`${inputClass} mt-0 pl-9`} /></div></Field><Field label="Mot de passe" htmlFor="loginPassword"><Input id="loginPassword" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Votre mot de passe" className={inputClass} /></Field></>}
      <Button disabled={isPending || (activeMode === "register" && (!accepted || password.length < 8))} onClick={submit} className="h-12 w-full bg-[#e6b84d] font-semibold text-[#061526] hover:bg-[#f3d27a]">{isPending ? "Traitement…" : activeMode === "register" ? "Créer mon compte" : "Accéder à mon espace"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-sm text-slate-400">{activeMode === "register" ? <button onClick={() => switchMode("login")} className="transition hover:text-white">J’ai déjà un compte</button> : <button onClick={() => switchMode("register")} className="transition hover:text-white">Créer un compte</button>}<Link href="/tarifs-risques-conditions" className="transition hover:text-white">Tarifs & risques</Link></div>
      {activeMode === "login" && <p className="rounded-xl border border-[#20c9a5]/20 bg-[#20c9a5]/10 p-3 text-xs leading-5 text-slate-300">Connexion sécurisée par les identifiants Africoin. Les opérations réelles restent soumises à la conformité et aux validations applicables.</p>}
    </CardContent></Card>
  </div></div>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) { return <div><Label htmlFor={htmlFor} className="text-slate-200">{label}</Label>{children}</div>; }
function Feature({ icon, text }: { icon: React.ReactNode; text: string }) { return <div className="flex items-center gap-3"><span className="text-[#e6b84d]">{icon}</span><span>{text}</span></div>; }
