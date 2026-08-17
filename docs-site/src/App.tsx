import { BrowserRouter, Routes, Route } from "react-router";
import { PkgManagerProvider } from "./components/PkgManager";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Install } from "./pages/Install";
import { Doc } from "./pages/Doc";
import { Changelog } from "./pages/Changelog";
import { SectionPage } from "./pages/SectionPage";

import quickstartMd from "../../docs/published/quickstart.md?raw";
import featuresMd from "../../docs/published/features.md?raw";
import philosophyMd from "../../docs/published/philosophy.md?raw";
import glossaryMd from "../../docs/published/glossary.md?raw";
import toolsMd from "../../docs/published/tools.md?raw";
import cliMd from "../../docs/published/cli.md?raw";
import commandsMd from "../../docs/published/commands.md?raw";
import providersMd from "../../docs/published/providers.md?raw";
import modelsMd from "../../docs/published/models.md?raw";
import configurationMd from "../../docs/published/configuration.md?raw";
import extensionsMd from "../../docs/published/extensions.md?raw";
import skillsMd from "../../docs/published/skills.md?raw";
import sequencesMd from "../../docs/published/sequences.md?raw";
import architectureMd from "../../docs/published/architecture.md?raw";
import troubleshootingMd from "../../docs/published/troubleshooting.md?raw";
import apiMd from "./generated/extension-api.md?raw";

export function App() {
  return (
    <PkgManagerProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="get-started" element={<SectionPage path="/get-started" />} />
            <Route path="concepts" element={<SectionPage path="/concepts" />} />
            <Route path="extend" element={<SectionPage path="/extend" />} />
            <Route path="reference" element={<SectionPage path="/reference" />} />
            <Route path="help" element={<SectionPage path="/help" />} />
            <Route path="install" element={<Install />} />
            <Route path="quickstart" element={<Doc md={quickstartMd} title="quickstart" />} />
            <Route path="features" element={<Doc md={featuresMd} title="features" />} />
            <Route path="philosophy" element={<Doc md={philosophyMd} title="philosophy" />} />
            <Route path="glossary" element={<Doc md={glossaryMd} title="glossary" />} />
            <Route path="tools" element={<Doc md={toolsMd} title="tools" />} />
            <Route path="cli" element={<Doc md={cliMd} title="cli" />} />
            <Route path="commands" element={<Doc md={commandsMd} title="commands" />} />
            <Route path="providers" element={<Doc md={providersMd} title="providers" />} />
            <Route path="models" element={<Doc md={modelsMd} title="models" />} />
            <Route path="configuration" element={<Doc md={configurationMd} title="configuration" />} />
            <Route path="extensions" element={<Doc md={extensionsMd} title="extensions" />} />
            <Route path="skills" element={<Doc md={skillsMd} title="skills" />} />
            <Route path="sequences" element={<Doc md={sequencesMd} title="sequences" />} />
            <Route path="architecture" element={<Doc md={architectureMd} title="architecture" />} />
            <Route path="troubleshooting" element={<Doc md={troubleshootingMd} title="troubleshooting" />} />
            <Route path="api" element={<Doc md={apiMd} title="extension API" />} />
            <Route path="changelog" element={<Changelog />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </PkgManagerProvider>
  );
}
