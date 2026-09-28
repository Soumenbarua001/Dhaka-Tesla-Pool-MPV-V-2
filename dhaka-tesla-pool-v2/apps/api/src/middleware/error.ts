import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/errors.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }

  if ((error as { code?: string }).code === "23505") {
    return res.status(409).json({ error: "A record with that value already exists" });
  }

  console.error(error);
  return res.status(500).json({ error: "Internal server error" });
};
