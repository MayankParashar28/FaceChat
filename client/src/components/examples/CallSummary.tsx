import { Router, Route } from "wouter";
import { ThemeProvider } from "../ThemeProvider";
import CallSummary from "../../pages/CallSummary";

export default function CallSummaryExample() {
  return (
    <Router base="/summary">
      <ThemeProvider>
        <Route path="/:callId" component={CallSummary} />
      </ThemeProvider>
    </Router>
  );
}
