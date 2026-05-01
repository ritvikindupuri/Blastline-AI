import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { LayoutDashboard, Plug, Activity, FileSearch, LogOut, Network, Radar, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/trace-logo.png";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [officialTime, setOfficialTime] = useState(() => new Date());

  useEffect(() => {
    const tick = window.setInterval(() => setOfficialTime(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const items = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/audits", label: "Audits", icon: Activity },
    { to: "/findings", label: "Findings", icon: FileSearch },
    { to: "/attack-paths", label: "Attack Paths", icon: Network },
    { to: "/blast-radius", label: "Blast-Radius Sim", icon: Radar },
    { to: "/effective-permissions", label: "Effective Perms", icon: KeyRound },
    { to: "/connections", label: "AWS Accounts", icon: Plug },
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r border-border bg-sidebar/80 backdrop-blur-xl flex flex-col">
        <Link to="/dashboard" className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
          <img src={logo} alt="Trace" className="h-10 w-10 md:h-11 md:w-11 lg:h-12 lg:w-12" />
          <div className="font-display font-semibold tracking-tight text-foreground text-xl md:text-2xl">
            Trace<span className="text-primary">.</span>
          </div>
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-foreground border-l-2 border-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                }`
              }
            >
              <it.icon className="h-4 w-4" />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <div className="px-2 text-xs text-muted-foreground font-mono truncate">{user?.email}</div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={async () => { await signOut(); navigate("/"); }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="h-16 border-b border-border flex items-center justify-between px-6 bg-background/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-success pulse-ring" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Official UTC</span>
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            {officialTime.toUTCString()}
          </div>
        </div>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}