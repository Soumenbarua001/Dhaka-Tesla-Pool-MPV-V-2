import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token as string | undefined;
  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; role: "PASSENGER" | "DRIVER" };
    req.auth = { userId: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

export function requireRole(role: "PASSENGER" | "DRIVER") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role !== role) return res.status(403).json({ error: `Requires ${role.toLowerCase()} role` });
    next();
  };
}
