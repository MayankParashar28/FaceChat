import { Router } from "wouter";
import { ThemeProvider } from "../ThemeProvider";
import Dashboard from "../../pages/Dashboard";

export default function DashboardExample() {
  return (
    <Router>
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>
    </Router>
  );
}
