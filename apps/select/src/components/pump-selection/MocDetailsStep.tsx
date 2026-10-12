"use client";

import { useEffect, useRef, useState } from "react";
import Stepper from "./Stepper";
import StepApprovalBadge from "./approval/StepApprovalBadge";
import "./GeneralInformationStep.css";
import { actions, btnGhost, btnPrimary, control } from "./formStyles";
import { ErrorBanner, hasErrors } from "./fieldBits";
import { pumpSupportComponentName } from "../../lib/pump-support";
import {
  getMocAiSuggestion,
  MOC_AI_ELASTOMERS,
  MOC_AI_MATERIALS,
  MOC_AI_PROVIDERS,
  ROTOR_SHAFT_MATERIALS,
  type MocAiProvider,
  type MocComponentSuggestions,
} from "../../services/mocRecommendationService";
import { downloadMocReportPdf } from "../../lib/moc-pdf-report";
import PdfPreviewModal, { type PdfPreview } from "../ui/PdfPreviewModal";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import {
  deleteClientRequirements,
  saveWizardInput,
  uploadClientRequirements,
  uploadMocDocument,
} from "../../services/wizardInputService";
import {
  phDisplay,
  solidSizeDisplay,
  temperatureCDisplay,
  viscosityCpDisplay,
} from "../../lib/fluid-inputs";

// Renders the AI's markdown-formatted summary/alternatives/seal-rationale
// text (headers, "-"/"1." lists, **bold**) in the UI panel — a small,
// purpose-built subset matching what the prompt asks the model for, not a
// full markdown parser. Same subset the PDF export renders, so the on-screen
// panel and the downloaded report read the same way.
const renderInline = (text: string) =>
  text.split(/(\*\*.+?\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );

const MarkdownLite = ({ text, className = "" }: { text: string; className?: string }) => {
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    const items = listItems;
    blocks.push(
      listOrdered ? (
        <ol key={key} className="list-decimal space-y-0.5 pl-5">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-0.5 pl-5">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    );
    listItems = [];
  };

  (text || "").split("\n").forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) {
      flushList(`list-${idx}`);
      return;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushList(`list-${idx}`);
      blocks.push(
        <div key={idx} className="mt-2 font-semibold first:mt-0">
          {renderInline(heading[1])}
        </div>
      );
    } else if (bullet || numbered) {
      const ordered = !!numbered;
      if (listItems.length > 0 && listOrdered !== ordered) flushList(`list-${idx}`);
      listOrdered = ordered;
      listItems.push((bullet ?? numbered)![1]);
    } else {
      flushList(`list-${idx}`);
      blocks.push(
        <p key={idx} className="mt-1 first:mt-0">
          {renderInline(line)}
        </p>
      );
    }
  });
  flushList("list-end");

  return <div className={className}>{blocks}</div>;
};

type Props = {
  onNext: () => void;
  onPrevious: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFormData: any;
  onStepClick?: (step: number) => void;
  /** Open project's id — needed to upload the generated PDF report so a
   * saved copy lives alongside the project (see handleDownloadPdf). */
  projectId?: string;
  /** The tag being edited. See LivePumpRecommendation for the fallback. */
  tagId?: string;
};

type AiStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

// Rotating status text shown on the button/panel while the AI request is in
// flight — the request genuinely takes a few seconds (the model "thinks"
// before answering), so a single static "Loading…" reads as stuck.
const AI_LOADING_MESSAGES = [
  "Reading media properties…",
  "Checking corrosion resistance…",
  "Weighing temperature & pH impact…",
  "Matching elastomer compatibility…",
  "Comparing material cost vs. durability…",
  "Finalizing recommendation…",
];

// Per-component AI-recommendation panel rows. `key` is the formData field
// prefix (paired with `${key}Remarks` for the open-remarks input); `aiKey`
// selects the matching field from the AI response.
type ComponentRow = {
  key: string;
  label: string;
  aiKey: keyof MocComponentSuggestions;
  options: readonly string[];
};

// Component rows. Which group the Stator Sleeve lands in - and what the base
// plate is called - depends on the pump type chosen on Operating Conditions:
//
//   Horizontal* : Base Plate,     Stator Sleeve is NON-wettable (dry structural)
//   Vertical    : Mounting Plate, Stator Sleeve is WETTABLE (sits in the media)
//
// Both variants write the SAME formData keys (mocAiBasePlate /
// mocAiStatorSleeve), so switching pump type re-labels and re-groups the rows
// without stranding an already-entered material under an orphaned key.
const isVerticalPump = (pumpType: string | undefined): boolean =>
  pumpType === "Vertical";

