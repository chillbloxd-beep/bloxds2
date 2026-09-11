import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LiveMonitor } from "./views/LiveMonitor";
import "./monitor.css";

document.documentElement.classList.add("monitor-shell");
createRoot(document.getElementById("root")!).render(<StrictMode><LiveMonitor /></StrictMode>);
