// FIRST, deliberately. This reads the invite/recovery marker out of the URL
// before the Supabase client is loaded and strips it. ES imports evaluate in
// order, so moving this line breaks the flow silently.
import "./lib/accountSetup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
