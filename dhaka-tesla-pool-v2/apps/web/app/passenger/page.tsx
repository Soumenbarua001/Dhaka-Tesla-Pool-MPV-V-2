"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, money } from "../../lib/api";
import type { Ride, User } from "../../lib/types";

const FALLBACK_ZONES = ["Banani", "Gulshan 1", "Gulshan 2", "Mohakhali", "Dhanmondi", "Mirpur", "Uttara", "Farmgate", "Bashundhara"];

export default function PassengerPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [zones, setZones] = useState<string[]>(FALLBACK_ZONES);
  const [rides, setRides] = useState<Ride[]>([]);
  const [form, setForm] = useState({ pickupZone: "Banani", dropoffZone: "Mohakhali", seats: 1, paymentMethod: "CASH" });
  const [estimate, setEstimate] = useState<{ soloFarePaisa: number; pooledFarePaisa: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [me, zoneData, rideData] = await Promise.all([
        api<{ user: User }>("/auth/me"),
        api<{ zones: string[] }>("/rides/zones"),
        api<{ rides: Ride[] }>("/rides"),
      ]);
      if (me.user.role !== "PASSENGER") return router.replace("/driver");
      setUser(me.user);
      setZones(zoneData.zones);
      setRides(rideData.rides);
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (form.pickupZone === form.dropoffZone) { setEstimate(null); return; }
    void api<{ soloFarePaisa: number; pooledFarePaisa: number }>("/rides/estimate", {
      method: "POST",
      body: JSON.stringify({ pickupZone: form.pickupZone, dropoffZone: form.dropoffZone }),
    }).then(setEstimate).catch(() => setEstimate(null));
  }, [form.pickupZone, form.dropoffZone]);

  const active = useMemo(() => rides.find((r) => !["COMPLETED", "CANCELLED"].includes(r.status)), [rides]);

  async function requestRide(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/rides", { method: "POST", body: JSON.stringify(form) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request ride");
    } finally { setBusy(false); }
  }

  async function cancel(id: string) {
    setBusy(true); setError("");
    try { await api(`/rides/${id}/cancel`, { method: "POST" }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not cancel ride"); }
    finally { setBusy(false); }
  }

  async function logout() { await api("/auth/logout", { method: "POST" }); router.push("/"); }

  if (!user) return <div className="page-shell"><div className="panel">Loading passenger dashboard…</div></div>;

  return (
    <div className="page-shell dashboard">
      <section className="dashboard-head">
        <div><span className="eyebrow">PASSENGER</span><h1>{user.name}</h1><p>Wallet: {money(user.walletBalancePaisa)}</p></div>
        <button className="button ghost" onClick={logout}>Sign out</button>
      </section>

      {error && <p className="error-box">{error}</p>}

      <section className="dashboard-grid">
        <form className="panel request-card" onSubmit={requestRide}>
          <div><span className="eyebrow">NEW RIDE</span><h2>Where are you going?</h2></div>
          <div className="two-col">
            <label>Pickup<select value={form.pickupZone} onChange={(e) => setForm({ ...form, pickupZone: e.target.value })}>{zones.map(z => <option key={z}>{z}</option>)}</select></label>
            <label>Destination<select value={form.dropoffZone} onChange={(e) => setForm({ ...form, dropoffZone: e.target.value })}>{zones.map(z => <option key={z}>{z}</option>)}</select></label>
          </div>
          <div className="two-col">
            <label>Seats<select value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
            <label>Payment<select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="CASH">Cash</option><option value="TESLA_PAY">TeslaPay</option></select></label>
          </div>
          <div className="fare-preview"><span>Solo estimate <strong>{money(estimate?.soloFarePaisa)}</strong></span><span>If pooled <strong>{money(estimate?.pooledFarePaisa)}</strong></span></div>
          <button className="button primary full" disabled={busy || !!active || form.pickupZone === form.dropoffZone}>{active ? "Finish current ride first" : busy ? "Requesting…" : "Request Tesla"}</button>
        </form>

        <div className="panel">
          <span className="eyebrow">CURRENT STATUS</span>
          {!active ? <div className="empty"><h2>No active ride</h2><p>Your next request will appear here.</p></div> : (
            <div className="active-ride">
              <div className="status-pill">{active.status.replaceAll("_", " ")}</div>
              <h2>{active.pickupZone} → {active.dropoffZone}</h2>
              <p>{active.vehicleName ? `${active.vehicleName} · ${active.driverName}` : "Waiting for an online Tesla"}</p>
              <div className="metrics"><div><small>SEATS</small><strong>{active.seats}</strong></div><div><small>FARE</small><strong>{money(active.finalFarePaisa ?? active.estimatedFarePaisa)}</strong></div></div>
              {["REQUESTED", "MATCHED"].includes(active.status) && <button className="button danger" disabled={busy} onClick={() => cancel(active.id)}>Cancel ride</button>}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-head"><div><span className="eyebrow">HISTORY</span><h2>Your rides</h2></div><button className="text-button" onClick={() => load()}>Refresh</button></div>
        {rides.length === 0 ? <p className="muted">No rides yet.</p> : <div className="table-wrap"><table><thead><tr><th>Route</th><th>Status</th><th>Seats</th><th>Fare</th><th>Payment</th></tr></thead><tbody>{rides.map(r => <tr key={r.id}><td>{r.pickupZone} → {r.dropoffZone}</td><td><span className="status-mini">{r.status.replaceAll("_", " ")}</span></td><td>{r.seats}</td><td>{money(r.finalFarePaisa ?? r.estimatedFarePaisa)}</td><td>{r.paymentMethod.replace("_", " ")}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  );
}
