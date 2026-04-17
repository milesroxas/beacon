import "./styles/globals.css";
import { createRoot } from "react-dom/client";
import { buildInfo } from "@/shared/lib/build-info";

function App() {
  return (
    <main data-version={buildInfo.version}>
      <p>Beacon Designer Extension</p>
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
