import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Radar, KeyRound, GitBranch, ShieldCheck, GitPullRequest } from "lucide-react";
import { motion } from "framer-motion";
import logo from "@/assets/blastline-logo.png";

const pillars = [
  { num: "01", icon: GitPullRequest, name: "Plan Review",                role: "Pre-merge",        desc: "Paste a terraform plan. Get ship/warn/block per change." },
  { num: "02", icon: Radar,          name: "Blast-Radius Simulator",     role: "Pre-execution",    desc: "See what breaks before you change a resource." },
  { num: "03", icon: KeyRound,       name: "Effective Permissions",      role: "IAM reachability", desc: "Walk role chains, SCPs and boundaries end-to-end." },
  { num: "04", icon: GitBranch,      name: "Attack Graph",               role: "Chained risk",     desc: "Misconfigs linked into real escalation paths." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/85 backdrop-blur-md border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img
              src={logo}
              alt="Blastline"
              className="h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 lg:h-[72px] lg:w-[72px] transition-all"
            />
            <span className="font-display font-semibold tracking-tight text-2xl sm:text-3xl md:text-4xl">
              Blastline<span className="text-primary">.</span>
            </span>
          </Link>
          <div className="flex items-center gap-1.5">
            <Link to="/auth?mode=signin">
              <Button variant="ghost" size="sm" className="text-foreground/80 hover:text-foreground hover:bg-secondary">
                Sign in
              </Button>
            </Link>
            <Link to="/auth?mode=signup">
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium">
                Sign up
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative max-w-6xl mx-auto px-6 lg:px-10 pt-28 md:pt-32 pb-28 overflow-hidden">
        {/* Decorative concentric rings echoing the logo */}
        <div className="pointer-events-none absolute -right-32 top-10 hidden lg:block">
          <svg width="520" height="520" viewBox="0 0 520 520" fill="none" className="opacity-[0.18]">
            <circle cx="260" cy="260" r="60" stroke="hsl(var(--primary))" strokeWidth="2" />
            <circle cx="260" cy="260" r="130" stroke="hsl(var(--primary))" strokeWidth="1.25" />
            <circle cx="260" cy="260" r="210" stroke="hsl(var(--primary))" strokeWidth="0.75" />
            <line x1="0" y1="260" x2="520" y2="260" stroke="hsl(var(--primary))" strokeWidth="1" />
            <circle cx="260" cy="260" r="6" fill="hsl(var(--primary))" />
          </svg>
        </div>

        <motion.div className="max-w-3xl relative" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: "easeOut" }}>
          <div className="text-xs font-mono text-primary uppercase tracking-[0.24em] mb-6">Pre-merge reasoning · AWS</div>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-semibold leading-[1.04] tracking-tight">
            Know what your IAM change breaks<br />
            <span className="text-primary">before</span> the PR merges.
          </h1>
          <p className="mt-7 text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed">
            Paste a <span className="font-mono text-foreground">terraform plan</span>. Get a per-resource ship / warn / block verdict, grounded in your live AWS audit. For AWS security engineers.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link to="/auth?mode=signup">
              <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium gap-2 h-12 px-7">
                Get started <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#capabilities">
              <Button size="lg" variant="outline" className="border-border bg-transparent hover:bg-secondary text-foreground h-12 px-7">
                See capabilities
              </Button>
            </a>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {["Read-only", "No exploits", "CIS · NIST · SOC2 · PCI"].map((t) => (
              <div key={t} className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> {t}</div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Divider */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="border-t border-border/60" />
      </div>

      {/* Capabilities */}
      <section id="capabilities" className="max-w-6xl mx-auto px-6 lg:px-10 py-24">
        <div className="flex items-end justify-between mb-12 gap-6 flex-wrap">
          <div>
            <div className="text-xs font-mono text-primary uppercase tracking-[0.24em] mb-3">Capabilities</div>
            <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight leading-tight">Four tools. One question.</h2>
          </div>
          <p className="text-sm text-muted-foreground max-w-md font-mono">
            What breaks, who can reach it, where it chains, what it violates.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-px bg-border/60 border border-border/60 rounded-lg overflow-hidden">
          {pillars.map((a, i) => (
            <motion.div
              key={a.name}
              className="group bg-background hover:bg-card transition-colors p-6 min-h-[180px] flex flex-col"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.05, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between mb-5">
                <span className="font-mono text-[11px] text-primary tracking-wider">{a.num}</span>
                <a.icon className="h-4 w-4 text-primary/60 group-hover:text-primary transition-colors" />
              </div>
              <div className="font-display font-semibold text-lg tracking-tight leading-tight">{a.name}</div>
              <div className="mt-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{a.role}</div>
              <p className="mt-auto pt-4 text-sm text-muted-foreground leading-snug">{a.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Why */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="border-t border-border/60" />
      </div>
      <section className="max-w-5xl mx-auto px-6 lg:px-10 py-24">
        <div className="text-xs font-mono text-primary uppercase tracking-[0.24em] mb-3">Questions before prod</div>
        <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight leading-tight max-w-2xl">
          Built around the four questions engineers actually ask.
        </h2>
        <div className="mt-12 grid md:grid-cols-2 gap-x-10 gap-y-8">
          {[
            { q: "What breaks if I fix this?", a: "Blast-radius simulator lists every downstream principal, service and pipeline." },
            { q: "What can this role really do?", a: "Walks transitive role chains, SCPs and boundaries with grounded evidence." },
            { q: "Which findings actually matter?", a: "Attack graph promotes findings that chain into a reachable path." },
            { q: "Did the fix actually land?", a: "Every remediation API call recorded with timestamps and console deep-link." },
          ].map((row, i) => (
            <motion.div
              key={i}
              className="border-l-2 border-primary/50 pl-5"
              initial={{ opacity: 0, x: 6 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.35, delay: i * 0.06 }}
            >
              <div className="font-display text-base font-semibold tracking-tight">{row.q}</div>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{row.a}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Blastline" className="h-9 w-9 sm:h-10 sm:w-10 md:h-11 md:w-11" />
            <span className="font-display font-semibold text-lg sm:text-xl">Blastline<span className="text-primary">.</span></span>
          </div>
          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Blastline
          </div>
        </div>
      </footer>
    </div>
  );
}