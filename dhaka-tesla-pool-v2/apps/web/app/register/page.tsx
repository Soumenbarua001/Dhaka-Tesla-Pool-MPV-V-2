"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import type { User } from "../../lib/types";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "PASSENGER" as "PASSENGER" | "DRIVER" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify(form) });
      router.push(result.user.role === "DRIVER" ? "/driver" : "/passenger");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="panel auth-card" onSubmit={submit}>
        <div><span className="eyebrow">NEW ACCOUNT</span><h1>Join the pool</h1></div>
        <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={2} required /></label>
        <label>Email<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" required /></label>
        <label>Password<input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" minLength={8} required /></label>
        <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "PASSENGER" | "DRIVER" })}><option value="PASSENGER">Passenger</option><option value="DRIVER">Driver</option></select></label>
        {error && <p className="error-box">{error}</p>}
        <button className="button primary full" disabled={loading}>{loading ? "Creating…" : "Create account"}</button>
        <p className="muted">Already registered? <Link href="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
