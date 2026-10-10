// ── Domain enums ───────────────────────────────────────────────

export type RisansiAccessStatus = 'Pending' | 'Approved' | 'Rejected' | 'Revoked';

// ── Domain enums ───────────────────────────────────────────────

export type PipelineStage =
  | 'Suspect'
  | 'Prospect'
  | 'Quoted'
  | 'Negotiating'
  | 'Won'
  | 'Lost';

export type VisitStatus    = 'planned' | 'checked-in' | 'completed' | 'missed';
export type ClientStatus   = 'Active' | 'Inactive' | 'Prospect';
export type MarketType     = 'Domestic' | 'Export';
export type Tier           = 'A' | 'B' | 'C';
export type ProductCategory = 'Pump' | 'Spare';

// ── Core entities ──────────────────────────────────────────────

export interface Client {
  id:           string;
  client_code:  string;
  legal_name:   string;
  trade_name:   string | null;
  industry:     string;
  zone:         string;
  route:        string | null;
  rep_id:       string | null;
  status:       ClientStatus;
  tier:         Tier | null;
  market_type:  MarketType;
  created_at:   string;
  updated_at:   string | null;
}

export interface Contact {
  id:          string;
  client_id:   string;
  name:        string;
  designation: string | null;
  phone:       string | null;
  email:       string | null;
  is_primary:  boolean;
  created_at:  string;
}

export interface Rep {
  id:    string;
  name:  string;
  email: string;
  role:  string;
  zone:  string | null;
  route: string | null;
}

export interface Visit {
  id:             string;
  client_id:      string;
  rep_id:         string | null;
  visit_date:     string;           // 'YYYY-MM-DD'
  purpose:        string;
  status:         VisitStatus;
  outcome:        string | null;
  notes:          string | null;
  gps_lat:        number | null;
  gps_lng:        number | null;
  check_in_time:  string | null;
  visit_type:     string | null;
  submitted_at:   string | null;
  synced_at:      string | null;
  created_at:     string;
  updated_at:     string | null;
}

export interface Equipment {
  id:             string;
  client_id:      string;
  station:        string | null;    // wellsite / application name from field
  equipment_type: string;           // 'Pump' etc.
  supplier:       string;           // 'RIL' = our unit; anything else = competitor
  model:          string | null;
  quantity:       number;
  condition:      string;           // 'Good' | 'Fair' | 'End of Life'
  opportunity:    boolean;          // true when non-RIL + condition='End of Life'
  created_at:     string;
}

export interface VisitCommercial {
  visit_id:   string;
  data:       Record<string, boolean | string>;
  created_at: string;
}

export interface Opportunity {
  id:               string;
  client_id:        string;
  product:          string;
  stage:            PipelineStage;
  estimated_value:  number;
  probability:      number;         // 0–100
  expected_close:   string | null;  // 'YYYY-MM-DD'
  lost_to:          string | null;  // competitor name if Lost
  created_at:       string;
  updated_at:       string;
}

export interface Order {
  id:               string;
  client_id:        string;
  order_value:      number;
  product_category: ProductCategory;
  financial_year:   string;         // '25-26'
  order_date:       string | null;  // 'YYYY-MM-DD'
  rep_id:           string | null;
}

export interface ActivityLogEntry {
  id:          string;
  entity_type: string | null;
  entity_id:   string | null;
  action:      string;
  email:       string;
  created_at:  string;
}

export interface AccessRequest {
  id:           string;
  email:        string;
  display_name: string;
  status:       RisansiAccessStatus;
  created_at:   string;
  reviewed_by:  string | null;
  reviewed_at:  string | null;
}
