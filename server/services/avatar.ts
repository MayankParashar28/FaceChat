import { createAvatar } from "@dicebear/core";
import { adventurer } from "@dicebear/collection";

/**
 * Default avatars, drawn here instead of at api.dicebear.com.
 *
 * Both avatar builders used to return a URL on dicebear's own server, and the
 * server persisted that URL into `user.avatar`. The pictures looked free, but
 * every one of them cost a request from the viewer's browser to a third party,
 * carrying the viewer's IP and the seed — which is the account's username — in
 * the query string. Open a conversation list and you handed that service a
 * readable slice of who talks to whom.
 *
 * Dicebear publishes the generator itself, so the art below is the same art:
 * the `adventurer` style with the same seeds, rendered in this process and
 * served from this origin. Nothing leaves the machine.
 */

/** Where `avatarRoutes` is mounted. The builders below must agree with it. */
export const AVATAR_ROUTE = "/api/avatars";

/**
 * Seeds are usernames and Firebase uids — 28 characters at the outside. The
 * cap is here so a request cannot ask for an arbitrarily long path, and the
 * builder clamps to the same number so anything it produces is a URL the
 * route will serve.
 */
export const AVATAR_SEED_MAX = 64;

/**
 * The avatar URL for `seed`, as stored in `user.avatar` and rendered in an
 * `<img>`. Relative on purpose: it has to work on localhost, on the deployed
 * origin, and for a row written by one and read by the other.
 */
export function avatarUrlForSeed(seed: string): string {
  const safe = (seed || "user").slice(0, AVATAR_SEED_MAX);
  return `${AVATAR_ROUTE}/${encodeURIComponent(safe)}.svg`;
}

/**
 * The SVG for `seed`.
 *
 * The seed only drives the generator's PRNG; it is never written into the
 * output, so a seed carrying markup cannot put markup in the picture. (An SVG
 * in an `<img>` cannot run scripts either way, but the endpoint does not have
 * to rely on that.)
 */
export function renderAvatarSvg(seed: string): string {
  return createAvatar(adventurer, { seed: seed || "user" }).toString();
}
