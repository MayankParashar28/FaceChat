/**
 * Where the browser keeps a session's credential and its cached profile.
 *
 * Its own module on purpose. `utils.ts` needs the token to authenticate user
 * search, and `auth.tsx` imports `utils.ts` for avatars — reading the key from
 * the auth provider would close an import cycle through it.
 */

/**
 * The bearer token for an email/password session, issued by the server at
 * login. Kept separate from the cached profile: the profile is display data,
 * this is a credential.
 *
 * Firebase sessions do not use it — they mint an ID token per request.
 */
export const SESSION_TOKEN_KEY = "facechat_session_token";

/** The cached profile, kept so the app can render a name while it boots. */
export const STORED_USER_KEY = "facechat_mock_user";

export function readSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    // localStorage throws in a private window with site data blocked.
    return null;
  }
}

/**
 * A message explaining why a sign-in was rejected, handed from the auth
 * provider to the login page.
 *
 * The provider discovers some failures only after Firebase has already
 * accepted the credential — an address held by another account, for one — and
 * at that point the only honest thing is to sign out again. Without somewhere
 * to leave the reason, the person would land back on an unchanged login form
 * with no idea what happened. Session storage, so it does not outlive the tab.
 */
const AUTH_ERROR_KEY = "facechat_auth_error";

export function setAuthError(message: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(AUTH_ERROR_KEY, message);
  } catch {
    /* storage can throw in a private window */
  }
}

/** Reads the message and clears it, so it is shown once. */
export function takeAuthError(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const message = sessionStorage.getItem(AUTH_ERROR_KEY);
    if (message) sessionStorage.removeItem(AUTH_ERROR_KEY);
    return message;
  } catch {
    return null;
  }
}
