import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import Landing from "./pages/Landing.tsx";
import Auth from "./pages/Auth.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Connections from "./pages/Connections.tsx";
import NewAudit from "./pages/NewAudit.tsx";
import Audits from "./pages/Audits.tsx";
import AuditDetail from "./pages/AuditDetail.tsx";
import Findings from "./pages/Findings.tsx";
import AttackPaths from "./pages/AttackPaths.tsx";
import AttackPathDetail from "./pages/AttackPathDetail.tsx";
import BlastRadius from "./pages/BlastRadius.tsx";
import EffectivePermissions from "./pages/EffectivePermissions.tsx";
import PlanReview from "./pages/PlanReview.tsx";
import PrincipalReplay from "./pages/PrincipalReplay.tsx";
import Drift from "./pages/Drift.tsx";
import PRBot from "./pages/PRBot.tsx";
import { AuthProvider } from "./lib/auth";
import { RequireAuth } from "./components/layout/RequireAuth";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/connections" element={<RequireAuth><Connections /></RequireAuth>} />
            <Route path="/audits" element={<RequireAuth><Audits /></RequireAuth>} />
            <Route path="/audits/new" element={<RequireAuth><NewAudit /></RequireAuth>} />
            <Route path="/audits/:id" element={<RequireAuth><AuditDetail /></RequireAuth>} />
            <Route path="/findings" element={<RequireAuth><Findings /></RequireAuth>} />
            <Route path="/attack-paths" element={<RequireAuth><AttackPaths /></RequireAuth>} />
            <Route path="/attack-paths/:id" element={<RequireAuth><AttackPathDetail /></RequireAuth>} />
            <Route path="/blast-radius" element={<RequireAuth><BlastRadius /></RequireAuth>} />
            <Route path="/effective-permissions" element={<RequireAuth><EffectivePermissions /></RequireAuth>} />
            <Route path="/plan-review" element={<RequireAuth><PlanReview /></RequireAuth>} />
            <Route path="/principal-replay" element={<RequireAuth><PrincipalReplay /></RequireAuth>} />
            <Route path="/drift" element={<RequireAuth><Drift /></RequireAuth>} />
            <Route path="/pr-bot" element={<RequireAuth><PRBot /></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
