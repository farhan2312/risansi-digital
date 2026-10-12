// Server-only: the Drizzle table and default order behind each BOI_TABLES key.
import { asc, sql } from "drizzle-orm";

import type { BoiTableKey } from "@/lib/boi-tables";
import { boiDrpPanel, boiDrpProbe, boiMechSeal, pumpShaftDia } from "@/lib/db/schema";

export const BOI_DB = {
  "drp-probe": boiDrpProbe,
  "drp-panel": boiDrpPanel,
  "shaft-dia": pumpShaftDia,
  "mech-seal": boiMechSeal,
} as const;

export const BOI_ORDER = {
  "drp-probe": [asc(boiDrpProbe.sizeMm)],
  "drp-panel": [asc(boiDrpPanel.srNo), asc(boiDrpPanel.description)],
  "shaft-dia": [sql`${pumpShaftDia.shaftDia} asc nulls last`, asc(pumpShaftDia.model)],
  "mech-seal": [asc(boiMechSeal.series), asc(boiMechSeal.shaftSizeMm), asc(boiMechSeal.drawingNo)],
} satisfies Record<BoiTableKey, unknown[]>;
