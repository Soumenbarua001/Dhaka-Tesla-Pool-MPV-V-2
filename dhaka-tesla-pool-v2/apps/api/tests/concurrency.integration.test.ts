import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { cancelRide, createRide, transitionPool } from "../src/services/rideService.js";

const run = process.env.RUN_DB_TESTS === "true";
const suite = run ? describe : describe.skip;

suite("database integrity", () => {
  const ids: Record<string, string> = {};

  beforeEach(async () => {
    for (const key of Object.keys(ids)) delete ids[key];
    await db.query("TRUNCATE wallet_transactions, ride_events, pool_members, pools, ride_requests, vehicles, users RESTART IDENTITY CASCADE");
    const hash = await bcrypt.hash("password123", 4);
    for (const [name, role] of [["Jashim", "DRIVER"], ["Nusrat", "PASSENGER"], ["Rafiq", "PASSENGER"], ["Shirin", "PASSENGER"]] as const) {
      const result = await db.query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, role, wallet_balance_paisa)
         VALUES ($1, $2, $3, $4, 100000) RETURNING id`,
        [name, `${name.toLowerCase()}@test.local`, hash, role],
      );
      ids[name] = result.rows[0]!.id;
    }
    await db.query(`INSERT INTO vehicles (driver_id, name, capacity, status) VALUES ($1, 'Bullet', 3, 'ONLINE')`, [ids.Jashim]);
  });

  afterAll(async () => {
    await db.end();
  });

  it("never allocates the same last seat twice", async () => {
    const first = await createRide({ passengerId: ids.Nusrat!, pickupZone: "Banani", dropoffZone: "Mohakhali", seats: 2, paymentMethod: "CASH" });
    expect(first.matched).toBe(true);

    const [rafiq, shirin] = await Promise.all([
      createRide({ passengerId: ids.Rafiq!, pickupZone: "Banani", dropoffZone: "Gulshan 1", seats: 1, paymentMethod: "CASH" }),
      createRide({ passengerId: ids.Shirin!, pickupZone: "Banani", dropoffZone: "Gulshan 2", seats: 1, paymentMethod: "CASH" }),
    ]);

    expect([rafiq.matched, shirin.matched].filter(Boolean)).toHaveLength(1);
    const seats = await db.query<{ used: number }>(
      `SELECT COALESCE(sum(pm.seats), 0)::int AS used
         FROM pool_members pm JOIN pools p ON p.id = pm.pool_id
        WHERE p.status = 'MATCHING'`,
    );
    expect(Number(seats.rows[0]?.used ?? 0)).toBe(3);
  });

  it("prevents one passenger from cancelling another passenger's ride", async () => {
    const ride = await createRide({ passengerId: ids.Nusrat!, pickupZone: "Banani", dropoffZone: "Mohakhali", seats: 1, paymentMethod: "CASH" });
    await expect(cancelRide(ride.rideId, ids.Rafiq!)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("allows cancellation before acceptance and rejects it after acceptance", async () => {
    const cancellable = await createRide({ passengerId: ids.Nusrat!, pickupZone: "Banani", dropoffZone: "Mohakhali", seats: 1, paymentMethod: "CASH" });
    await expect(cancelRide(cancellable.rideId, ids.Nusrat!)).resolves.toBeUndefined();

    const second = await createRide({ passengerId: ids.Rafiq!, pickupZone: "Banani", dropoffZone: "Gulshan 1", seats: 1, paymentMethod: "CASH" });
    expect(second.poolId).toBeTruthy();
    await transitionPool(second.poolId!, ids.Jashim!, "ACCEPTED");
    await expect(cancelRide(second.rideId, ids.Rafiq!)).rejects.toMatchObject({ statusCode: 409 });
  });
});
