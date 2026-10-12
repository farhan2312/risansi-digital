import type { Metadata } from "next";

import "../styles/tailwind.css";
import "../styles/theme.css";
import "../index.css";
import { ThemeProvider } from "../contexts/ThemeContext";

export const metadata: Metadata = {
  title: "Pump Testing Portal",
  description:
    "Testing summary intake, dedup checks against prior test reports, and test report submission for the R&D / production testing team.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
//hello