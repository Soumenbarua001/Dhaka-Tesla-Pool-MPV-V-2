"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import type { User } from "../../lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("nusrat@tesla.dhaka");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push(result.user.role === "DRIVER" ? "/driver" : "/passenger");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="panel auth-card" onSubmit={submit}>
        <div><span className="eyebrow">WELCOME BACK</span><h1>Sign in</h1><p>Use a seeded account or your own registration.</p></div>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required /></label>
        <label>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>
        {error && <p className="error-box">{error}</p>}
        <button className="button primary full" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
        <p className="muted">No account? <Link href="/register">Register</Link></p>
      </form>
    </div>
  );
}