const pumpSupportRow = (bearingHousing: string | undefined): ComponentRow => ({
  key: "mocAiBearingHousing",
  label: pumpSupportComponentName(bearingHousing),
  aiKey: "bearingHousing",
  options: MOC_AI_MATERIALS,
});

const BASE_PLATE_ROW: ComponentRow = {
  key: "mocAiBasePlate",
  label: "Base Plate",
  aiKey: "basePlate",
  options: MOC_AI_MATERIALS,
};

// A mounting plate is its OWN component, not a renamed base plate - separate
// field, separate AI answer. Only one of the two ever appears.
const MOUNTING_PLATE_ROW: ComponentRow = {
  key: "mocAiMountingPlate",
  label: "Mounting Plate",
  aiKey: "mountingPlate",
  options: MOC_AI_MATERIALS,
};

const TIE_ROD_ROW: ComponentRow = {
  key: "mocAiTieRod",
  label: "Tie Rod",
  aiKey: "tieRod",
  options: MOC_AI_MATERIALS,
};

const NUT_BOLT_ROW: ComponentRow = {
  key: "mocAiNutBolt",
  label: "Nut & Bolt",
  aiKey: "nutBolt",
  options: MOC_AI_MATERIALS,
};

const STATOR_SLEEVE_ROW: ComponentRow = {
  key: "mocAiStatorSleeve",
  label: "Stator Sleeve",
  aiKey: "statorSleeve",
  options: MOC_AI_MATERIALS,
};

const WETTABLE_BASE_ROWS: ComponentRow[] = [
  {
    key: "mocAiPumpHousing",
    label: "Pump Housing",
    aiKey: "pumpHousing",
    options: MOC_AI_MATERIALS,
  },
  {
    key: "mocAiRotor",
    label: "Rotor",
    aiKey: "rotor",
    options: ROTOR_SHAFT_MATERIALS,
  },
  {
    key: "mocAiShaft",
    label: "Shaft",
    aiKey: "shaft",
    options: ROTOR_SHAFT_MATERIALS,
  },
];

/** Non-wettable + wettable rows for a pump type. Stator Sleeve appears in
 *  exactly one of the two, never both. */
const componentGroupsFor = (
  pumpType: string | undefined,
  bearingHousing: string | undefined,
) => {
  const vertical = isVerticalPump(pumpType);
  // On a VERTICAL pump the tie rods and fasteners hang in the liquid with the
  // rest of the wet end, so they group with the wettable parts and take the
  // shaft's MOC; only the bearing housing and mounting plate stay dry. See the
  // house rules in moc-ai-suggestion.ts (applyStructuralMocRules).
  return {
    nonWettable: [
      pumpSupportRow(bearingHousing),
      vertical ? MOUNTING_PLATE_ROW : BASE_PLATE_ROW,
      ...(vertical ? [] : [TIE_ROD_ROW, NUT_BOLT_ROW, STATOR_SLEEVE_ROW]),
    ],
    wettable: [
      ...WETTABLE_BASE_ROWS,
      ...(vertical ? [STATOR_SLEEVE_ROW, TIE_ROD_ROW, NUT_BOLT_ROW] : []),
    ],
  };
};

const ELASTOMER_ROWS: ComponentRow[] = [
  {
    key: "mocAiStatorRubber",
    label: "Stator Rubber Parts",
    aiKey: "statorRubber",
    options: MOC_AI_ELASTOMERS,
  },
];

/** Maps a fresh AI suggestion onto the MANUAL formData keys for the pump
 * type's active rows, plus the sealing arrangement. Only rows the suggestion
 * actually answered are written, so a blank AI field never wipes an existing
 * manual pick. The values are written verbatim — the dropdowns below list any
 * value that isn't one of the standard options, so nothing is silently lost
 * when the AI names a material outside the list. */
const applySuggestionToManual = (
  suggestion: MocComponentSuggestions,
  pumpType: string | undefined,
  bearingHousing: string | undefined,
): Record<string, string> => {
  const groups = componentGroupsFor(pumpType, bearingHousing);
  const rows = [...groups.nonWettable, ...groups.wettable, ...ELASTOMER_ROWS];
  const out: Record<string, string> = {};
  for (const row of rows) {
    const value = (suggestion[row.aiKey] ?? "").trim();
    if (value !== "") out[row.key] = value;
  }
  // The seal arrangement is its own field on the Sealing step; the AI answers
  // it with one of the same two values that dropdown offers.
  const seal = (suggestion.sealRecommendation ?? "").trim();
  if (seal !== "") out.sealingType = seal;
  return out;
};

