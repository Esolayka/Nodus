import React from "react";
import ReactDOM from "react-dom/client";
import { MiniApp } from "./MiniApp";
import "../i18n";
import "../theme/themes.css";
import "katex/dist/katex.min.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MiniApp />
  </React.StrictMode>,
);
