import { AccessGate } from "./components/AccessGate";
import { AppNav, useRoute } from "./components/AppNav";
import AutomationsPage from "./pages/AutomationsPage";
import IncidentsPage from "./pages/IncidentsPage";
import MaintenancePage from "./pages/MaintenancePage";
import MonitorsPage from "./pages/MonitorsPage";
import OverviewDashboard from "./pages/OverviewDashboard";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import StatusPage from "./pages/StatusPage";
import WorkflowFailuresPage from "./pages/WorkflowFailuresPage";

const PAGES = {
  overview: OverviewDashboard,
  monitors: MonitorsPage,
  incidents: IncidentsPage,
  "workflow-failures": WorkflowFailuresPage,
  automations: AutomationsPage,
  maintenance: MaintenancePage,
  reports: ReportsPage,
  settings: SettingsPage,
} as const;

export default function App(): JSX.Element {
  const route = useRoute();
  if (route === "status") {
    return <StatusPage />; // public page — no nav, no access-gate prompt
  }
  const Page = PAGES[route];
  return (
    <>
      <AccessGate />
      <AppNav route={route} />
      <Page />
    </>
  );
}
