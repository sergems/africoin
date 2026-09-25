import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import { BellRing, Bookmark, CandlestickChart, FileText, Gavel, History, LayoutDashboard, LogOut, Settings2, ShieldCheck, UserRound, UsersRound, WalletCards } from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { resolveDashboardAccessSurface } from "@shared/routeAccess";
import { roleLabel, roleScope } from "@shared/permissions";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const menuItems = [
  { icon: LayoutDashboard, label: "Vue d’ensemble", path: "/dashboard" },
  { icon: CandlestickChart, label: "Marchés", path: "/market" },
  { icon: Bookmark, label: "Watchlist", path: "/watchlist" },
  { icon: WalletCards, label: "Portefeuille", path: "/wallets" },
  { icon: History, label: "Activité", path: "/activity" },
  { icon: FileText, label: "Documents", path: "/documents" },
  { icon: UserRound, label: "Profil", path: "/settings" },
  { icon: ShieldCheck, label: "Conformité", path: "/compliance", restricted: true },
  { icon: ShieldCheck, label: "Administration", path: "/admin", adminOnly: true },
  { icon: UsersRound, label: "Utilisateurs", path: "/admin/users", adminOnly: true },
  { icon: Settings2, label: "Instruments & taux", path: "/admin/markets", adminOnly: true },
  { icon: Gavel, label: "Permissions & approbations", path: "/admin/permissions", governance: true },
];

const SIDEBAR_WIDTH_KEY = "africoin-sidebar-width";
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 210;
const MAX_WIDTH = 420;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  const accessSurface = resolveDashboardAccessSurface(loading, user);
  useEffect(() => localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)), [sidebarWidth]);

  if (accessSurface === "loading") return <DashboardLayoutSkeleton />;
  if (accessSurface === "login") {
    return (
      <div className="min-h-screen grid place-items-center bg-[#061526] px-6 text-white">
        <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.06] p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto mb-5 h-32 w-32 overflow-hidden rounded-[28px] border border-[#d9aa3f]/40 bg-[#061526] shadow-[0_0_50px_rgba(217,170,63,.22)]"><img src="/assets/branding/logoafricoin.jpeg" alt="AFRICOIN TRADING GROUP" className="h-full w-full object-cover" /></div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#20c9a5]">AFRICOIN TRADING GROUP</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Votre espace financier sécurisé</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">Connectez-vous pour accéder à votre portefeuille, aux marchés et aux contrôles de conformité.</p>
          <Link href="/connexion" className="mt-7 block rounded-lg bg-[#e6b84d] px-4 py-3 text-center text-sm font-semibold text-[#08131f] transition hover:bg-[#f3d27a]">Se connecter avec email</Link>
          <Link href="/inscription" className="mt-4 block text-sm text-[#86efd7] transition hover:text-white">Créer un compte avec email</Link>
        </div>
      </div>
    );
  }

  return <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}><DashboardLayoutContent setSidebarWidth={setSidebarWidth}>{children}</DashboardLayoutContent></SidebarProvider>;
}

