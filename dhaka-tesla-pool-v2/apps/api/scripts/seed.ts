import bcrypt from "bcryptjs";
import { db } from "../src/lib/db.js";

const USERS = [
  { name: "Jashim", email: "jashim@tesla.dhaka", role: "DRIVER" as const, wallet: 0 },
  { name: "Nusrat", email: "nusrat@tesla.dhaka", role: "PASSENGER" as const, wallet: 100_000 },
  { name: "Rafiq", email: "rafiq@tesla.dhaka", role: "PASSENGER" as const, wallet: 100_000 },
  { name: "Shirin", email: "shirin@tesla.dhaka", role: "PASSENGER" as const, wallet: 100_000 },
];

async function main() {
  const hash = await bcrypt.hash("password123", 12);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    let jashimId = "";
    for (const user of USERS) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, role, wallet_balance_paisa)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [user.name, user.email, hash, user.role, user.wallet],
      );
      if (user.name === "Jashim") jashimId = result.rows[0]!.id;
    }

    await client.query(
      `INSERT INTO vehicles (driver_id, name, capacity, status)
       VALUES ($1, 'Bullet', 3, 'ONLINE')
       ON CONFLICT (driver_id) DO UPDATE SET name = 'Bullet', capacity = 3`,
      [jashimId],
    );
    await client.query("COMMIT");
    console.log("Seeded Jashim/Bullet, Nusrat, Rafiq and Shirin. Password: password123");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
