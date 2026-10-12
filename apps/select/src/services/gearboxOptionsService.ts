import apiClient from "./apiClient";
import type { PumpSelectionFormData } from "../data/Recommendations";

export interface GearboxOption {
  id: string;
  powerRatingRaw: string;
  powerRatingKw: number | null;
  outputRpm: number;
  model: string;
  gearBoxType: string | null;
  serviceFactor: number | null;
  ratePerNos: number | null;
}

export interface GearboxRecommendation {
  model: string;
  motorKw: number;
  rpmLo: number;
  rpmHi: number;
  rpmLoPadded: number;
  rpmHiPadded: number;
  pbl: GearboxOption[];
  ptl: GearboxOption[];
  topGear: GearboxOption[];
}

/** Gearbox drive recommendation for the confirmed model, using the motor KW
 * from the Motor Rating step. ASF Range / GB Type (if set) narrow the result
 * further — see findGearboxOptions in recommendation-engine.ts. */
export const getGearboxOptions = async (
  formData: PumpSelectionFormData
): Promise<GearboxRecommendation> => {
  const { data } = await apiClient.post<GearboxRecommendation>("/gearbox-options", {
    model: formData.selectedModel,
    capacity: formData.capacity,
    capacityUnit: formData.capacityUnit,
    head: formData.head,
    headUnit: formData.headUnit,
    // Charted head chosen in the Fluid step - fixes the RPM window the belt /
    // gearbox options are screened against, so it matches the card picked.
    selectedHead: formData.selectedHead,
    sg: formData.sg,
    motorKw: formData.driveMotorKw,
    asfRange: formData.asfRange,
    gbConstructionType: formData.gbConstructionType,
  });
  return data;
};
