import { Router, Route } from "wouter";
import { ThemeProvider } from "../ThemeProvider";
import VideoCall from "../../pages/VideoCall";

export default function VideoCallExample() {
  return (
    <Router base="/call">
      <ThemeProvider>
        <Route path="/:roomId" component={VideoCall} />
      </ThemeProvider>
    </Router>
  );
}
