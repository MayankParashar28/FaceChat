import { Router } from "wouter";
import { ThemeProvider } from "../ThemeProvider";
import Login from "../../pages/Login";

export default function LoginExample() {
  return (
    <Router>
      <ThemeProvider>
        <Login />
      </ThemeProvider>
    </Router>
  );
}