function DashboardLayoutContent({ children, setSidebarWidth }: { children: React.ReactNode; setSidebarWidth: (width: number) => void }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, setOpenMobile, toggleSidebar } = useSidebar();
  const [isResizing, setIsResizing] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const notificationQuery = trpc.notifications.list.useQuery(undefined, { refetchInterval: 4000, refetchIntervalInBackground: true, staleTime: 0 });
  const utils = trpc.useUtils();
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: () => void utils.notifications.list.invalidate() });
  const markAllRead = trpc.notifications.markAllRead.useMutation({ onSuccess: () => void utils.notifications.list.invalidate() });
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); void notificationQuery.refetch(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, [notificationQuery.refetch]);
  const isMobile = useIsMobile();
  const visibleItems = useMemo(() => menuItems.filter(item => (!item.restricted || user?.role === "admin" || user?.role === "super_admin" || user?.role === "compliance") && (!item.adminOnly || user?.role === "admin" || user?.role === "super_admin") && (!item.governance || user?.role === "admin" || user?.role === "super_admin" || user?.role === "compliance")), [user?.role]);
  const activeMenuItem = visibleItems.find(item => location === item.path);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!isResizing) return;
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const width = event.clientX - left;
      if (width >= MIN_WIDTH && width <= MAX_WIDTH) setSidebarWidth(width);
    };
    const up = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return <>
    <div ref={sidebarRef} className="relative">
      <Sidebar collapsible="icon" className="border-r border-white/10 bg-[#091724]" disableTransition={isResizing}>
        <SidebarHeader className="h-20 justify-center border-b border-white/10">
          <div className="flex w-full items-center gap-3 px-2">
            <button onClick={toggleSidebar} aria-label="Ouvrir ou réduire le menu" className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#d9aa3f]/50 bg-[#061526] transition hover:border-[#20c9a5] focus-visible:ring-2 focus-visible:ring-[#20c9a5]"><img src="/assets/branding/logoafricoin.jpeg" alt="" className="h-full w-full object-cover" /></button>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-semibold tracking-tight text-white">AFRICOIN <span className="text-[#e6b84d]">TRADING GROUP</span></p><p className="truncate text-[10px] uppercase tracking-[0.14em] text-[#20c9a5]">Les marchés numériques d’Afrique · ATG</p></div>
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-0 px-2 py-4"><p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 group-data-[collapsible=icon]:hidden">Espace sécurisé</p><SidebarMenu>{visibleItems.map(item => <SidebarMenuItem key={item.path}><SidebarMenuButton isActive={location === item.path} onClick={() => { setLocation(item.path); if (isMobile) setOpenMobile(false); }} tooltip={item.label} className="h-11 rounded-xl font-normal text-slate-300 transition-[background-color,transform,color] duration-150 active:scale-[0.98] active:bg-white/[0.12] hover:bg-white/[0.06] hover:text-white data-[active=true]:bg-[#e6b84d]/10 data-[active=true]:text-[#f3d27a] data-[active=true]:active:bg-[#e6b84d]/20"><item.icon className="h-4 w-4" /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent>
        <SidebarFooter className="border-t border-white/10 p-3"><DropdownMenu><DropdownMenuTrigger asChild><button className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[#e6b84d]"><Avatar className="h-9 w-9 border border-[#e6b84d]/30 bg-[#e6b84d]/10"><AvatarFallback className="bg-transparent text-xs font-semibold text-[#e6b84d]">{user?.name?.charAt(0).toUpperCase() || "A"}</AvatarFallback></Avatar><div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium text-white">{user?.name || "Compte client"}</p><p className="mt-1 truncate text-xs text-slate-300">{user?.email || "Session sécurisée"}</p>{user && user.role !== "user" && <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[#20c9a5]">{roleLabel(user.role)} · {roleScope(user.role)}</p>}</div></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64 border-white/10 bg-[#0b1f2a] p-1 text-white shadow-2xl"><div className="border-b border-white/10 px-3 py-2"><p className="truncate text-sm font-semibold text-white">{user?.name || "Compte client"}</p><p className="truncate text-xs text-slate-300">{user?.email || "Session sécurisée"}</p></div><DropdownMenuItem onClick={logout} className="mt-1 cursor-pointer text-rose-200 focus:bg-rose-500/15 focus:text-rose-100"><LogOut className="mr-2 h-4 w-4" />Se déconnecter</DropdownMenuItem></DropdownMenuContent></DropdownMenu></SidebarFooter>
      </Sidebar>
      <div onMouseDown={() => setIsResizing(true)} className={`absolute right-0 top-0 z-50 h-full w-1 cursor-col-resize transition hover:bg-[#e6b84d]/30 ${state === "collapsed" ? "hidden" : ""}`} />
    </div>
    <SidebarInset className="relative bg-[#f5f7f5]">{isMobile ? <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-3 backdrop-blur"><SidebarTrigger className="h-9 w-9 shrink-0 rounded-lg" /><span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{activeMenuItem?.label || "AFRICOIN TRADING GROUP"}</span><NotificationCenter data={notificationQuery.data} isError={notificationQuery.isError} isFetching={notificationQuery.isFetching} isOnline={isOnline} onRetry={() => void notificationQuery.refetch()} onRead={id => markRead.mutate({ id })} onReadAll={() => markAllRead.mutate()} /></div> : <div className="absolute right-6 top-4 z-40"><NotificationCenter data={notificationQuery.data} isError={notificationQuery.isError} isFetching={notificationQuery.isFetching} isOnline={isOnline} onRetry={() => void notificationQuery.refetch()} onRead={id => markRead.mutate({ id })} onReadAll={() => markAllRead.mutate()} /></div>}<main className="min-h-screen flex-1">{children}</main></SidebarInset>
  </>;
}


type NotificationItem = { id: number; type: string; title: string; message: string; readAt: Date | null; createdAt: Date };
type NotificationData = { items: NotificationItem[]; unreadCount: number; serverTime: Date };


function NotificationCenter({ data, isError, isFetching, isOnline, onRetry, onRead, onReadAll }: { data?: NotificationData; isError: boolean; isFetching: boolean; isOnline: boolean; onRetry: () => void; onRead: (id: number) => void; onReadAll: () => void }) {
  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label={`${unreadCount} notification(s) non lue(s)`} className="relative h-9 w-9 rounded-xl text-slate-600 hover:bg-[#e8f5f0] hover:text-[#008f76]"><BellRing className="h-4 w-4" />{unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#e6b84d] px-1 text-[10px] font-bold text-[#0b1f2a]">{unreadCount > 9 ? "9+" : unreadCount}</span>}</Button></PopoverTrigger><PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] rounded-2xl border-slate-200 p-0 shadow-xl"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><p className="text-sm font-semibold text-[#0b1f2a]">Notifications</p><p className="mt-0.5 text-xs text-slate-500">Mises à jour de vos demandes et contrôles</p></div>{unreadCount > 0 && <button onClick={onReadAll} className="text-xs font-medium text-[#008f76] hover:underline">Tout marquer comme lu</button>}</div><div className={`flex items-center gap-2 border-b px-4 py-2 text-[11px] ${!isOnline || isError ? "border-rose-100 bg-rose-50 text-rose-700" : "border-slate-100 bg-slate-50 text-slate-500"}`}><span className={`h-2 w-2 rounded-full ${isError ? "bg-rose-500" : "bg-[#20c9a5]"}`} />{!isOnline ? <><span className="flex-1">Connexion hors ligne</span><button onClick={onRetry} className="font-semibold underline">Réessayer</button></> : isError ? <><span className="flex-1">Actualisation indisponible</span><button onClick={onRetry} className="font-semibold underline">Réessayer</button></> : <span>{isFetching ? "Actualisation en cours…" : "Actualisation automatique · connexion sécurisée"}</span>}</div><div className="max-h-[360px] overflow-y-auto">{items.length ? items.map(item => <button key={item.id} onClick={() => !item.readAt && onRead(item.id)} className={`w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-[#f7fbef] ${item.readAt ? "bg-white" : "bg-[#f4fae8]"}`}><div className="flex items-start gap-3"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-slate-300" : "bg-[#e6b84d]"}`} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-semibold text-[#0b1f2a]">{item.title}</p><span className="shrink-0 text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></div><p className="mt-1 text-xs leading-5 text-slate-600">{item.message}</p><p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{item.readAt ? "Lue" : "Non lue"}</p></div></div></button>) : <div className="px-4 py-10 text-center text-sm text-slate-500"><BellRing className="mx-auto mb-2 h-5 w-5 text-slate-300" />{!isOnline ? "Reconnectez-vous pour actualiser les notifications." : isError ? "Impossible de charger les notifications." : "Aucune notification récente."}</div>}</div></PopoverContent></Popover>;
}
