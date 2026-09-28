import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { db } from "./lib/db.js";
import authRoutes from "./routes/auth.js";
import rideRoutes from "./routes/rides.js";
import driverRoutes from "./routes/driver.js";
import { errorHandler } from "./middleware/error.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-7", legacyHeaders: false }));

  app.get("/health", async (_req, res, next) => {
    try {
      await db.query("SELECT 1");
      res.json({ ok: true, service: "dhaka-tesla-pool-api" });
    } catch (error) {
      next(error);
    }
  });

  app.use("/auth", authRoutes);
  app.use("/rides", rideRoutes);
  app.use("/driver", driverRoutes);

  app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
  app.use(errorHandler);
  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = createApp();
  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`API listening on http://0.0.0.0:${config.port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await db.end();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
