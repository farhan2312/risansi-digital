// The pump parts lists a spare quotation picks from. The same lists as SO to
// Dispatch's part drawings (apps/so2dispatch/lib/part-drawings.ts, from
// Parts_List_1.xlsx); keep the two in step. Client-safe.

export type PartListItem = { section: string; part_no: string; part_name: string };

/** The parts list for a Rota pump (MMP), from Parts_List_1.xlsx. */
export const ROTA_PUMP_PARTS: PartListItem[] = [
  { section: "Main Parts", part_no: "2011", part_name: "Body" },
  { section: "Main Parts", part_no: "2013", part_name: "Stud For Body Both Side" },
  { section: "Main Parts", part_no: "2014", part_name: "Nut & Spring Washer For Item No. 2013" },
  { section: "Main Parts", part_no: "2016", part_name: "Gasket For Side Cover Drive End" },
  { section: "Main Parts", part_no: "2021", part_name: "Rotor" },
  { section: "Main Parts", part_no: "2022", part_name: "Key For Rotor" },
  { section: "Main Parts", part_no: "2023", part_name: "Wedge" },
  { section: "Main Parts", part_no: "2024", part_name: "Allen Bolts For Wedge Fitting" },
  { section: "Main Parts", part_no: "2032", part_name: "Bush For Flap" },
  { section: "Main Parts", part_no: "2033", part_name: "End-plate For Flap" },
  { section: "Main Parts", part_no: "2034", part_name: "Gasket For End Plate Flap" },
  { section: "Main Parts", part_no: "2035", part_name: "Stud For Flap End Plate" },
  { section: "Main Parts", part_no: "2036", part_name: "Nut & Washer For Stud" },
  { section: "Main Parts", part_no: "2225", part_name: "Drive Shaft" },
  { section: "Main Parts", part_no: "2215", part_name: "Side Cover Drive End" },
  { section: "Main Parts", part_no: "2231", part_name: "Flap" },
  { section: "Main Parts", part_no: "2232", part_name: "Tapered Bolt" },
  { section: "Drive End Parts", part_no: "4041", part_name: "Plummer Block" },
  { section: "Drive End Parts", part_no: "4042", part_name: "Roller Bearing Drive End" },
  { section: "Drive End Parts", part_no: "4043", part_name: "Plummer Block Cover Pump Side" },
  { section: "Drive End Parts", part_no: "4044", part_name: "Plummer Block Cover Coupling Side" },
  { section: "Drive End Parts", part_no: "4045", part_name: "Bolt For Part No. 4043 & 4044" },
  { section: "Drive End Parts", part_no: "4046", part_name: "Felt Ring For Part No. 4033" },
  { section: "Drive End Parts", part_no: "4047", part_name: "Felt Ring For Part No. 4044" },
  { section: "Drive End Parts", part_no: "4054", part_name: "Bush For End DE Side Cover" },
  { section: "Non-Drive End Parts", part_no: "4021", part_name: "Side Cover Non-drive End" },
  { section: "Non-Drive End Parts", part_no: "4022", part_name: "Gasket For Side Cover Non- Drive End" },
  { section: "Non-Drive End Parts", part_no: "4023", part_name: "Bush Housing" },
  { section: "Non-Drive End Parts", part_no: "4024", part_name: "Gasket For Bush Housing" },
  { section: "Non-Drive End Parts", part_no: "4025", part_name: "Stud For Bush Housing" },
  { section: "Non-Drive End Parts", part_no: "4026", part_name: "Nut & Washer For Bush Housing Stud" },
  { section: "Non-Drive End Parts", part_no: "4027", part_name: "Bearing Housing Non-drive End" },
  { section: "Non-Drive End Parts", part_no: "4028", part_name: "Bush Bearing Non-drive End" },
  { section: "Non-Drive End Parts", part_no: "4029", part_name: "Plate For Part No. 4027" },
  { section: "Non-Drive End Parts", part_no: "4030", part_name: "Bush Gunmetal Non-drive End" },
  { section: "Non-Drive End Parts", part_no: "4031", part_name: "Bolt For Part No. 4023" },
];

/** The parts list for a Screw pump (PCP), from Parts_List_1.xlsx. */
export const SCREW_PUMP_PARTS: PartListItem[] = [
  { section: "Parts", part_no: "210", part_name: "Bearing Housing" },
  { section: "Parts", part_no: "211", part_name: "Suctioin Housing" },
  { section: "Parts", part_no: "213", part_name: "End Plate" },
  { section: "Parts", part_no: "214", part_name: "Bearing Cover" },
  { section: "Parts", part_no: "215", part_name: "Grease Seal Housing" },
  { section: "Parts", part_no: "216", part_name: "Gland" },
  { section: "Parts", part_no: "217", part_name: "Stuffing Box" },
  { section: "Parts", part_no: "218", part_name: "Oil Seal" },
  { section: "Parts", part_no: "219", part_name: "Shaft Key" },
  { section: "Parts", part_no: "220", part_name: "Shaft" },
  { section: "Parts", part_no: "221", part_name: "Bearing Support Ring" },
  { section: "Parts", part_no: "222", part_name: "Bearing Spacer" },
  { section: "Parts", part_no: "225", part_name: "Circlip Lock" },
  { section: "Parts", part_no: "226", part_name: "Shaft Head" },
  { section: "Parts", part_no: "227", part_name: "Coupling Rod" },
  { section: "Parts", part_no: "230", part_name: "Sleeve" },
  { section: "Parts", part_no: "231", part_name: "Pin" },
  { section: "Parts", part_no: "233", part_name: "Dovel Pin" },
  { section: "Parts", part_no: "234", part_name: "Rotor" },
  { section: "Parts", part_no: "236", part_name: "Stator" },
  { section: "Parts", part_no: "237", part_name: "Deflector" },
  { section: "Parts", part_no: "240", part_name: "Felt Ring" },
  { section: "Parts", part_no: "241", part_name: "Gland Packing" },
  { section: "Parts", part_no: "246", part_name: "Plug 3/4\" BSW (for Drain)" },
  { section: "Parts", part_no: "255", part_name: "Tie Rod Standard" },
  { section: "Parts", part_no: "262", part_name: "Stator Gasket" },
  { section: "Parts", part_no: "2114", part_name: "Leg (Optional)" },
  { section: "Parts", part_no: "2135", part_name: "End plate support" },
  { section: "Parts", part_no: "2173", part_name: "Stuffing Box Gasket" },
  { section: "Parts", part_no: "2241", part_name: "Adjustment Bolt" },
  { section: "Parts", part_no: "2242", part_name: "Taper Roller Bearing" },
  { section: "Parts", part_no: "2261", part_name: "Grub Screw" },
  { section: "Parts", part_no: "2239", part_name: "Sleave Ring" },
  { section: "Parts", part_no: "2325", part_name: "Oil Retainer" },
  { section: "Parts", part_no: "23261", part_name: "Holder / Cliff" },
  { section: "Parts", part_no: "250", part_name: "Bolt" },
];

/** Which parts list a spare model picks from; OTHER has none - every part is typed
 *  with its part no. and name (user, 2026-11-11). */
export type SparePumpKind = "PCP" | "MMP" | "OTHER";

export const partListFor = (pumpKind: SparePumpKind): PartListItem[] =>
  pumpKind === "MMP" ? ROTA_PUMP_PARTS : pumpKind === "OTHER" ? [] : SCREW_PUMP_PARTS;

/** Parts named by hand rather than picked from a list. */
export const OTHER_PART_SECTION = "Others";
