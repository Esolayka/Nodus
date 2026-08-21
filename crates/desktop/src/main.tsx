import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import "./theme/themes.css";
import "katex/dist/katex.min.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
