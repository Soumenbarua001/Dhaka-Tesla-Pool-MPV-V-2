import { Router, type NextFunction, type Request, type Response } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { db } from "../lib/db.js";
import { assert } from "../lib/errors.js";
import { matchWaitingRide, transitionPool } from "../services/rideService.js";
import type { PoolStatus } from "../domain/transitions.js";

const router = Router();
router.use(authenticate, requireRole("DRIVER"));

router.get("/vehicle", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, capacity, status, created_at AS "createdAt"
         FROM vehicles WHERE driver_id = $1`,
      [req.auth!.userId],
    );
    const vehicle = result.rows[0];
    if (!vehicle) return res.status(404).json({ error: "No Tesla is registered for this driver" });
    return res.json({ vehicle });
  } catch (error) {
    next(error);
  }
});

router.post("/online", async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE vehicles SET status = 'ONLINE', updated_at = now()
        WHERE driver_id = $1 AND status = 'OFFLINE'
        RETURNING id, name, capacity, status`,
      [req.auth!.userId],
    );
    if (!result.rows[0]) {
      const current = await db.query<{ status: string }>(`SELECT status FROM vehicles WHERE driver_id = $1`, [req.auth!.userId]);
      if (!current.rows[0]) return res.status(404).json({ error: "No Tesla is registered for this driver" });
      if (current.rows[0].status === "ON_TRIP") return res.status(409).json({ error: "Cannot change availability during a trip" });
      return res.json({ ok: true, status: current.rows[0].status });
    }
    return res.json({ vehicle: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post("/offline", async (req, res, next) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const vehicleResult = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM vehicles WHERE driver_id = $1 FOR UPDATE`,
      [req.auth!.userId],
    );
    const vehicle = vehicleResult.rows[0];
    assert(vehicle, 404, "No Tesla is registered for this driver");
    assert(vehicle.status !== "ON_TRIP", 409, "Cannot go offline during a trip");
    const active = await client.query(
      `SELECT 1 FROM pools WHERE vehicle_id = $1 AND status IN ('MATCHING', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED') LIMIT 1`,
      [vehicle.id],
    );
    assert(active.rowCount === 0, 409, "Finish the active pool before going offline");
    await client.query(`UPDATE vehicles SET status = 'OFFLINE', updated_at = now() WHERE id = $1`, [vehicle.id]);
    await client.query("COMMIT");
    return res.json({ ok: true, status: "OFFLINE" });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

router.get("/waiting-requests", async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT rr.id,
              u.name AS "passengerName",
              rr.pickup_zone AS "pickupZone",
              rr.dropoff_zone AS "dropoffZone",
              rr.seats,
              rr.estimated_fare_paisa AS "estimatedFarePaisa",
              rr.payment_method AS "paymentMethod",
              rr.created_at AS "createdAt"
         FROM ride_requests rr
         JOIN users u ON u.id = rr.passenger_id
        WHERE rr.status = 'REQUESTED'
        ORDER BY rr.created_at ASC
        LIMIT 50`,
    );
    return res.json({ requests: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post("/waiting-requests/:rideId/match", async (req, res, next) => {
  try {
    const result = await matchWaitingRide(req.params.rideId, req.auth!.userId);
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/pools", async (req, res, next) => {
  try {
    const pools = await db.query(
      `SELECT p.id,
              p.status,
              p.pickup_zone AS "pickupZone",
              p.created_at AS "createdAt",
              p.accepted_at AS "acceptedAt",
              p.arrived_at AS "arrivedAt",
              p.started_at AS "startedAt",
              v.name AS "vehicleName",
              v.capacity,
              COALESCE(sum(pm.seats), 0)::int AS "occupiedSeats"
         FROM pools p
         JOIN vehicles v ON v.id = p.vehicle_id
         LEFT JOIN pool_members pm ON pm.pool_id = p.id
        WHERE p.driver_id = $1
          AND p.status IN ('MATCHING', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')
        GROUP BY p.id, v.name, v.capacity
        ORDER BY p.created_at DESC`,
      [req.auth!.userId],
    );

    const data = [];
    for (const pool of pools.rows) {
      const members = await db.query(
        `SELECT rr.id AS "rideId",
                u.name AS "passengerName",
                rr.pickup_zone AS "pickupZone",
                rr.dropoff_zone AS "dropoffZone",
                pm.seats,
                rr.status,
                pm.quoted_fare_paisa AS "quotedFarePaisa",
                rr.payment_method AS "paymentMethod"
           FROM pool_members pm
           JOIN ride_requests rr ON rr.id = pm.ride_request_id
           JOIN users u ON u.id = rr.passenger_id
          WHERE pm.pool_id = $1
          ORDER BY pm.joined_at ASC`,
        [pool.id],
      );
      data.push({ ...pool, members: members.rows });
    }
    return res.json({ pools: data });
  } catch (error) {
    next(error);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.status, p.pickup_zone AS "pickupZone", p.created_at AS "createdAt", p.completed_at AS "completedAt",
              v.name AS "vehicleName", count(pm.id)::int AS "passengerCount", COALESCE(sum(pm.seats), 0)::int AS "seatCount"
         FROM pools p
         JOIN vehicles v ON v.id = p.vehicle_id
         LEFT JOIN pool_members pm ON pm.pool_id = p.id
        WHERE p.driver_id = $1 AND p.status IN ('COMPLETED', 'CANCELLED')
        GROUP BY p.id, v.name
        ORDER BY p.created_at DESC
        LIMIT 50`,
      [req.auth!.userId],
    );
    return res.json({ pools: result.rows });
  } catch (error) {
    next(error);
  }
});

function action(target: PoolStatus) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = await transitionPool(req.params.id, req.auth!.userId, target);
      return res.json({ pool });
    } catch (error) {
      next(error);
    }
  };
}

router.post("/pools/:id/accept", action("ACCEPTED"));
router.post("/pools/:id/arrive", action("DRIVER_ARRIVED"));
router.post("/pools/:id/start", action("STARTED"));
router.post("/pools/:id/complete", action("COMPLETED"));

export default router;
