import { Router } from "express";
import { ok } from "../lib/envelope";

export const healthRouter = Router();

// Liveness probe used by the client scaffold to confirm the backend is reachable.
healthRouter.get("/", (_req, res) => {
  res.json(ok({ status: "ok" }));
});
