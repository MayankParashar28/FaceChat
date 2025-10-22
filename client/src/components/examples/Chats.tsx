import { Router } from "wouter";
import { ThemeProvider } from "../ThemeProvider";
import Chats from "../../pages/Chats";

export default function ChatsExample() {
  return (
    <Router>
      <ThemeProvider>
        <Chats />
      </ThemeProvider>
    </Router>
  );
}
