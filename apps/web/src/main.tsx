import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { AuthenticationGate } from "./features/auth/AuthenticationGate";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthenticationGate>
      <App />
    </AuthenticationGate>
  </StrictMode>,
);
