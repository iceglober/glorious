import { BrowserRouter, Routes, Route } from "react-router";
import { PkgManagerProvider } from "./components/PkgManager";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Install } from "./pages/Install";
import { Doc } from "./pages/Doc";
import { Changelog } from "./pages/Changelog";

import quickstartMd from "./content/quickstart.md?raw";
import toolsMd from "./content/tools.md?raw";
import cliMd from "./content/cli.md?raw";

export function App() {
  return (
    <PkgManagerProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="install" element={<Install />} />
            <Route path="quickstart" element={<Doc md={quickstartMd} title="quickstart" />} />
            <Route path="tools" element={<Doc md={toolsMd} title="tools" />} />
            <Route path="cli" element={<Doc md={cliMd} title="cli" />} />
            <Route path="changelog" element={<Changelog />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </PkgManagerProvider>
  );
}
