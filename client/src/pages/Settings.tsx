import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, ImagePlus, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";

const MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024;

export default function Settings() {
  const { data: profile, isLoading } = trpc.profile.get.useQuery();
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState("");
  const [preferredCurrency, setPreferredCurrency] = useState<"CDF" | "USD">("USD");
  const [investorExperience, setInvestorExperience] = useState<"none" | "beginner" | "intermediate" | "advanced">("none");
  const [selectedPicture, setSelectedPicture] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const update = trpc.profile.update.useMutation({
    onSuccess: () => { toast.success("Profil enregistré."); void utils.profile.get.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const uploadPicture = trpc.profile.uploadAvatar.useMutation({
    onSuccess: () => {
      toast.success("Photo de profil mise à jour.");
      setSelectedPicture(null);
      if (fileRef.current) fileRef.current.value = "";
      void utils.profile.get.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (profile) {
      setPhone(profile.phone ?? "");
      setPreferredCurrency((profile.preferredCurrency as "CDF" | "USD") ?? "USD");
      setInvestorExperience((profile.investorExperience as typeof investorExperience) ?? "none");
    }
  }, [profile]);

  useEffect(() => {
    if (!selectedPicture) {
      setLocalPreview(null);
      return;
    }
    const url = URL.createObjectURL(selectedPicture);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedPicture]);

  const choosePicture = (file?: File) => {
    if (!file) return;
    if (!(file.type === "image/jpeg" || file.type === "image/png")) {
      toast.error("Format accepté : JPEG ou PNG.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > MAX_PROFILE_PICTURE_BYTES) {
      toast.error("La taille maximale est de 5 Mio.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setSelectedPicture(file);
  };

  const savePicture = async () => {
    if (!selectedPicture) return;
    try {
      const bytes = new Uint8Array(await selectedPicture.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        const chunk = bytes.subarray(offset, offset + 0x8000);
        const chars = new Array<string>(chunk.length);
        for (let index = 0; index < chunk.length; index += 1) chars[index] = String.fromCharCode(chunk[index]);
        binary += chars.join("");
      }
      uploadPicture.mutate({ mimeType: selectedPicture.type as "image/jpeg" | "image/png", base64: btoa(binary) });
    } catch {
      toast.error("Impossible de lire cette image.");
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f7f2] px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1050px]">
        <header className="border-b border-slate-200 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#087f78]">Compte client</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#0a2233]">Profil & paramètres</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Mettez à jour votre photo et vos préférences. Votre image de profil est facultative et ne bloque aucune opération.</p>
        </header>

        <div className="mt-7 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          <div className="space-y-6">
            <Card className="rounded-2xl border-slate-200 bg-white">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#e9f6f2] text-[#087f78]"><ImagePlus className="h-5 w-5" /></span>
                  <div><CardTitle className="text-lg text-[#0a2233]">Photo de profil</CardTitle><p className="mt-1 text-xs text-slate-500">Une image facultative pour personnaliser votre espace Africoin.</p></div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <Avatar className="h-24 w-24 border-2 border-[#b9ded4] bg-[#e9f6f2]">
                  <AvatarImage src={localPreview ?? profile?.avatarUrl ?? undefined} alt="Votre photo de profil" />
                  <AvatarFallback className="bg-[#e9f6f2] text-2xl font-semibold text-[#087f78]">AF</AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-3">
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={event => choosePicture(event.target.files?.[0])} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="border-[#087f78]/30 text-[#087f78] hover:bg-[#e9f6f2]"><ImagePlus className="mr-2 h-4 w-4" />Choisir une image</Button>
                    <Button type="button" disabled={!selectedPicture || uploadPicture.isPending} onClick={savePicture} className="bg-[#0a2233] text-white hover:bg-[#0d2638]">{uploadPicture.isPending ? "Envoi…" : "Enregistrer la photo"}</Button>
                  </div>
                  <p className="text-xs leading-5 text-slate-500">JPEG ou PNG · 5 Mio maximum · stockée dans un espace privé. {selectedPicture ? `Fichier : ${selectedPicture.name}` : "Sélectionnez une image pour l’aperçu."}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 bg-white">
              <CardHeader>
                <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#e9f6f2] text-[#087f78]"><UserRound className="h-5 w-5" /></span><div><CardTitle className="text-lg text-[#0a2233]">Préférences investisseur</CardTitle><p className="mt-1 text-xs text-slate-500">Utilisées pour l’information et le contrôle d’adéquation.</p></div></div>
              </CardHeader>
              <CardContent className="space-y-5">
                {isLoading ? <p className="text-sm text-slate-500">Chargement…</p> : <>
                  <div><Label htmlFor="phone">Téléphone</Label><Input id="phone" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+243 ..." className="mt-2" /></div>
                  <div><Label>Devise d’affichage</Label><Select value={preferredCurrency} onValueChange={value => setPreferredCurrency(value as "CDF" | "USD")}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD — Dollar américain</SelectItem><SelectItem value="CDF">CDF — Franc congolais</SelectItem></SelectContent></Select></div>
                  <div><Label>Expérience d’investissement</Label><Select value={investorExperience} onValueChange={value => setInvestorExperience(value as typeof investorExperience)}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Je débute</SelectItem><SelectItem value="beginner">Débutant</SelectItem><SelectItem value="intermediate">Intermédiaire</SelectItem><SelectItem value="advanced">Avancé</SelectItem></SelectContent></Select></div>
                  <Button disabled={update.isPending} onClick={() => update.mutate({ phone, preferredCurrency, investorExperience })} className="w-full bg-[#0a2233] text-white hover:bg-[#0d2638]">{update.isPending ? "Enregistrement…" : "Enregistrer les changements"}</Button>
                </>}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="rounded-2xl border-slate-200 bg-white">
              <CardHeader><CardTitle className="text-lg text-[#0a2233]">Protection du compte</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <SettingRow icon={<KeyRound />} title="Connexion sécurisée" text="Mot de passe et session protégée." />
                <SettingRow icon={<ShieldCheck />} title="Contrôles KYC/AML-CFT" text="Vous pouvez déposer et trader pendant la revue; les retraits exigent le KYC approuvé et tous les justificatifs acceptés." />
                <SettingRow icon={<CheckCircle2 />} title="Accès aux opérations" text="Les limites de risque et la disponibilité des partenaires continuent de s’appliquer." />
              </CardContent>
            </Card>
            <div className="rounded-2xl border border-[#b9ded4] bg-[#e9f6f2] p-5 text-sm leading-6 text-[#087f78]">Votre profil de risque est actuellement <Badge className="mx-1 bg-white text-[#5f7d24]">{profile?.riskProfile ?? "unassessed"}</Badge>. Il sera déterminé par les contrôles approuvés par la conformité.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="flex gap-3"><span className="mt-0.5 text-[#087f78]">{icon}</span><div><p className="text-sm font-semibold text-[#0a2233]">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{text}</p></div></div>;
}
