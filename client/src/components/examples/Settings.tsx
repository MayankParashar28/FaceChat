import { Router } from "wouter";
import { ThemeProvider } from "../ThemeProvider";
import Settings from "../../pages/Settings";

export default function SettingsExample() {
  return (
    <Router>
      <ThemeProvider>
        <Settings />
      </ThemeProvider>
    </Router>
  );
}
