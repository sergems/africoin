import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import { DashboardLayoutSkeleton } from "@/components/DashboardLayoutSkeleton";
import NotFound from "@/pages/NotFound";
import Landing from "@/pages/Landing";
import PricingRisksTerms from "@/pages/PricingRisksTerms";
import Home from "@/pages/Home";
import Market from "@/pages/Market";
import ForexTerminal from "@/pages/ForexTerminal";
import Wallets from "@/pages/Wallets";
import Activity from "@/pages/Activity";
import Compliance from "@/pages/Compliance";
import Documents from "@/pages/Documents";
import Settings from "@/pages/Settings";
import Admin from "@/pages/Admin";
import AdminUsers from "@/pages/AdminUsers";
import AdminPermissions from "@/pages/AdminPermissions";
import AdminMarkets from "@/pages/AdminMarkets";
import Watchlist from "@/pages/Watchlist";
import AccountAccess from "@/pages/AccountAccess";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { resolveRouteSurface } from "@shared/routeAccess";

function ProtectedRouter() {
  return <DashboardLayout><Switch><Route path="/dashboard" component={Home} /><Route path="/market" component={Market} /><Route path="/forex" component={ForexTerminal} /><Route path="/wallets" component={Wallets} /><Route path="/activity" component={Activity} /><Route path="/documents" component={Documents} /><Route path="/settings" component={Settings} /><Route path="/admin" component={Admin} /><Route path="/admin/users" component={AdminUsers} /><Route path="/admin/markets" component={AdminMarkets} /><Route path="/admin/permissions" component={AdminPermissions} /><Route path="/watchlist" component={Watchlist} /><Route path="/compliance" component={Compliance} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch></DashboardLayout>;
}

function Router() {
  const [location] = useLocation();
  const { loading } = useAuth();
  const surface = resolveRouteSurface(location, loading);
  if (surface === "reference") return <PricingRisksTerms />;
  if (surface === "auth") return <AccountAccess mode={location === "/inscription" ? "register" : "login"} />;
  if (surface === "landing") return <Landing />;
  if (surface === "loading") return <DashboardLayoutSkeleton />;
  return <ProtectedRouter />;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
