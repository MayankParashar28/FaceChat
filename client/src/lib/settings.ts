import { useState, useEffect, useCallback } from "react";

export interface UserSettings {
  autoJoinAudio: boolean;
  autoJoinVideo: boolean;
  backgroundBlur: boolean;
  emotionDetection: boolean;
  videoQuality: "sd" | "hd" | "full-hd";
  audioQuality: "standard" | "high" | "studio";
}

const DEFAULT_SETTINGS: UserSettings = {
  autoJoinAudio: true,
  autoJoinVideo: true,
  backgroundBlur: false,
  emotionDetection: true,
  videoQuality: "hd",
  audioQuality: "high",
};

const SETTINGS_STORAGE_KEY = "facecall_user_settings";

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

export function useSettings() {
  const [settings, setSettingsState] = useState<UserSettings>(loadSettings);

  // Load settings on mount
  useEffect(() => {
    setSettingsState(loadSettings());
  }, []);

  // Save settings whenever they change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    setSettingsState((prev) => {
      const newSettings = { ...prev, ...updates };
      saveSettings(newSettings);
      return newSettings;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  }, []);

  return {
    settings,
    updateSettings,
    resetSettings,
  };
}

