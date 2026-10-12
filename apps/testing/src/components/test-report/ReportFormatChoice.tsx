"use client";

import Link from "next/link";
import "./ReportFormatChoice.css";
import PageHeader, { pageHeaderButton } from "@/components/ui/PageHeader";

interface ReportFormatChoiceProps {
  heading: string;
  subheading: string;
  observationHref: string;
  viscosityChartHref: string;
  backHref: string;
  backLabel: string;
}

const ReportFormatChoice = ({
  heading,
  subheading,
  observationHref,
  viscosityChartHref,
  backHref,
  backLabel,
}: ReportFormatChoiceProps) => {
  return (
    <div className="format-choice-page">
      <PageHeader
        icon="🧪"
        title={heading}
        subtitle={subheading}
        actions={
          <Link href={backHref} className={pageHeaderButton("secondary")}>
            &larr; {backLabel}
          </Link>
        }
      />

      <div className="format-choice-grid">
        <Link href={observationHref} className="format-card">
          <h2>Observation Sheet</h2>
          <p>
            The standard production-floor test sheet — V-notch, Barrel, or
            Flow Meter capacity measurement with live Power, VE% and ME%
            calculation.
          </p>
          <span className="format-card-cta">Fill Observation Sheet &rarr;</span>
        </Link>

        <Link href={viscosityChartHref} className="format-card">
          <h2>Viscosity Correction Chart</h2>
          <p>
            R&amp;D-style report with per-point V-notch baseline and
            viscosity-corrected (liquid) capacity and efficiency figures,
            using the K-factor correction.
          </p>
          <span className="format-card-cta">Fill Viscosity Correction Chart &rarr;</span>
        </Link>
      </div>
    </div>
  );
};

export default ReportFormatChoice;
