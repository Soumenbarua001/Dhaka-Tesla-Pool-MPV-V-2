import type { PoolClient } from "pg";
import { db } from "../lib/db.js";
import { AppError, assert } from "../lib/errors.js";
import { estimateSoloFare, pooledFare } from "../domain/fare.js";
import { routesAreCompatible, type Zone } from "../domain/zones.js";
import { canTransitionPool, rideStatusForPoolStatus, type PoolStatus, type RideStatus } from "../domain/transitions.js";

type RideRow = {
  id: string;
  passenger_id: string;
  pickup_zone: Zone;
  dropoff_zone: Zone;
  seats: number;
  status: RideStatus;
  estimated_fare_paisa: number;
  payment_method: "CASH" | "TESLA_PAY";
};

type ActivePoolRow = {
  id: string;
  pickup_zone: Zone;
  status: PoolStatus;
};

async function addRideEvent(
  client: PoolClient,
  rideId: string,
  actorUserId: string | null,
  from: RideStatus | null,
  to: RideStatus,
  note?: string,
) {
  await client.query(
    `INSERT INTO ride_events (ride_request_id, actor_user_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [rideId, actorUserId, from, to, note ?? null],
  );
}

async function attachRideToVehicle(
  client: PoolClient,
  ride: RideRow,
  actorUserId: string,
  driverId?: string,
): Promise<{ matched: boolean; poolId?: string }> {
  const candidates = await client.query<{ id: string; driver_id: string; capacity: number }>(
    `SELECT id, driver_id, capacity
       FROM vehicles
      WHERE status = 'ONLINE'
        AND ($1::uuid IS NULL OR driver_id = $1)
      ORDER BY created_at ASC`,
    [driverId ?? null],
  );

  for (const candidate of candidates.rows) {
    const lockedResult = await client.query<{ id: string; driver_id: string; capacity: number }>(
      `SELECT id, driver_id, capacity FROM vehicles WHERE id = $1 AND status = 'ONLINE' FOR UPDATE`,
      [candidate.id],
    );
    const locked = lockedResult.rows[0];
    if (!locked) continue;

    const activePoolResult = await client.query<ActivePoolRow>(
      `SELECT id, pickup_zone, status
         FROM pools
        WHERE vehicle_id = $1
          AND status IN ('MATCHING', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')
        LIMIT 1`,
      [locked.id],
    );

    let pool = activePoolResult.rows[0];
    let reservedSeats = 0;

    if (pool) {
      if (pool.status !== "MATCHING") continue;

      // Serialize pool closure (driver accept) against passengers joining it.
      const lockedPoolResult = await client.query<ActivePoolRow>(
        `SELECT id, pickup_zone, status FROM pools WHERE id = $1 FOR UPDATE`,
        [pool.id],
      );
      pool = lockedPoolResult.rows[0];
      if (!pool || pool.status !== "MATCHING") continue;

      const members = await client.query<{ seats: number; dropoff_zone: Zone }>(
        `SELECT pm.seats, rr.dropoff_zone
           FROM pool_members pm
           JOIN ride_requests rr ON rr.id = pm.ride_request_id
          WHERE pm.pool_id = $1`,
        [pool.id],
      );
      reservedSeats = members.rows.reduce((sum, member) => sum + Number(member.seats), 0);
      const dropoffs = members.rows.map((member) => member.dropoff_zone);
      if (!routesAreCompatible(pool.pickup_zone, dropoffs, ride.pickup_zone, ride.dropoff_zone)) continue;
    }

    if (reservedSeats + ride.seats > locked.capacity) continue;

    if (!pool) {
      const created = await client.query<ActivePoolRow>(
        `INSERT INTO pools (vehicle_id, driver_id, pickup_zone, status)
         VALUES ($1, $2, $3, 'MATCHING')
         RETURNING id, pickup_zone, status`,
        [locked.id, locked.driver_id, ride.pickup_zone],
      );
      pool = created.rows[0];
      if (!pool) throw new AppError(500, "Failed to create pool");
    }

    await client.query(
      `INSERT INTO pool_members (pool_id, ride_request_id, passenger_id, seats, quoted_fare_paisa)
       VALUES ($1, $2, $3, $4, $5)`,
      [pool.id, ride.id, ride.passenger_id, ride.seats, ride.estimated_fare_paisa],
    );
    await client.query(
      `UPDATE ride_requests SET status = 'MATCHED', updated_at = now() WHERE id = $1`,
      [ride.id],
    );
    await addRideEvent(client, ride.id, actorUserId, "REQUESTED", "MATCHED", `Assigned to pool ${pool.id}`);
    return { matched: true, poolId: pool.id };
  }

  return { matched: false };
}

export async function createRide(input: {
  passengerId: string;
  pickupZone: Zone;
  dropoffZone: Zone;
  seats: number;
  paymentMethod: "CASH" | "TESLA_PAY";
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT 1 FROM ride_requests
        WHERE passenger_id = $1
          AND status IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED')
        LIMIT 1`,
      [input.passengerId],
    );
    assert(existing.rowCount === 0, 409, "You already have an active ride", "ACTIVE_RIDE_EXISTS");

    const estimatedFare = estimateSoloFare(input.pickupZone, input.dropoffZone);
    const inserted = await client.query<RideRow>(
      `INSERT INTO ride_requests
        (passenger_id, pickup_zone, dropoff_zone, seats, estimated_fare_paisa, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, passenger_id, pickup_zone, dropoff_zone, seats, status, estimated_fare_paisa, payment_method`,
      [input.passengerId, input.pickupZone, input.dropoffZone, input.seats, estimatedFare, input.paymentMethod],
    );
    const ride = inserted.rows[0];
    if (!ride) throw new AppError(500, "Failed to create ride");
    await addRideEvent(client, ride.id, input.passengerId, null, "REQUESTED", "Ride requested");

    const match = await attachRideToVehicle(client, ride, input.passengerId);
    await client.query("COMMIT");
    return { rideId: ride.id, status: match.matched ? "MATCHED" : "REQUESTED", matched: match.matched, poolId: match.poolId ?? null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function matchWaitingRide(rideId: string, driverId: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<RideRow>(
      `SELECT id, passenger_id, pickup_zone, dropoff_zone, seats, status, estimated_fare_paisa, payment_method
         FROM ride_requests WHERE id = $1 FOR UPDATE`,
      [rideId],
    );
    const ride = result.rows[0];
    assert(ride, 404, "Ride not found");
    assert(ride.status === "REQUESTED", 409, `Ride cannot be matched from ${ride.status}`);

    const match = await attachRideToVehicle(client, ride, driverId, driverId);
    assert(match.matched, 409, "Your Tesla cannot take this request right now", "NO_CAPACITY_OR_INCOMPATIBLE");
    await client.query("COMMIT");
    return match;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelRide(rideId: string, passengerId: string) {
  // A matched cancellation locks in the same order as matching: vehicle -> pool -> ride.
  // If a REQUESTED ride becomes MATCHED while we wait, retry with that lock order.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const snapshot = await client.query<{ status: RideStatus; passenger_id: string; member_id: string | null; pool_id: string | null; vehicle_id: string | null }>(
        `SELECT rr.status, rr.passenger_id,
                pm.id AS member_id, pm.pool_id, p.vehicle_id
           FROM ride_requests rr
           LEFT JOIN pool_members pm ON pm.ride_request_id = rr.id
           LEFT JOIN pools p ON p.id = pm.pool_id
          WHERE rr.id = $1`,
        [rideId],
      );
      const snap = snapshot.rows[0];
      assert(snap, 404, "Ride not found");
      assert(snap.passenger_id === passengerId, 403, "You can only cancel your own ride");

      if (snap.status === "MATCHED" && snap.pool_id && snap.vehicle_id) {
        await client.query(`SELECT id FROM vehicles WHERE id = $1 FOR UPDATE`, [snap.vehicle_id]);
        const lockedPool = await client.query<{ status: PoolStatus }>(`SELECT status FROM pools WHERE id = $1 FOR UPDATE`, [snap.pool_id]);
        assert(lockedPool.rows[0]?.status === "MATCHING", 409, "Cancellation closes after the driver accepts the pool");
      }

      const result = await client.query<RideRow>(
        `SELECT id, passenger_id, pickup_zone, dropoff_zone, seats, status, estimated_fare_paisa, payment_method
           FROM ride_requests WHERE id = $1 FOR UPDATE`,
        [rideId],
      );
      const ride = result.rows[0];
      assert(ride, 404, "Ride not found");
      assert(ride.passenger_id === passengerId, 403, "You can only cancel your own ride");

      if (snap.status === "REQUESTED" && ride.status === "MATCHED") {
        await client.query("ROLLBACK");
        client.release();
        continue;
      }

      assert(ride.status === "REQUESTED" || ride.status === "MATCHED", 409, `Cannot cancel from ${ride.status}`);

      if (ride.status === "MATCHED") {
        const memberResult = await client.query<{ id: string; pool_id: string; vehicle_id: string; pool_status: PoolStatus }>(
          `SELECT pm.id, pm.pool_id, p.vehicle_id, p.status AS pool_status
             FROM pool_members pm
             JOIN pools p ON p.id = pm.pool_id
            WHERE pm.ride_request_id = $1`,
          [ride.id],
        );
        const member = memberResult.rows[0];
        assert(member, 409, "Matched ride has no pool membership");
        assert(member.pool_status === "MATCHING", 409, "Cancellation closes after the driver accepts the pool");

        // The normal matched path already holds these locks; these are harmless if repeated.
        await client.query(`SELECT id FROM vehicles WHERE id = $1 FOR UPDATE`, [member.vehicle_id]);
        await client.query(`SELECT id FROM pools WHERE id = $1 FOR UPDATE`, [member.pool_id]);
        await client.query(`DELETE FROM pool_members WHERE id = $1`, [member.id]);
        const remaining = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM pool_members WHERE pool_id = $1`, [member.pool_id]);
        if (Number(remaining.rows[0]?.count ?? 0) === 0) {
          await client.query(`UPDATE pools SET status = 'CANCELLED' WHERE id = $1`, [member.pool_id]);
        }
      }

      await client.query(
        `UPDATE ride_requests SET status = 'CANCELLED', cancelled_at = now(), updated_at = now() WHERE id = $1`,
        [ride.id],
      );
      await addRideEvent(client, ride.id, passengerId, ride.status, "CANCELLED", "Cancelled by passenger");
      await client.query("COMMIT");
      client.release();
      return;
    } catch (error) {
      await client.query("ROLLBACK");
      client.release();
      throw error;
    }
  }

  throw new AppError(409, "Ride changed while cancelling; please retry", "RIDE_CHANGED");
}

export async function transitionPool(poolId: string, driverId: string, target: PoolStatus) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const poolResult = await client.query<{ id: string; vehicle_id: string; driver_id: string; status: PoolStatus }>(
      `SELECT id, vehicle_id, driver_id, status FROM pools WHERE id = $1 FOR UPDATE`,
      [poolId],
    );
    const pool = poolResult.rows[0];
    assert(pool, 404, "Pool not found");
    assert(pool.driver_id === driverId, 403, "This pool belongs to another driver");
    assert(canTransitionPool(pool.status, target), 409, `Cannot move pool from ${pool.status} to ${target}`);

    const members = await client.query<{
      id: string;
      ride_request_id: string;
      passenger_id: string;
      quoted_fare_paisa: number;
      payment_method: "CASH" | "TESLA_PAY";
      ride_status: RideStatus;
    }>(
      `SELECT pm.id, pm.ride_request_id, pm.passenger_id, pm.quoted_fare_paisa,
              rr.payment_method, rr.status AS ride_status
         FROM pool_members pm
         JOIN ride_requests rr ON rr.id = pm.ride_request_id
        WHERE pm.pool_id = $1
        ORDER BY pm.joined_at ASC`,
      [pool.id],
    );
    assert(members.rowCount > 0, 409, "Cannot transition an empty pool");

    if (target === "COMPLETED") {
      const count = members.rows.length;
      const fares = members.rows.map((member) => ({ ...member, finalFare: pooledFare(member.quoted_fare_paisa, count) }));

      for (const member of fares) {
        if (member.payment_method === "TESLA_PAY") {
          const wallet = await client.query<{ wallet_balance_paisa: number }>(
            `SELECT wallet_balance_paisa FROM users WHERE id = $1 FOR UPDATE`,
            [member.passenger_id],
          );
          const balance = Number(wallet.rows[0]?.wallet_balance_paisa ?? 0);
          assert(balance >= member.finalFare, 409, "A TeslaPay passenger has insufficient balance", "INSUFFICIENT_WALLET_BALANCE");
        }
      }

      for (const member of fares) {
        await client.query(`UPDATE pool_members SET final_fare_paisa = $1 WHERE id = $2`, [member.finalFare, member.id]);
        await client.query(
          `UPDATE ride_requests
              SET status = 'COMPLETED', final_fare_paisa = $1, completed_at = now(), updated_at = now()
            WHERE id = $2`,
          [member.finalFare, member.ride_request_id],
        );
        await addRideEvent(client, member.ride_request_id, driverId, member.ride_status, "COMPLETED", "Trip completed");

        if (member.payment_method === "TESLA_PAY") {
          await client.query(`UPDATE users SET wallet_balance_paisa = wallet_balance_paisa - $1 WHERE id = $2`, [member.finalFare, member.passenger_id]);
          await client.query(
            `INSERT INTO wallet_transactions (user_id, ride_request_id, amount_paisa, kind)
             VALUES ($1, $2, $3, 'RIDE_PAYMENT')`,
            [member.passenger_id, member.ride_request_id, -member.finalFare],
          );
        }
      }
      await client.query(`UPDATE vehicles SET status = 'ONLINE', updated_at = now() WHERE id = $1`, [pool.vehicle_id]);
    } else {
      const rideStatus = rideStatusForPoolStatus(target);
      if (rideStatus) {
        for (const member of members.rows) {
          await client.query(`UPDATE ride_requests SET status = $1, updated_at = now() WHERE id = $2`, [rideStatus, member.ride_request_id]);
          await addRideEvent(client, member.ride_request_id, driverId, member.ride_status, rideStatus, `Driver changed pool to ${target}`);
        }
      }
      if (target === "STARTED") {
        await client.query(`UPDATE vehicles SET status = 'ON_TRIP', updated_at = now() WHERE id = $1`, [pool.vehicle_id]);
      }
    }

    const timestampColumn: Partial<Record<PoolStatus, string>> = {
      ACCEPTED: "accepted_at",
      DRIVER_ARRIVED: "arrived_at",
      STARTED: "started_at",
      COMPLETED: "completed_at",
    };
    const column = timestampColumn[target];
    const sql = column
      ? `UPDATE pools SET status = $1, ${column} = now() WHERE id = $2 RETURNING *`
      : `UPDATE pools SET status = $1 WHERE id = $2 RETURNING *`;
    const updated = await client.query(sql, [target, pool.id]);
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
