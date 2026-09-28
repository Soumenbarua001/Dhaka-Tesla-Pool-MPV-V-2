import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db.js";

async function main() {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const migrationDir = path.resolve(process.cwd(), "migrations");
  const files = (await fs.readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();

  for (const name of files) {
    const exists = await db.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [name]);
    if (exists.rowCount) continue;

    const sql = await fs.readFile(path.join(migrationDir, name), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [name]);
      await client.query("COMMIT");
      console.log(`Applied migration ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
