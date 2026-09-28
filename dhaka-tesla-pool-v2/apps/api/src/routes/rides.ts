import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth.js";
import { db } from "../lib/db.js";
import { cancelRide, createRide } from "../services/rideService.js";
import { estimateSoloFare, pooledFare, BASE_FARE_PAISA, PER_ROUTE_UNIT_PAISA, POOL_DISCOUNT_PERCENT } from "../domain/fare.js";
import { isZone, ZONES } from "../domain/zones.js";

const router = Router();
router.use(authenticate);

const rideSchema = z.object({
  pickupZone: z.string(),
  dropoffZone: z.string(),
  seats: z.number().int().min(1).max(3),
  paymentMethod: z.enum(["CASH", "TESLA_PAY"]).default("CASH"),
});

router.get("/zones", (_req, res) => {
  res.json({
    zones: ZONES,
    fare: { baseFarePaisa: BASE_FARE_PAISA, perRouteUnitPaisa: PER_ROUTE_UNIT_PAISA, poolDiscountPercent: POOL_DISCOUNT_PERCENT },
  });
});

router.post("/estimate", async (req, res) => {
  const parsed = z.object({ pickupZone: z.string(), dropoffZone: z.string() }).safeParse(req.body);
  if (!parsed.success || !isZone(parsed.data.pickupZone) || !isZone(parsed.data.dropoffZone) || parsed.data.pickupZone === parsed.data.dropoffZone) {
    return res.status(400).json({ error: "Choose two different supported zones" });
  }
  const solo = estimateSoloFare(parsed.data.pickupZone, parsed.data.dropoffZone);
  return res.json({ soloFarePaisa: solo, pooledFarePaisa: pooledFare(solo, 2) });
});

router.post("/", requireRole("PASSENGER"), async (req, res, next) => {
  try {
    const parsed = rideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid ride request" });
    const { pickupZone, dropoffZone, seats, paymentMethod } = parsed.data;
    if (!isZone(pickupZone) || !isZone(dropoffZone) || pickupZone === dropoffZone) {
      return res.status(400).json({ error: "Choose two different supported zones" });
    }
    const result = await createRide({ passengerId: req.auth!.userId, pickupZone, dropoffZone, seats, paymentMethod });
    return res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/", requireRole("PASSENGER"), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT rr.id,
              rr.pickup_zone AS "pickupZone",
              rr.dropoff_zone AS "dropoffZone",
              rr.seats,
              rr.status,
              rr.estimated_fare_paisa AS "estimatedFarePaisa",
              rr.final_fare_paisa AS "finalFarePaisa",
              rr.payment_method AS "paymentMethod",
              rr.created_at AS "createdAt",
              p.id AS "poolId",
              p.status AS "poolStatus",
              v.name AS "vehicleName",
              u.name AS "driverName"
         FROM ride_requests rr
         LEFT JOIN pool_members pm ON pm.ride_request_id = rr.id
         LEFT JOIN pools p ON p.id = pm.pool_id
         LEFT JOIN vehicles v ON v.id = p.vehicle_id
         LEFT JOIN users u ON u.id = p.driver_id
        WHERE rr.passenger_id = $1
        ORDER BY rr.created_at DESC`,
      [req.auth!.userId],
    );
    return res.json({ rides: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT rr.*, p.driver_id, p.id AS pool_id
         FROM ride_requests rr
         LEFT JOIN pool_members pm ON pm.ride_request_id = rr.id
         LEFT JOIN pools p ON p.id = pm.pool_id
        WHERE rr.id = $1`,
      [req.params.id],
    );
    const ride = result.rows[0];
    if (!ride) return res.status(404).json({ error: "Ride not found" });
    const canSee = ride.passenger_id === req.auth!.userId || (req.auth!.role === "DRIVER" && ride.driver_id === req.auth!.userId);
    if (!canSee) return res.status(403).json({ error: "Forbidden" });

    const events = await db.query(
      `SELECT from_status AS "fromStatus", to_status AS "toStatus", note, created_at AS "createdAt"
         FROM ride_events WHERE ride_request_id = $1 ORDER BY created_at ASC, id ASC`,
      [req.params.id],
    );
    return res.json({ ride, events: events.rows });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/cancel", requireRole("PASSENGER"), async (req, res, next) => {
  try {
    await cancelRide(req.params.id, req.auth!.userId);
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
