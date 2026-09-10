import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./extension.css";

document.documentElement.classList.add("extension-shell");
createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);
