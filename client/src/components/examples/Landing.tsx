import { Router } from "wouter";
import { ThemeProvider } from "../ThemeProvider";
import Landing from "../../pages/Landing";

export default function LandingExample() {
  return (
    <Router>
      <ThemeProvider>
        <Landing />
      </ThemeProvider>
    </Router>
  );
}