// Rebuilds the AI suggestion object from the persisted formData fields so the
// full post-generation panel (summary, seal recommendation, green per-
// component cells) can be shown again after a reload. Returns null when AI has
// never been generated for this project (no saved timestamp).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reconstructAiSuggestion = (f: any): MocComponentSuggestions | null => {
  if (!f?.mocAiGeneratedAt) return null;
  return {
    bearingHousing: f.mocAiSuggestedBearingHousing || "",
    basePlate: f.mocAiSuggestedBasePlate || "",
    mountingPlate: f.mocAiSuggestedMountingPlate || "",
    tieRod: f.mocAiSuggestedTieRod || "",
    nutBolt: f.mocAiSuggestedNutBolt || "",
    pumpHousing: f.mocAiSuggestedPumpHousing || "",
    rotor: f.mocAiSuggestedRotor || "",
    shaft: f.mocAiSuggestedShaft || "",
    statorRubber: f.mocAiSuggestedStatorRubber || "",
    statorSleeve: f.mocAiSuggestedStatorSleeve || "",
    sealRecommendation: f.mocAiSuggestedSealRecommendation || "",
    sealMoc: f.mocAiSuggestedSealMoc || "",
    sealRationale: f.mocAiSuggestedSealRationale || "",
    summary: f.mocAiSuggestedSummary || "",
    alternatives: f.mocAiSuggestedAlternatives || "",
  };
};

// The persisted AI fields, blanked — used both on a genuine media change (a
// prior suggestion for the old media is now stale) and to build the save
// payload that clears them in the DB.
const CLEARED_AI_FIELDS = {
  mocAiProvider: "",
  mocAiSuggestedBearingHousing: "",
  mocAiSuggestedBasePlate: "",
  mocAiSuggestedMountingPlate: "",
  mocAiSuggestedTieRod: "",
  mocAiSuggestedNutBolt: "",
  mocAiSuggestedPumpHousing: "",
  mocAiSuggestedRotor: "",
  mocAiSuggestedShaft: "",
  mocAiSuggestedStatorRubber: "",
  mocAiSuggestedStatorSleeve: "",
  mocAiSuggestedSummary: "",
  mocAiSuggestedAlternatives: "",
  mocAiSuggestedSealRecommendation: "",
  mocAiSuggestedSealMoc: "",
  mocAiSuggestedSealRationale: "",
  mocAiGeneratedAt: "",
} as const;

