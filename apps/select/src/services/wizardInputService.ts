import apiClient from "./apiClient";

// Matches the [table] URL segments in /api/wizard-input/[table]/route.ts —
// one autosave table per wizard step (MOC+Sealing merged, Motor Rating +
// Drive-common merged, one table per drive system). See schema.ts for the
// full column lists and split rationale.
export type WizardInputTable =
  | "general-info"
  | "fluid-properties"
  | "operating-conditions"
  | "moc-sealing"
  | "motor-drive"
  | "drive-direct"
  | "drive-vbelt"
  | "drive-geared"
  | "pump-model-qty";

// Each helper takes an optional tagId. Wizard rows are keyed by tag - one
// project can carry N tags, each with its own wizard - but the server also
// accepts projectId alone as a fallback that resolves to the project's
// backfilled Default tag, so a caller that hasn't been threaded through the
// tag yet still lands on Default without breaking.
function keyParams(projectId: string, tagId?: string) {
  return tagId ? { projectId, tagId } : { projectId };
}

/** Loads the autosaved state for one wizard-input table + tag. Returns null
 * if nothing has been saved yet for it — not an error state. */
export const getWizardInput = async (
  table: WizardInputTable,
  projectId: string,
  tagId?: string,
): Promise<Record<string, unknown> | null> => {
  try {
    const { data } = await apiClient.get<Record<string, unknown>>(`/wizard-input/${table}`, {
      params: keyParams(projectId, tagId),
    });
    return data;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
};

/** Upserts a slice of autosaved wizard state for one table + tag. `fields`
 * is whatever subset of that table's columns is currently known — extra/
 * unknown keys are ignored server-side. */
export const saveWizardInput = async (
  table: WizardInputTable,
  projectId: string,
  fields: Record<string, unknown>,
  tagId?: string,
): Promise<Record<string, unknown>> => {
  const { data } = await apiClient.put<Record<string, unknown>>(`/wizard-input/${table}`, {
    projectId,
    ...(tagId ? { tagId } : {}),
    ...fields,
  });
  return data;
};

/** Uploads the generated MOC PDF report's raw bytes so a saved copy lives
 * alongside the tag (moc_sealing_input.document), not just the browser
 * download. Raw binary body (not JSON) — see
 * /api/wizard-input/[table]/document/route.ts. */
export const uploadMocDocument = async (
  projectId: string,
  filename: string,
  bytes: ArrayBuffer,
  tagId?: string,
): Promise<void> => {
  await apiClient.post("/wizard-input/moc-sealing/document", bytes, {
    params: { ...keyParams(projectId, tagId), filename },
    headers: { "Content-Type": "application/pdf" },
  });
};

/** Uploads the client-requirements file (image or PDF) so the AI recommendation
 * request can attach it directly to the model call. Raw binary body — see
 * /api/wizard-input/[table]/client-requirements/route.ts. Resolves to the
 * server's stored metadata so the caller can persist filename/mime/uploadedAt
 * into formData for restore. */
export const uploadClientRequirements = async (
  projectId: string,
  file: File,
  tagId?: string,
): Promise<{
  clientRequirementsFilename: string;
  clientRequirementsMime: string;
  clientRequirementsUploadedAt: string;
}> => {
  const bytes = await file.arrayBuffer();
  const { data } = await apiClient.post(
    "/wizard-input/moc-sealing/client-requirements",
    bytes,
    {
      params: {
        ...keyParams(projectId, tagId),
        filename: file.name,
        mime: file.type,
      },
      // Server ignores this - the mime the DB stores comes from the query
      // param above - but a real content-type keeps proxies from stripping the
      // body as unknown.
      headers: { "Content-Type": "application/octet-stream" },
    },
  );
  return data;
};

/** Removes the client-requirements file from moc_sealing_input for the tag. */
export const deleteClientRequirements = async (
  projectId: string,
  tagId?: string,
): Promise<void> => {
  await apiClient.delete("/wizard-input/moc-sealing/client-requirements", {
    params: keyParams(projectId, tagId),
  });
};

/** Deletes the entire per-tag row for one wizard-input table. Used by the
 * Drive Details step's Clear button so a wrong drive-system choice can be
 * wiped without leaving stale rows behind. Idempotent - clearing a table
 * that already has no row is a no-op on the server. */
export const clearWizardInput = async (
  table: WizardInputTable,
  projectId: string,
  tagId?: string,
): Promise<void> => {
  await apiClient.delete(`/wizard-input/${table}`, {
    params: keyParams(projectId, tagId),
  });
};
