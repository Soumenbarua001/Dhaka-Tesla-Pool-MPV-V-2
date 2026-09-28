import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const db = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

db.on("error", (error) => {
  console.error("Unexpected database pool error", error);
});
