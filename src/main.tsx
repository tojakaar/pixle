import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { markAppShellStart } from "./platform";

markAppShellStart();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
