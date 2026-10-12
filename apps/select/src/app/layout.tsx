import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";

import "../styles/theme.css";
import "../index.css";
import "../App.css";
// Every plain (non-module) CSS file in the app, eagerly loaded here instead
// of from the individual components that use them. Next.js otherwise bundles
// each into a route-specific chunk fetched on first visit to that route —
// including the dashboard shell itself (Sidebar.css, DashboardLayout.css),
// which only ever mounts for the first time right after login. On that
// client-side transition the JS can paint a beat before its CSS chunk is
// fully applied, so the page (sidebar spacing, form gaps, everything) looks
// compact/unstyled until the chunk catches up — a hard refresh forces every
// stylesheet to load synchronously up front, which is why that always looks
// right. Importing them all here puts them in the same eagerly-loaded bundle
// as the rest of the app's critical CSS, removing the race entirely.
import "../layouts/DashboardLayout.css";
import "../components/layout/Sidebar.css";
import "../components/dashboard/StatsCard.css";
import "../components/dashboard/welcomeCard.css";
import "../components/projects/CreateProjectModal.css";
import "../components/projects/ProjectHeader.css";
import "../components/pump-selection/GeneralInformationStep.css";
import "../components/pump-selection/Stepper.css";
import "../components/pump-selection/LivePumpRecommendation.css";
import "../components/recommendation/PumpDetailsCard.css";
import "../components/recommendation/RecommendationTable.css";
import "../components/recommendation/TestReportModal.css";
import "../components/ui/EditPasswordModal.css";
import "../screens/pump-model-master/PumpModelMasterPage.css";
import "../screens/admin/UsersAccessPage.css";
import "../screens/dashboard/DashboardPage.css";
import "../screens/login/LoginPage.css";
import "../screens/not-found/NotFoundPage.css";
import "../screens/projects/ProjectsPage.css";
import "../screens/selection-summary/SelectionSummaryPage.css";
import { ThemeProvider } from "../contexts/ThemeContext";

// Match the Risansi Intelligence Platform (sales.risansi.com) typeface exactly.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

// Instrument Serif — sparse display accent per the Risansi guide.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-plex-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pump Selection Portal",
  description:
    "Intelligent pump recommendation platform for sales engineers with integrated testing reports and enquiry management.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${instrumentSerif.variable}`}
      // The inline script below sets data-theme on <html> before React
      // hydrates, so the server markup (no attribute) intentionally differs
      // from the client DOM. This silences that expected mismatch — it only
      // applies to this element's own attributes, not to any children.
      suppressHydrationWarning
    >
      <head>
        {/* Sets data-theme before first paint so themed CSS variables are
            correct immediately — without this, the page paints once with no
            data-theme (ThemeProvider only applies it in a post-paint effect),
            then snaps to the right look a moment later. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
