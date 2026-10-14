// Which dashboard a department gets. One file per department, so a change
// Purchase asks for cannot land on Quality's page — the shared behaviour lives
// in ./parts and ./use-dept-dashboard, and each file below decides only what
// its own department needs on screen.

import type { ComponentType } from "react";
import type { DeptKey } from "@/lib/dept-view";
import type { DeptDashboardProps } from "./use-dept-dashboard";
import { AccountsDashboard } from "./accounts";
import { AssemblyDashboard } from "./assembly";
import { BillingDashboard } from "./billing";
import { DrawingDashboard } from "./drawing";
import { PlanningDashboard } from "./planning";
import { PurchaseDashboard } from "./purchase";
import { QualityDashboard } from "./quality";
import { DispatchDashboard } from "./dispatch";

export type { DeptDashboardProps };

/**
 * Every department key has a board. Partial only because the type is keyed by
 * DeptKey and a new key should not break the build before its board exists.
 */
export const DEPT_DASHBOARDS: Partial<
  Record<DeptKey, ComponentType<DeptDashboardProps>>
> = {
  drawing: DrawingDashboard,
  purchase: PurchaseDashboard,
  quality: QualityDashboard,
  planning: PlanningDashboard,
  assembly: AssemblyDashboard,
  billing: BillingDashboard,
  accounts: AccountsDashboard,
  dispatch: DispatchDashboard,
};
