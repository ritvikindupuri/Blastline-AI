import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Radar, KeyRound, Network, ShieldCheck, GitBranch, Terminal } from "lucide-react";
import { motion } from "framer-motion";
import logo from "@/assets/blastline-logo.png";

const pillars = [
  {
    num: "01",
    icon: Radar,
    name: "Blast-Radius Simulator",
    role: "Pre-execution",
    desc: "Pick a resource and a proposed change. See every downstream principal, service, and workflow that breaks — ranked by severity, with rollback steps. Read-only. Touches nothing in AWS.",
  },
  {
    num: "02",
    icon: KeyRound,
    name: "Effective-Permissions Explorer",
    role: "IAM reachability",
    desc: "Pick any principal. Walk transitive role chains, SCPs, resource policies, and permission boundaries. See toxic combinations and the exact path each permission travels through.",
  },
  {
    num: "03",
    icon: GitBranch,
    name: "Attack Graph",
    role: "Chained risk",
    desc: "Misconfigurations chained into the precise privilege-escalation paths an attacker would walk. Schematic graph with severity-coded nodes, edge inspector, and grounded evidence.",
  },
  {
    num: "04",
    icon: ShieldCheck,
    name: "Multi-Account Audits",
    role: "Org-aware",
    desc: "Run audits across one account, many accounts, or an entire org. Group by environment, tag, or ownership. Compliance mapping for CIS, NIST, SOC2, PCI, and MITRE ATT&CK.",
  },
  {
    num: "05",
    icon: Terminal,
    name: "Remediation Lifecycle",
    role: "Audit trail",
    desc: "Proposed → reviewed → approved → executed → verified, with optional separate-approver enforcement. Every API call recorded immutably with timestamps and before/after state.",
  },
  {
    num: "06",
    icon: Network,
    name: "Risk Scoring + Diffs",
    role: "Trends",
    desc: "Composite risk grade per account, scheduled audits, and diffs vs the previous run — what's new, what's fixed, what regressed. PDF executive reports + engineer CSV exports.",
  },
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
      <section className="max-w-6xl mx-auto px-6 lg:px-10 pt-28 md:pt-36 pb-32">
        <motion.div
          className="max-w-4xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <motion.div
            className="text-sm font-mono text-primary uppercase tracking-[0.22em] mb-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            Pre-execution reasoning · AWS
          </motion.div>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-semibold leading-[1.05] tracking-tight">
            Know what breaks<br />
            before you change<br />
            <span className="text-primary">a single AWS resource.</span>
          </h1>
          <motion.p
            className="mt-8 text-xl md:text-2xl text-muted-foreground max-w-2xl leading-relaxed"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.6 }}
          >
            Blastline simulates the blast radius of any change, walks effective IAM
            permissions across role chains, and traces real attack paths — so cloud
            security engineers ship fixes with evidence, not guesswork.
          </motion.p>
          <motion.div
            className="mt-12 flex flex-wrap items-center gap-3"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            <Link to="/auth?mode=signup">
              <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium gap-2 h-12 px-7">
                Get started <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#capabilities">
              <Button size="lg" variant="outline" className="border-border bg-transparent hover:bg-secondary text-foreground h-12 px-7">
                See what it does
              </Button>
            </a>
          </motion.div>
          <motion.div
            className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.5 }}
          >
            {["Read-only AWS access", "No exploits run", "CIS · NIST · SOC2 · PCI · MITRE"].map((t) => (
              <div key={t} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" /> {t}
              </div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* Divider */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="border-t border-border/60" />
      </div>

      {/* Capabilities */}
      <section id="capabilities" className="max-w-6xl mx-auto px-6 lg:px-10 py-28">
        <div className="grid md:grid-cols-12 gap-8 md:gap-12 mb-16">
          <div className="md:col-span-5">
            <div className="text-sm font-mono text-primary uppercase tracking-[0.22em] mb-4">Capabilities</div>
            <h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
              Built for the<br />work AWS<br />doesn't help with.
            </h2>
          </div>
          <p className="md:col-span-6 md:col-start-7 text-lg text-muted-foreground leading-relaxed self-end">
            Security Hub tells you something is wrong. Access Analyzer flags a public
            resource. Neither tells you what breaks if you fix it, who can really reach
            what, or which findings actually chain into a real attack. Blastline does.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-border/60 border border-border/60 rounded-lg overflow-hidden">
          {pillars.map((a, i) => (
            <motion.div
              key={a.name}
              className="group bg-background hover:bg-card transition-colors p-7"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.06, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-primary tracking-wider">{a.num}</span>
                  <span className="font-display font-semibold text-xl tracking-tight">{a.name}</span>
                </div>
                <a.icon className="h-4 w-4 text-primary/70 group-hover:text-primary transition-colors" />
              </div>
              <div className="mb-3 text-[10px] font-mono uppercase tracking-wider text-primary">{a.role}</div>
              <p className="text-base text-muted-foreground leading-relaxed">{a.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Why */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="border-t border-border/60" />
      </div>
      <section className="max-w-6xl mx-auto px-6 lg:px-10 py-28">
        <div className="grid md:grid-cols-12 gap-8 md:gap-12">
          <div className="md:col-span-5">
            <div className="text-sm font-mono text-primary uppercase tracking-[0.22em] mb-4">Why Blastline</div>
            <h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
              The questions<br />engineers ask<br /><span className="text-primary">before</span> they touch prod.
            </h2>
          </div>
          <div className="md:col-span-6 md:col-start-7 space-y-6">
            {[
              { q: "If I make this bucket private, what breaks?", a: "Blast-radius simulator lists every principal, Lambda, and pipeline that reads it — ranked break / warn / info, with rollback steps." },
              { q: "What can this role really do, transitively?", a: "Effective-permissions explorer walks role chains up to depth 3, applies SCPs and boundaries, and surfaces toxic combinations." },
              { q: "Which of these 200 findings actually matter?", a: "Attack graph chains misconfigs into reachable paths. The path is the priority — not the CVSS score." },
              { q: "Did the fix actually land in AWS?", a: "Every remediation API call is recorded immutably with timestamps, before/after state, and a deep link straight to the AWS console." },
            ].map((row, i) => (
              <motion.div
                key={i}
                className="border-l-2 border-primary/60 pl-5"
                initial={{ opacity: 0, x: 8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: i * 0.07 }}
              >
                <div className="font-display text-lg font-semibold tracking-tight">{row.q}</div>
                <p className="mt-1.5 text-muted-foreground leading-relaxed">{row.a}</p>
              </motion.div>
            ))}
          </div>
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