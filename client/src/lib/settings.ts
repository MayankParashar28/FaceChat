import { useState, useEffect, useCallback } from "react";
import { getAuthToken } from "@/lib/queryClient";

export interface UserSettings {
  autoJoinAudio: boolean;
  autoJoinVideo: boolean;
  backgroundBlur: boolean;
  emotionDetection: boolean;
  videoQuality: "sd" | "hd" | "full-hd";
  audioQuality: "standard" | "high" | "studio";
  audioDeviceId: string;
  videoDeviceId: string;
  audioOutputDeviceId: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  autoJoinAudio: false,
  autoJoinVideo: false,
  backgroundBlur: false,
  emotionDetection: true,
  videoQuality: "hd",
  audioQuality: "high",
  audioDeviceId: "",
  videoDeviceId: "",
  audioOutputDeviceId: "",
};

const SETTINGS_STORAGE_KEY = "facecall_user_settings_v2";

function loadSettings(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle missing fields
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.error("Failed to load settings from localStorage:", error);
  }

  return DEFAULT_SETTINGS;
}

function saveSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save settings to localStorage:", error);
  }
}

/**
 * Which settings belong to the account rather than to this machine.
 *
 * Device ids are excluded on purpose: "use the Logitech webcam" is true of the
 * desk you are sitting at, not of you, and syncing it would select a camera
 * that does not exist on your next device.
 */
const ACCOUNT_KEYS = [
  "autoJoinAudio",
  "autoJoinVideo",
  "backgroundBlur",
  "emotionDetection",
  "videoQuality",
  "audioQuality",
] as const;

type AccountSettings = Pick<UserSettings, (typeof ACCOUNT_KEYS)[number]>;

function accountPart(settings: UserSettings): AccountSettings {
  return ACCOUNT_KEYS.reduce((acc, key) => {
    (acc as any)[key] = settings[key];
    return acc;
  }, {} as AccountSettings);
}

/**
 * Push the account-level settings to the user's profile so the choice follows
 * them to their next browser or device.
 *
 * Failure is deliberately not surfaced: the localStorage copy has already been
 * written, so the setting works here regardless.
 */
async function syncAccountSettings(settings: UserSettings): Promise<void> {
  try {
    const token = await getAuthToken();
    if (!token) return;
    await fetch("/api/users/me", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ preferences: { call: accountPart(settings) } }),
    });
  } catch (error) {
    console.warn("Could not sync settings to your account:", error);
  }
}

export function useSettings() {
  // localStorage is read first so the UI renders with the right values
  // immediately, then the account copy arrives and wins.
  const [settings, setSettingsState] = useState<UserSettings>(loadSettings);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const res = await fetch("/api/users/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const user = await res.json();
        const remote = user?.preferences?.call;
        if (cancelled || !remote) return;

        setSettingsState((prev) => {
          // Device ids stay local; everything else comes from the account.
          const merged = { ...prev, ...remote };
          saveSettings(merged);
          return merged;
        });
      } catch {
        // Offline or signed out: the localStorage copy is still correct.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    let next: UserSettings | null = null;
    setSettingsState((prev) => {
      next = { ...prev, ...updates };
      saveSettings(next);
      return next;
    });

    // Only worth a request when an account-level key actually changed; picking
    // a camera should not cost a round trip.
    if (next && ACCOUNT_KEYS.some((k) => k in updates)) {
      void syncAccountSettings(next);
    }
  }, []);

  return {
    settings,
    updateSettings,
  };
}
