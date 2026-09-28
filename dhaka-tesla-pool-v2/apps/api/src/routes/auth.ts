import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db } from "../lib/db.js";
import { config } from "../config.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(72),
  role: z.enum(["PASSENGER", "DRIVER"]),
});

const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72),
});

function setSession(res: Response, user: { id: string; role: string }) {
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: "7d" });
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { name, email, password, role } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query<{ id: string; name: string; email: string; role: "PASSENGER" | "DRIVER"; wallet_balance_paisa: number }>(
        `INSERT INTO users (name, email, password_hash, role, wallet_balance_paisa)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, role, wallet_balance_paisa`,
        [name, email, passwordHash, role, role === "PASSENGER" ? 50_000 : 0],
      );
      const user = created.rows[0];
      if (!user) throw new Error("User insert failed");
      if (role === "DRIVER") {
        await client.query(
          `INSERT INTO vehicles (driver_id, name, capacity, status) VALUES ($1, $2, 3, 'OFFLINE')`,
          [user.id, `${name}'s Tesla`],
        );
      }
      await client.query("COMMIT");
      setSession(res, user);
      return res.status(201).json({ user: userToJson(user) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid email or password" });
    const result = await db.query<{
      id: string;
      name: string;
      email: string;
      role: "PASSENGER" | "DRIVER";
      wallet_balance_paisa: number;
      password_hash: string;
    }>(`SELECT id, name, email, role, wallet_balance_paisa, password_hash FROM users WHERE email = $1`, [parsed.data.email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    setSession(res, user);
    return res.json({ user: userToJson(user) });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("token", { path: "/" });
  return res.json({ ok: true });
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const result = await db.query<{ id: string; name: string; email: string; role: "PASSENGER" | "DRIVER"; wallet_balance_paisa: number }>(
      `SELECT id, name, email, role, wallet_balance_paisa FROM users WHERE id = $1`,
      [req.auth!.userId],
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "Session user no longer exists" });
    return res.json({ user: userToJson(user) });
  } catch (error) {
    next(error);
  }
});

function userToJson(user: { id: string; name: string; email: string; role: string; wallet_balance_paisa: number }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    walletBalancePaisa: Number(user.wallet_balance_paisa),
  };
}

export default router;