const MocDetailsStep = ({
  onNext,
  onPrevious,
  formData,
  setFormData,
  onStepClick,
  projectId,
  tagId,
}: Props) => {
  const media = formData.media as string;
  // Non-wettable / wettable split, recomputed from the pump type: Vertical
  // moves the Stator Sleeve into the wettable group and renames Base Plate to
  // Mounting Plate. Cheap enough to derive on every render.
  const componentGroups = componentGroupsFor(
    formData.pumpType as string | undefined,
    formData.bearingHousing as string | undefined,
  );

  // Every manual MOC must be chosen, and a manual pick that DIFFERS from the
  // AI recommendation must say why - the remarks are the record of that
  // engineering judgement. Rows are pump-type dependent, so the rules are
  // derived from the same groups the table renders.
  const [showErrors, setShowErrors] = useState(false);
  const activeRows = [
    ...componentGroups.nonWettable,
    ...componentGroups.wettable,
    ...ELASTOMER_ROWS,
  ];

  const { user } = useCurrentUser();

  // Client requirements is now an uploaded file (image or PDF), not free text.
  // Bytes live on the server; only the metadata is in formData so the panel
  // can show "attached" state on reload. The legacy `clientRequirements` text
  // field still restores from old drafts and is shown read-only below when it
  // is present, so nothing is lost from previously-saved projects.
  const clientRequirementsFilename =
    (formData.clientRequirementsFilename as string) ?? "";
  const clientRequirementsMime = (formData.clientRequirementsMime as string) ?? "";
  const clientRequirementsUploadedAt =
    (formData.clientRequirementsUploadedAt as string) ?? "";
  const clientRequirementsLegacyText =
    (formData.clientRequirements as string) ?? "";
  const hasClientRequirements =
    clientRequirementsFilename.trim() !== "" ||
    clientRequirementsLegacyText.trim() !== "";
  const [showClientReq, setShowClientReq] = useState(() => hasClientRequirements);
  const [clientReqUploading, setClientReqUploading] = useState(false);
  const [clientReqError, setClientReqError] = useState<string | null>(null);

  // AI-assisted per-component suggestion — advisory only, opt-in via button
  // click (not fetched automatically). Reset whenever the media changes so a
  // stale suggestion for a previous media can't linger.
  // Restore the AI panel from persisted formData on mount — if AI was ever
  // generated for this project, the full post-generation UI comes straight
  // back after a reload (per req: "if AI generated once, always show the
  // after-generation UI").
  const [aiStatus, setAiStatus] = useState<AiStatus>(
    () => (formData.mocAiGeneratedAt ? "ready" : "idle"),
  );
  const [aiSuggestion, setAiSuggestion] =
    useState<MocComponentSuggestions | null>(() => reconstructAiSuggestion(formData));
  // Anthropic (Claude Haiku) is the only provider now, so there's no picker —
  // just a fixed value passed with each request.
  const aiProvider: MocAiProvider = "anthropic";
  // Provider that produced the currently-shown aiSuggestion. Only Anthropic
  // exists now, so any legacy persisted "gemini" is normalized to it.
  const [resultProvider, setResultProvider] = useState<MocAiProvider>("anthropic");
  // Tracks the previous media so a genuine change (not the initial "" -> X
  // transition when a restored draft's media is first learned) can clear
  // the *persisted* per-component AI record too — otherwise a stale
  // recommendation for the old media would linger in the DB. The full
  // AI panel (summary/alternatives/seal recommendation) is intentionally
  // NOT persisted (only the 8 per-component picks are, see schema.ts) and
  // so is never restored on reload either — it's session-only, same as
  // before this table existed; regenerate is one click if needed again.
  const prevMediaRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prevMedia = prevMediaRef.current;
    prevMediaRef.current = media;
    // Initial mount (undefined) — keep whatever was restored from formData so
    // the persisted panel survives a reload. Only a genuine media *change*
    // invalidates a prior suggestion.
    if (prevMedia === undefined || prevMedia === media) return;
    setAiStatus("idle");
    setAiSuggestion(null);
    setFormData((f: typeof formData) => ({ ...f, ...CLEARED_AI_FIELDS }));
    // Persist the clear immediately so a reload can't restore a stale panel
    // for the previous media.
    if (projectId) {
      saveWizardInput("moc-sealing", projectId, { ...CLEARED_AI_FIELDS }, tagId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  // Cycles AI_LOADING_MESSAGES while a request is in flight.
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  useEffect(() => {
    if (aiStatus !== "loading") {
      setLoadingMsgIndex(0);
      return;
    }
    const id = setInterval(() => {
      setLoadingMsgIndex((i) => (i + 1) % AI_LOADING_MESSAGES.length);
    }, 1400);
    return () => clearInterval(id);
  }, [aiStatus]);

  // File-picker handlers for the client requirements upload. The server
  // enforces mime + size limits authoritatively; the client checks first so a
  // bad drop shows an inline error instead of a rejected upload.
  const CLIENT_REQ_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf";
  const CLIENT_REQ_MAX_MB = 5;
  const handleClientReqUpload = async (file: File) => {
    if (!projectId) {
      setClientReqError("Save this project first before attaching a file.");
      return;
    }
    if (file.size > CLIENT_REQ_MAX_MB * 1024 * 1024) {
      setClientReqError(`File is larger than ${CLIENT_REQ_MAX_MB} MB.`);
      return;
    }
    setClientReqError(null);
    setClientReqUploading(true);
    try {
      const meta = await uploadClientRequirements(projectId, file, tagId);
      setFormData((f: typeof formData) => ({
        ...f,
        clientRequirementsFilename: meta.clientRequirementsFilename,
        clientRequirementsMime: meta.clientRequirementsMime,
        clientRequirementsUploadedAt: meta.clientRequirementsUploadedAt,
      }));
    } catch {
      setClientReqError("Upload failed. Check the file type and try again.");
    } finally {
      setClientReqUploading(false);
    }
  };
  const handleClientReqRemove = async () => {
    if (!projectId) return;
    setClientReqError(null);
    try {
      await deleteClientRequirements(projectId, tagId);
    } catch {
      // Best-effort: still clear locally so the UI reflects the intent.
    }
    setFormData((f: typeof formData) => ({
      ...f,
      clientRequirementsFilename: "",
      clientRequirementsMime: "",
      clientRequirementsUploadedAt: "",
    }));
  };
  // Direct download link for the currently-attached file - lets the user see
  // what they uploaded without going back to the source.
  const clientReqDownloadHref = projectId && clientRequirementsFilename
    ? `/api/wizard-input/moc-sealing/client-requirements?${tagId ? `tagId=${encodeURIComponent(tagId)}` : `projectId=${encodeURIComponent(projectId)}`}`
    : null;

  const requestAiSuggestion = () => {
    if (!media) return;
    setAiStatus("loading");
    const providerAtRequest = aiProvider;
    getMocAiSuggestion({
      media,
      pumpType: formData.pumpType || undefined,
      pumpSupport: formData.bearingHousing || undefined,
      head: formData.head || undefined,
      headUnit: formData.headUnit || undefined,
      // Single value or Min-Max range, rendered as "6.5" / "4-9" - see
      // fluid-inputs.ts. Sending the raw formData.ph / .temperature /
      // .viscosityCp here would drop the *Max side of a range and quietly
      // spec the model against only the least aggressive corner.
      ph: phDisplay(formData) || undefined,
      temperatureC: temperatureCDisplay(formData) || undefined,
      viscosityCp: viscosityCpDisplay(formData) || undefined,
      sg: formData.sg || undefined,
      capacity: formData.capacity || undefined,
      capacityUnit: formData.capacityUnit || undefined,
      solidPct: formData.solidPercentage || undefined,
      solidSize: solidSizeDisplay(formData) || undefined,
      solidType: formData.solidType || undefined,
      // The server reads the uploaded file straight from the DB by projectId
      // rather than having the browser round-trip base64 bytes through JSON.
      projectId: projectId || undefined,
      tagId: tagId || undefined,
      provider: aiProvider,
    })
      .then((res) => {
        if ("unavailable" in res) {
          // "not_configured" = no key → "unavailable" (config message);
          // "failed" = key present but the call errored/was overloaded →
          // "error" (transient, try-again message).
          setAiStatus(res.unavailable === "not_configured" ? "unavailable" : "error");
        } else {
          const suggestion = res;
          setAiSuggestion(suggestion);
          setResultProvider(providerAtRequest);
          setAiStatus("ready");
          // Persist the FULL AI panel — the 8 per-component picks AND the
          // summary/alternatives/seal recommendation + rationale — so the whole
          // post-generation UI rebuilds on reload. Written to the DB
          // immediately here (not only on Next) so a reload right after
          // generating still shows it.
          const aiFields = {
            mocAiProvider: providerAtRequest,
            mocAiSuggestedBearingHousing: suggestion.bearingHousing,
            mocAiSuggestedBasePlate: suggestion.basePlate,
            mocAiSuggestedMountingPlate: suggestion.mountingPlate,
            mocAiSuggestedTieRod: suggestion.tieRod,
            mocAiSuggestedNutBolt: suggestion.nutBolt,
            mocAiSuggestedPumpHousing: suggestion.pumpHousing,
            mocAiSuggestedRotor: suggestion.rotor,
            mocAiSuggestedShaft: suggestion.shaft,
            mocAiSuggestedStatorRubber: suggestion.statorRubber,
            mocAiSuggestedStatorSleeve: suggestion.statorSleeve,
            mocAiSuggestedSummary: suggestion.summary,
            mocAiSuggestedAlternatives: suggestion.alternatives,
            mocAiSuggestedSealRecommendation: suggestion.sealRecommendation,
            mocAiSuggestedSealMoc: suggestion.sealMoc,
            mocAiSuggestedSealRationale: suggestion.sealRationale,
            mocAiGeneratedAt: new Date().toISOString(),
          };
          // Carry the suggestion straight into the manual selections, so the
          // form comes back already filled in rather than needing every row
          // re-entered by hand. The dropdowns stay ordinary inputs, so any row
          // can simply be changed afterwards.
          const applied = applySuggestionToManual(
            suggestion,
            formData.pumpType as string | undefined,
            formData.bearingHousing as string | undefined,
          );
          const saved = { ...aiFields, ...applied };
          setFormData((f: typeof formData) => ({ ...f, ...saved }));
          if (projectId) {
            saveWizardInput("moc-sealing", projectId, saved, tagId).catch(() => {});
          }
        }
      })
      .catch(() => setAiStatus("error"));
  };

  // One entry per row: the manual pick is required, and that is the only
  // check here. Open Remarks stays available on every row but is OPTIONAL,
  // including when the pick departs from the AI suggestion — deliberate, so
  // the eight-row MOC table isn't gated on writing eight justifications.
  // (The Sealing step keeps its own required-remarks rule.)
  const mocErrors: Record<string, string> = {};
  for (const row of activeRows) {
    const manual = (formData[row.key] ?? "").trim();
    if (!manual) mocErrors[row.key] = "Required";
  }
  const mocErrorCount = Object.values(mocErrors).filter(Boolean).length;

  const handleNext = () => {
    if (hasErrors(mocErrors)) {
      setShowErrors(true);
      return;
    }
    onNext();
  };

  // Jumping forward on the stepper gets the same check as Next; going back
  // is always allowed.
  const handleStepClick = (target: number) => {
    if (target > 4 && hasErrors(mocErrors)) {
      setShowErrors(true);
      return;
    }
    onStepClick?.(target);
  };

  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  // The report opens in a preview first; Download there saves that same file.
  const [pdfPreview, setPdfPreview] = useState<(PdfPreview & { bytes: ArrayBuffer }) | null>(null);
  const closePdfPreview = () => {
    setPdfPreview((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
  };
  // A copy is kept on the server (moc_sealing_input.document) when the user
  // actually downloads it. Best-effort: a failed upload doesn't block the
  // download.
  const handlePdfDownloaded = () => {
    if (pdfPreview && projectId) {
      uploadMocDocument(projectId, pdfPreview.filename, pdfPreview.bytes, tagId).catch(() => {});
    }
  };

  const handleDownloadPdf = async () => {
    if (!aiSuggestion) return;
    setPdfGenerating(true);
    setPdfError(false);
    try {
      const { filename, bytes, blob } = await downloadMocReportPdf({
        media,
        head: formData.head || undefined,
        headUnit: formData.headUnit || undefined,
        // Single value or Min–Max range, rendered as "6.5" / "4–9" — see
        // fluid-inputs.ts.
        ph: phDisplay(formData) || undefined,
        temperatureC: temperatureCDisplay(formData) || undefined,
        viscosityCp: viscosityCpDisplay(formData) || undefined,
        sg: formData.sg || undefined,
        capacity: formData.capacity || undefined,
        capacityUnit: formData.capacityUnit || undefined,
        solidPct: formData.solidPercentage || undefined,
        solidSize: solidSizeDisplay(formData) || undefined,
        solidType: formData.solidType || undefined,
        // PDF shows the uploaded filename (legacy rows still get their text).
        clientRequirementsFilename: clientRequirementsFilename || undefined,
        clientRequirements: clientRequirementsLegacyText.trim() || undefined,
        suggestion: aiSuggestion,
        generatedBy: user?.name || user?.email || undefined,
      }, { save: false });
      setPdfPreview({ url: URL.createObjectURL(blob), filename, bytes });
    } catch {
      setPdfError(true);
    } finally {
      setPdfGenerating(false);
    }
  };

  return (
    <div className="step-container">
      <Stepper currentStep={4} maxStep={formData.wizardMaxStep} onStepClick={handleStepClick} />

      {pdfPreview && (
        <PdfPreviewModal
          preview={pdfPreview}
          title="MOC AI Report"
          onClose={closePdfPreview}
          onDownload={handlePdfDownloaded}
        />
      )}

      <div className="step-card">
        <h2>
          MOC &amp; Elastomer
          <StepApprovalBadge step={4} />
        </h2>
        <p>
          Select the material of construction and elastomer
          {media ? (
            <>
              {" "}
              for <strong>{media}</strong>
            </>
          ) : null}
          .
        </p>

        {/* Free-text client extras — anything the wizard has no field for
            (chemical composition, special service notes). Collapsed by
            default; appended to the AI prompt when set. */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowClientReq((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-paper px-4 py-2 text-[13px] font-semibold text-fg transition-colors hover:border-accent"
          >
            <span className="text-base">📋</span>
            {showClientReq ? "Hide" : "Add"} Client Requirements
            {!showClientReq && hasClientRequirements && (
              <span className="rounded-full bg-[var(--pos-soft)] px-2 py-0.5 text-[10px] font-semibold text-pos">
                Added
              </span>
            )}
          </button>

          {showClientReq && (
            <div className="mt-2 rounded-md border border-line bg-elev p-4">
              <label className="section-label" htmlFor="client-requirements-file">
                Client Requirements File
              </label>
              <p className="mt-1 text-[12px] text-fg-3">
                Upload the enquiry document, MOC spec, chemical analysis, or any
                other file the client supplied (PDF or image, max {CLIENT_REQ_MAX_MB} MB).
                The AI recommendation reads the file directly.
              </p>

              {clientRequirementsFilename ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-line-strong bg-paper p-3">
                  <span className="text-lg">
                    {clientRequirementsMime === "application/pdf" ? "📄" : "🖼️"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-fg">
                      {clientRequirementsFilename}
                    </div>
                    {clientRequirementsUploadedAt && (
                      <div className="text-[11px] text-fg-3">
                        Uploaded{" "}
                        {new Date(clientRequirementsUploadedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                  {clientReqDownloadHref && (
                    <a
                      href={clientReqDownloadHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-line-strong bg-paper px-3 py-1 text-[12px] font-semibold text-fg hover:bg-elev"
                    >
                      View
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={handleClientReqRemove}
                    className="rounded-md border border-warn bg-paper px-3 py-1 text-[12px] font-semibold text-warn hover:bg-warn/10"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <input
                    id="client-requirements-file"
                    type="file"
                    accept={CLIENT_REQ_ACCEPT}
                    disabled={!projectId || clientReqUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      // Reset the input value so re-selecting the same file
                      // still fires onChange (browsers otherwise skip it).
                      e.target.value = "";
                      if (f) handleClientReqUpload(f);
                    }}
                    className="block w-full text-[13px] text-fg file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line-strong file:bg-paper file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-fg hover:file:bg-elev"
                  />
                  {!projectId && (
                    <p className="mt-1 text-[12px] text-warn">
                      Save the project first to enable uploads.
                    </p>
                  )}
                  {clientReqUploading && (
                    <p className="mt-1 text-[12px] text-fg-3">Uploading…</p>
                  )}
                </div>
              )}

              {clientReqError && (
                <p className="mt-2 text-[12px] text-warn">{clientReqError}</p>
              )}

              {clientRequirementsLegacyText.trim() !== "" && (
                <div className="mt-3 rounded-md border border-dashed border-line bg-paper p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">
                    Legacy text (from an older draft)
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] text-fg-3">
                    {clientRequirementsLegacyText}
                  </p>
                  <p className="mt-2 text-[11px] text-fg-3">
                    Still sent to the AI. Upload a file above to add today&apos;s
                    updated version.
                  </p>
                </div>
              )}

              {hasClientRequirements && (
                <p className="mt-2 text-[12px] text-fg-3">
                  Regenerate the AI recommendation below to include this
                  attachment.
                </p>
              )}
            </div>
          )}
        </div>

        {!media && (
          <p className="mt-4 text-[13px] text-fg-3">
            Select a media on the General Information step to continue.
          </p>
        )}

        {media && (
          <div className="mt-4 rounded-md border border-line bg-elev p-4">
            <div className="mb-2 block text-[13px] font-semibold text-fg">
              <div>
                <span className="section-label">AI Recommendation</span>
                <span className="mt-1 text-[12px] text-fg-3">
                  Per-component material of construction, elastomer, and sealing
                  — from media, pH, temperature, viscosity, SG, flow rate, and
                  solids/particle size entered so far.
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={aiStatus === "loading"}
                  onClick={requestAiSuggestion}
                  className={`
    inline-flex items-center justify-center gap-2
    rounded-lg px-5 py-2.5
    text-sm font-semibold text-white
    bg-gradient-to-r from-emerald-600 to-green-500
    shadow-md transition-all duration-200
    hover:from-emerald-700 hover:to-green-600
    hover:shadow-lg hover:-translate-y-0.5
    active:translate-y-0
    disabled:cursor-not-allowed
    disabled:opacity-70
    disabled:hover:translate-y-0
    disabled:hover:shadow-md
  `}
              >
                {aiStatus === "loading" ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>

                    {AI_LOADING_MESSAGES[loadingMsgIndex]}
                  </>
                ) : (
                  <>
                    <span className="text-base">✨</span>

                    {aiStatus === "ready"
                      ? "Regenerate Recommendation"
                      : "Generate AI Recommendation"}
                  </>
                )}
                </button>
              </div>
            </div>

            {aiStatus === "unavailable" && (
              <p className="mt-2 text-[12px] text-fg-3">
                AI recommendations aren&apos;t configured — no valid AI API key
                is set for this deployment.
              </p>
            )}
            {aiStatus === "error" && (
              <p className="mt-2 text-[12px] text-warn">
                The AI service didn&apos;t respond — it may be temporarily busy
                or over its rate limit. Please try again in a moment.
              </p>
            )}

            {aiStatus === "ready" && aiSuggestion && (
              <>
                <div className="mt-4 overflow-hidden rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white shadow-sm">
                  {/* Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                        🤖
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          AI Material Recommendation
                        </h3>
                        <p className="text-xs text-slate-500">
                          Generated by{" "}
                          {MOC_AI_PROVIDERS.find((p) => p.value === resultProvider)?.label ??
                            resultProvider}{" "}
                          based on the provided process conditions
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={pdfGenerating}
                      onClick={handleDownloadPdf}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-[13px] font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span>📄</span>
                      {pdfGenerating ? "Preparing PDF…" : "View MOC AI Report"}
                    </button>
                  </div>

                  {/* Content */}
                  <div className="space-y-4 p-4">
                    {pdfError && (
                      <p className="text-[12px] text-warn">
                        Couldn&apos;t generate the PDF — try again.
                      </p>
                    )}

                    {/* The detailed summary, material tables, and alternatives
                        live in the downloadable PDF report only — not shown
                        inline here to keep the form focused on selection. */}
                    <p className="text-[13px] text-slate-600">
                      A recommendation is ready. View the PDF report for the
                      full engineering summary, material breakdown, and
                      alternatives.
                    </p>

                    {/* Disclaimer */}
                    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="text-lg">⚠️</div>

                      <div>
                        <p className="text-sm font-medium text-amber-900">
                          Engineering Review Required
                        </p>

                        <p className="mt-1 text-xs leading-5 text-amber-800">
                          This recommendation is AI-generated for guidance only.
                          Verify the selected materials against engineering
                          standards and customer specifications before approval.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-3">
                  <span className="section-label">Recommended Sealing</span>
                  <div className="mt-1 text-[14px] font-semibold text-fg">
                    {aiSuggestion.sealRecommendation || "—"}
                  </div>
                  {aiSuggestion.sealMoc && (
                    <div className="mt-1 text-[12px] text-emerald-900">
                      <span className="font-semibold">Seal MOC:</span> {aiSuggestion.sealMoc}
                    </div>
                  )}
                  {aiSuggestion.sealRationale && (
                    <MarkdownLite text={aiSuggestion.sealRationale} className="mt-1 text-[12px] text-emerald-900" />
                  )}
                </div>
              </>
            )}

            <MocComponentTable
              title="Non-Wettable Components"
              rows={componentGroups.nonWettable}
              ai={aiSuggestion}
              formData={formData}
              setFormData={setFormData}
              errors={mocErrors}
              showErrors={showErrors}
            />
            <MocComponentTable
              title="Wettable Casting Components"
              rows={componentGroups.wettable}
              ai={aiSuggestion}
              formData={formData}
              setFormData={setFormData}
              errors={mocErrors}
              showErrors={showErrors}
            />
            <MocComponentTable
              title="Elastomer"
              rows={ELASTOMER_ROWS}
              ai={aiSuggestion}
              formData={formData}
              setFormData={setFormData}
              errors={mocErrors}
              showErrors={showErrors}
            />
          </div>
        )}

        <ErrorBanner show={showErrors} count={mocErrorCount} />

        <div className={actions}>
          <button className={btnGhost} onClick={onPrevious}>
            Previous
          </button>
          <button className={btnPrimary} onClick={handleNext}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

// Renders one section of the AI-recommendation panel (Non-Wettable /
// Wettable Casting / Elastomer) as a small table: Component | AI
// Recommendation | Manual (dropdown) | Open Remarks (free text). Always
// rendered once a media is entered — the AI column just reads "—" until a
// suggestion has been fetched. The manual dropdown + remarks are independent
// formData fields; generating a suggestion seeds the manual column from it
// (see applySuggestionToManual), and each row can be changed from there.
const MocComponentTable = ({
  title,
  rows,
  ai,
  formData,
  setFormData,
  errors,
  showErrors,
}: {
  title: string;
  rows: ComponentRow[];
  ai: MocComponentSuggestions | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFormData: any;
  errors: Record<string, string>;
  showErrors: boolean;
}) => (
  <div className="mt-3">
    <span className="section-label">{title}</span>
    <div className="mt-1 overflow-x-auto rounded-md border border-line-strong">
      {/* min-w keeps real column widths on phones — without it `w-full` shrinks
          the 4 columns to ~47px each instead of letting the wrapper scroll. */}
      <table className="w-full min-w-[600px] border-collapse text-[13px]">
        <thead>
          <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-fg-3">
            <th className="px-3 py-2">Component</th>
            <th className="px-3 py-2">AI Recommendation</th>
            <th className="px-3 py-2">Manual *</th>
            <th className="px-3 py-2">Open Remarks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const aiValue = ai ? ai[row.aiKey] : null;
            return (
              <tr key={row.key} className="border-t border-line">
                <td className="px-3 py-2 font-semibold text-fg">{row.label}</td>
                <td className="px-3 py-2">
                  {aiValue ? (
                    <span className="inline-block rounded-md border border-pos bg-[var(--pos-soft)] px-2 py-1 font-semibold text-[var(--pos-strong)]">
                      {aiValue}
                    </span>
                  ) : (
                    <span className="text-fg-3">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    className={control}
                    value={formData[row.key] ?? ""}
                    onChange={(e) =>
                      setFormData({ ...formData, [row.key]: e.target.value })
                    }
                  >
                    <option value="">Select</option>
                    {/* A value carried over from the AI can name a material
                        outside the standard list; list it so the dropdown can
                        actually show it instead of falling back to blank. */}
                    {formData[row.key] &&
                      !row.options.includes(formData[row.key]) && (
                        <option value={formData[row.key]}>{formData[row.key]}</option>
                      )}
                    {row.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  {showErrors && errors[row.key] && (
                    <span className="mt-1 block text-[11.5px] text-neg">{errors[row.key]}</span>
                  )}
                </td>
                {/* Optional on every row — including when the manual pick
                    differs from the AI suggestion. Nothing here is validated. */}
                <td className="px-3 py-2">
                  <input
                    type="text"
                    className={control}
                    placeholder="Remarks (optional)"
                    value={formData[`${row.key}Remarks`] ?? ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        [`${row.key}Remarks`]: e.target.value,
                      })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

export default MocDetailsStep;
