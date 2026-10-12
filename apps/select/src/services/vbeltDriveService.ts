import apiClient from "./apiClient";
import type { PumpSelectionFormData } from "../data/Recommendations";

export interface VBeltOption {
  targetRpm: number;
  pumpPulley: number | null;
  motorPulley: number | null;
  actualRpm: number | null;
  centerDistance: number | null;
  vBelt: number | null;
}

export interface VBeltDrive {
  model: string;
  motorRpm: number;
  motorKw: number;
  grooves: string | null;
  rpmLo: number;
  rpmHi: number;
  candidates: VBeltOption[];
  withinRange: boolean;
  options: VBeltOption[];
}

/** V-Belt drive recommendation for the confirmed model, using the motor KW
 * from the Motor Rating step and the motor RPM chosen on the Drive step. */
export const getVBeltDrive = async (
  formData: PumpSelectionFormData,
  motorRpm: string
): Promise<VBeltDrive> => {
  const { data } = await apiClient.post<VBeltDrive>("/vbelt-drive", {
    model: formData.selectedModel,
    capacity: formData.capacity,
    capacityUnit: formData.capacityUnit,
    head: formData.head,
    headUnit: formData.headUnit,
    // Charted head chosen in the Fluid step - fixes the RPM window the belt /
    // gearbox options are screened against, so it matches the card picked.
    selectedHead: formData.selectedHead,
    sg: formData.sg,
    motorRpm,
    motorKw: formData.driveMotorKw,
  });
  return data;
};
