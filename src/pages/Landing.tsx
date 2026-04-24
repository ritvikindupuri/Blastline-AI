import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import logo from "@/assets/trace-logo.png";

const agents = [
  { num: "01", name: "Recon", desc: "Enumerates IAM, S3, EC2, Lambda, RDS, CloudTrail and GuardDuty across every region." },
  { num: "02", name: "Misconfig", desc: "Runs CIS AWS Foundations and NIST 800-53 checks against the recon graph." },
  { num: "03", name: "Trace", desc: "Chains findings into the exact privilege-escalation sequences an attacker would walk." },
  { num: "04", name: "Blast Radius", desc: "Quantifies impact — affected resources, data classes, and business tier." },
  { num: "05", name: "Remediate", desc: "Emits Terraform modules and AWS CLI commands for every finding." },
  { num: "06", name: "Critic", desc: "An adversarial agent challenges every finding to eliminate false positives." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/85 backdrop-blur-md border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logo} alt="Trace" width={48} height={48} style={{ height: 48, width: 48 }} />
            <span className="font-display font-semibold tracking-tight text-xl">
              Trace<span className="text-primary">.</span>
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
      <section className="max-w-7xl mx-auto px-6 lg:px-10 pt-24 md:pt-32 pb-32">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl"
        >
          <div className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-6">
            AWS security auditor
          </div>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-semibold leading-[1.05] tracking-tight">
            Trace every path<br />
            an attacker could take<br />
            <span className="text-primary">through your AWS account.</span>
          </h1>
          <p className="mt-8 text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed">
            Autonomous agents enumerate your IAM, S3, EC2, and Lambda surface — then chain
            misconfigurations into the exact privilege-escalation sequences that matter.
          </p>
          <div className="mt-12 flex flex-wrap items-center gap-3">
            <Link to="/auth?mode=signup">
              <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium gap-2 h-12 px-7">
                Start an audit <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#agents">
              <Button size="lg" variant="outline" className="border-border bg-transparent hover:bg-secondary text-foreground h-12 px-7">
                See the agents
              </Button>
            </a>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground font-mono">
            {["Read-only access", "No exploits run", "CIS · NIST · MITRE ATT&CK"].map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> {t}
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Divider */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="border-t border-border/60" />
      </div>

      {/* Agents */}
      <section id="agents" className="max-w-7xl mx-auto px-6 lg:px-10 py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="grid md:grid-cols-12 gap-8 md:gap-12 mb-16"
        >
          <div className="md:col-span-5">
            <div className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-4">the agents</div>
            <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
              Six agents.<br />One verdict.
            </h2>
          </div>
          <p className="md:col-span-6 md:col-start-7 text-base text-muted-foreground leading-relaxed self-end">
            Each agent owns one phase of the audit and writes its findings to a shared evidence graph.
            The Critic agent reviews the full chain before anything reaches your dashboard.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-border/60 border border-border/60 rounded-lg overflow-hidden"
        >
          {agents.map((a, i) => (
            <motion.div
              key={a.name}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 + (i * 0.1) }}
              className="group bg-background hover:bg-card transition-colors p-7"
            >
              <div className="flex items-baseline gap-3 mb-4">
                <span className="font-mono text-xs text-primary tracking-wider">{a.num}</span>
                <span className="font-display font-semibold text-lg tracking-tight">{a.name}</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{a.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Trace" width={28} height={28} style={{ height: 28, width: 28 }} className="opacity-80" />
            <span className="font-display font-semibold text-sm">Trace<span className="text-primary">.</span></span>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            Defensive security operations · {new Date().getFullYear()}
          </div>
        </div>
      </footer>
    </div>
  );
}