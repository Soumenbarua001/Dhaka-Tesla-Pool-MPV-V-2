"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, money } from "../../lib/api";
import type { User } from "../../lib/types";

type Vehicle = { id: string; name: string; capacity: number; status: string };
type Waiting = { id: string; passengerName: string; pickupZone: string; dropoffZone: string; seats: number; estimatedFarePaisa: number; paymentMethod: string };
type Member = { rideId: string; passengerName: string; pickupZone: string; dropoffZone: string; seats: number; status: string; quotedFarePaisa: number; paymentMethod: string };
type Pool = { id: string; status: string; pickupZone: string; vehicleName: string; capacity: number; occupiedSeats: number; members: Member[] };
type HistoryPool = { id: string; status: string; pickupZone: string; createdAt: string; completedAt: string | null; vehicleName: string; passengerCount: number; seatCount: number };

const nextAction: Record<string, { label: string; path: string }> = {
  MATCHING: { label: "Accept pool", path: "accept" },
  ACCEPTED: { label: "Mark arrived", path: "arrive" },
  DRIVER_ARRIVED: { label: "Start trip", path: "start" },
  STARTED: { label: "Complete trip", path: "complete" },
};

export default function DriverPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [history, setHistory] = useState<HistoryPool[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api<{ user: User }>("/auth/me");
      if (me.user.role !== "DRIVER") return router.replace("/passenger");
      const [vehicleData, waitingData, poolData, historyData] = await Promise.all([
        api<{ vehicle: Vehicle }>("/driver/vehicle"),
        api<{ requests: Waiting[] }>("/driver/waiting-requests"),
        api<{ pools: Pool[] }>("/driver/pools"),
        api<{ pools: HistoryPool[] }>("/driver/history"),
      ]);
      setUser(me.user); setVehicle(vehicleData.vehicle); setWaiting(waitingData.requests); setPools(poolData.pools); setHistory(historyData.pools);
    } catch { router.replace("/login"); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function post(path: string) {
    setBusy(true); setError("");
    try { await api(path, { method: "POST" }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed"); }
    finally { setBusy(false); }
  }

  async function logout() { await api("/auth/logout", { method: "POST" }); router.push("/"); }

  if (!user || !vehicle) return <div className="page-shell"><div className="panel">Loading driver dashboard…</div></div>;

  return (
    <div className="page-shell dashboard">
      <section className="dashboard-head">
        <div><span className="eyebrow">DRIVER</span><h1>{user.name} · {vehicle.name}</h1><p>{vehicle.capacity} seats · <b>{vehicle.status.replaceAll("_", " ")}</b></p></div>
        <div className="row gap"><button className="button ghost" disabled={busy} onClick={() => post(vehicle.status === "OFFLINE" ? "/driver/online" : "/driver/offline")}>{vehicle.status === "OFFLINE" ? "Go online" : "Go offline"}</button><button className="button ghost" onClick={logout}>Sign out</button></div>
      </section>
      {error && <p className="error-box">{error}</p>}

      <section className="driver-grid">
        <div className="panel">
          <div className="section-head"><div><span className="eyebrow">WAITING</span><h2>Unmatched requests</h2></div><button className="text-button" onClick={() => load()}>Refresh</button></div>
          {waiting.length === 0 ? <p className="muted">No passengers are waiting.</p> : <div className="stack">{waiting.map(r => <article className="request-row" key={r.id}><div><strong>{r.passengerName}</strong><span>{r.pickupZone} → {r.dropoffZone}</span><small>{r.seats} seat · {money(r.estimatedFarePaisa)}</small></div><button className="button compact" disabled={busy || vehicle.status !== "ONLINE"} onClick={() => post(`/driver/waiting-requests/${r.id}/match`)}>Match</button></article>)}</div>}
        </div>

        <div className="panel">
          <span className="eyebrow">ACTIVE POOLS</span>
          <h2>Trips assigned to {vehicle.name}</h2>
          {pools.length === 0 ? <p className="muted">No active pool. Passenger requests made while you are online can auto-match.</p> : <div className="stack">{pools.map(pool => {
            const action = nextAction[pool.status];
            return <article className="pool-card" key={pool.id}><div className="pool-head"><div><span className="status-pill">{pool.status.replaceAll("_", " ")}</span><h3>{pool.pickupZone} pickup</h3></div><strong>{pool.occupiedSeats}/{pool.capacity} seats</strong></div><div className="member-list">{pool.members.map(m => <div key={m.rideId}><span><b>{m.passengerName}</b> → {m.dropoffZone}</span><small>{m.seats} seat · {money(m.quotedFarePaisa)}</small></div>)}</div>{action && <button className="button primary full" disabled={busy} onClick={() => post(`/driver/pools/${pool.id}/${action.path}`)}>{action.label}</button>}</article>;
          })}</div>}
        </div>
      </section>

      <section className="panel">
        <div className="section-head"><div><span className="eyebrow">HISTORY</span><h2>Completed and cancelled pools</h2></div><button className="text-button" onClick={() => load()}>Refresh</button></div>
        {history.length === 0 ? <p className="muted">No completed pools yet.</p> : <div className="table-wrap"><table><thead><tr><th>Pickup</th><th>Status</th><th>Passengers</th><th>Seats</th><th>Vehicle</th></tr></thead><tbody>{history.map(item => <tr key={item.id}><td>{item.pickupZone}</td><td><span className="status-mini">{item.status}</span></td><td>{item.passengerCount}</td><td>{item.seatCount}</td><td>{item.vehicleName}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  );
}
