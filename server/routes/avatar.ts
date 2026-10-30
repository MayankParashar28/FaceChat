import { Router } from "express";
import { AVATAR_SEED_MAX, renderAvatarSvg } from "../services/avatar";

const router = Router();

/**
 * GET /api/avatars/:seed.svg
 *
 * The same picture dicebear served, generated here. Deliberately public and
 * unauthenticated: default avatars appear on the invite preview, which is the
 * page someone sees before they have an account. Nothing here reads data —
 * the response is a pure function of the seed in the path.
 *
 * Deliberately not rate limited, either. This behaves like a static asset:
 * one conversation list can render twenty avatars at once, so any per-IP
 * budget low enough to be worth having would drop avatars on a crowded
 * network instead. The protections that fit are the ones below — a bounded
 * seed and a response the browser is told to keep forever.
 */
router.get("/:seed", (req, res) => {
  const seed = req.params.seed.replace(/\.svg$/, "");

  if (seed.length === 0 || seed.length > AVATAR_SEED_MAX) {
    return res.status(400).json({ message: "Invalid avatar seed" });
  }

  // A given seed draws the same face forever, so this never needs revalidating.
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(renderAvatarSvg(seed));
});

export default router;
