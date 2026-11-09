import "@neo4j-ndl/base/lib/neo4j-ds-styles.css";
import "./styles.css";

import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

const container = document.getElementById("root");
if (!container)
  throw new Error("index.html has no #root element to render into.");

createRoot(container).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
