import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import logo from "@/assets/aegis-logo.png";

export default function Auth() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">(
    params.get("mode") === "signup" ? "signup" : "signin"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => { if (user) navigate("/dashboard"); }, [user, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        toast.success("Account created — check your email to verify.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/dashboard");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Auth failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 relative">
      <div className="absolute inset-0 grid-bg opacity-20" />
      <div className="relative z-10 w-full max-w-md">
        <Link to="/" className="flex flex-col items-center justify-center gap-3 mb-8">
          <img src={logo} alt="AegisAWS" width={72} height={72} className="h-18 w-18" style={{ height: 72, width: 72 }} />
          <span className="font-display font-semibold text-2xl tracking-tight">Aegis<span className="text-primary">AWS</span></span>
        </Link>
        <div className="rounded-xl border border-border bg-card/70 backdrop-blur p-6 shadow-card">
          <div className="text-xs font-mono text-muted-foreground">// {mode === "signin" ? "authenticate" : "provision operator"}</div>
          <h1 className="font-display text-2xl font-bold mt-1">{mode === "signin" ? "Sign in" : "Create account"}</h1>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="font-mono" />
            </div>
            <div>
              <Label htmlFor="pwd">Password</Label>
              <Input id="pwd" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
            </div>
            <Button type="submit" disabled={loading} className="w-full gap-2 shadow-glow">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Sign up"}
            </Button>
          </form>
          <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 text-xs font-mono text-muted-foreground hover:text-primary w-full text-center">
            {mode === "signin" ? "// no account? sign up" : "// have an account? sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}