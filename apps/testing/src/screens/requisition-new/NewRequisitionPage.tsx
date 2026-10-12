"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import "./NewRequisitionPage.css";
import { normalizeModelOnChange, formatNumber } from "@/lib/formUtils";
import { capacityToM3hr, headToKgcm2 } from "@/lib/unitConversion";
import { ratedPowerKwFromRequisition } from "@/lib/requirementCheck";
import { autoResponsiblePerson } from "@/lib/requisitionAssignment";
import AttachmentsField from "@/components/ui/AttachmentsField";
import { createRequisition, listPumpModels, uploadAttachment } from "@/services/testingService";
import { SkeletonPage } from "@/components/ui/Skeleton";
import PageHeader from "@/components/ui/PageHeader";
import {
  CAPACITY_UNITS,
  ecQuotationFormatHint,
  ecQuotationLabel,
  HEAD_UNITS,
  MOTOR_RPM_OPTIONS,
  REQUISITION_CATEGORIES,
  SOURCE_TEAMS,
} from "@/types/testing";

const ADD_NEW_MODEL = "__add_new_model__";

const optionalNumber = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), inner.optional());

const schema = z.object({
  model: z.string().min(1, "Model is required"),
  category: z.string().min(1, "Category is required"),
  ec_quotation_no: z.string().optional(),
  offer_date: z.string().optional(),
  responsible_person: z.string().min(1, "Responsible person (RES.) is required"),
  source_team: z.string().min(1, "Source team is required"),
  date_of_requisition: z.string().optional(),
  test_qty: optionalNumber(z.coerce.number().int().positive()),
  qth: optionalNumber(z.coerce.number()),
  specific_gravity: optionalNumber(z.coerce.number()),
  // Power is entered in HP only -- KW is derived, never typed in.
  power_hp: optionalNumber(z.coerce.number()),
  head_kgcm2: optionalNumber(z.coerce.number()),
  head_unit: z.string().optional(),
  rpm: optionalNumber(z.coerce.number()),
  motor_rpm: optionalNumber(z.coerce.number()),
  req_capacity: optionalNumber(z.coerce.number()),
  req_capacity_unit: z.string().optional(),
  // Only shown/filled when category is "Against R&D Trials".
  media_type: z.string().optional(),
  target_date: z.string().optional(),
  general_remarks: z.string().optional(),
});

type FormValues = z.input<typeof schema>;

const NewRequisitionPage = () => {
  const router = useRouter();
  const [submitError, setSubmitError] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pumpModels, setPumpModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: REQUISITION_CATEGORIES[0],
      source_team: SOURCE_TEAMS[0],
      responsible_person: autoResponsiblePerson(REQUISITION_CATEGORIES[0]),
    },
  });
  const category = watch("category");
  useEffect(() => {
    setValue("responsible_person", autoResponsiblePerson(category));
  }, [category, setValue]);
  const modelReg = register("model");
  const headValue = watch("head_kgcm2");
  const headUnit = watch("head_unit");
  const capacityValue = watch("req_capacity");
  const capacityUnit = watch("req_capacity_unit");
  const specificGravity = watch("specific_gravity");
  const sg = specificGravity !== undefined && specificGravity !== "" ? Number(specificGravity) : undefined;
  const headConverted =
    headValue !== undefined && headValue !== "" ? headToKgcm2(Number(headValue), headUnit, sg) : null;
  const capacityConverted =
    capacityValue !== undefined && capacityValue !== ""
      ? capacityToM3hr(Number(capacityValue), capacityUnit, sg)
      : null;
  // Power is entered in HP only; KW is always derived (1 HP = 0.746 kW).
  // watch() types this as unknown because the field goes through zod's
  // preprocess wrapper; the helper takes the raw string/number either way.
  const powerHpValue = watch("power_hp") as number | string | null | undefined;
  const powerConvertedKw = ratedPowerKwFromRequisition({ power_hp: powerHpValue });

  useEffect(() => {
    listPumpModels()
      .then((models) => {
        setPumpModels(models);
        setValue("model", models[0] ?? "");
      })
      .finally(() => setIsLoadingModels(false));
  }, [setValue]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError("");
    try {
      const requisition = await createRequisition(schema.parse(values));
      if (pendingFiles.length) {
        // Best-effort: the requisition itself is already created at this
        // point, so a flaky upload shouldn't block navigating to it -- any
        // attachment that fails here can be re-added from Edit.
        await Promise.allSettled(pendingFiles.map((f) => uploadAttachment(requisition.id, f)));
      }
      router.push(`/requisitions/${requisition.requisition_no ?? requisition.id}`);
    } catch {
      setSubmitError("Could not create testing summary. Please try again.");
    }
  };

  if (isLoadingModels) return <SkeletonPage />;

  return (
    <div className="requisition-form-page">
      <PageHeader icon="📝" title="New Requisition" subtitle="Log a testing request as received from the source team." />

      {submitError && <div className="form-error-banner">{submitError}</div>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="model">Model *</label>
            {isCustomModel ? (
              <input
                id="model"
                {...modelReg}
                onChange={(e) => {
                  normalizeModelOnChange(e);
                  modelReg.onChange(e);
                }}
                placeholder="Enter new model"
                autoFocus
              />
            ) : (
              <select
                id="model"
                {...modelReg}
                onChange={(e) => {
                  if (e.target.value === ADD_NEW_MODEL) {
                    setIsCustomModel(true);
                    setValue("model", "");
                  } else {
                    modelReg.onChange(e);
                  }
                }}
              >
                {pumpModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={ADD_NEW_MODEL}>+ Add New Model...</option>
              </select>
            )}
            {isCustomModel && (
              <button
                type="button"
                className="model-mode-toggle"
                onClick={() => {
                  setIsCustomModel(false);
                  setValue("model", pumpModels[0] ?? "");
                }}
              >
                Choose from list instead
              </button>
            )}
            {errors.model && <span className="field-error">{errors.model.message}</span>}
          </div>

          <div className="field">
            <label htmlFor="category">Category *</label>
            <select id="category" {...register("category")}>
              {REQUISITION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="source_team">Source Team *</label>
            <select id="source_team" {...register("source_team")}>
              {SOURCE_TEAMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="ec_quotation_no">{ecQuotationLabel(category)}</label>
            <input
              id="ec_quotation_no"
              {...register("ec_quotation_no")}
              placeholder={ecQuotationFormatHint(category) ?? "N/A"}
            />
            {ecQuotationFormatHint(category) && (
              <span className="unit-hint">Format: {ecQuotationFormatHint(category)}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="offer_date">Offer Date</label>
            <input id="offer_date" type="date" {...register("offer_date")} />
          </div>

          <div className="field">
            <label htmlFor="responsible_person">Responsible Person (RES.)</label>
            {/* Set by category (EC-based -> Vikash, else Sachin), not picked by hand -- the server enforces the same rule. */}
            <input id="responsible_person" value={autoResponsiblePerson(category)} readOnly aria-readonly="true" />
            <input type="hidden" {...register("responsible_person")} />
            <span className="unit-hint">Assigned automatically from the category.</span>
          </div>

          <div className="field">
            <label htmlFor="date_of_requisition">Date of Requisition</label>
            <input id="date_of_requisition" type="date" {...register("date_of_requisition")} />
          </div>

          <div className="field">
            <label htmlFor="test_qty">Test Qty</label>
            <input id="test_qty" type="number" {...register("test_qty")} />
          </div>

          <div className="field">
            <label htmlFor="qth">QTH</label>
            <input id="qth" type="number" step="any" {...register("qth")} />
          </div>

          <div className="field">
            <label htmlFor="specific_gravity">Specific Gravity</label>
            <input
              id="specific_gravity"
              type="number"
              step="any"
              placeholder="1 (water)"
              {...register("specific_gravity")}
            />
          </div>

          <div className="field">
            <label htmlFor="power_hp">Power (HP)</label>
            <input id="power_hp" type="number" step="any" {...register("power_hp")} />
            {powerConvertedKw !== undefined && (
              <span className="unit-hint">= {formatNumber(powerConvertedKw)} KW</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="head_kgcm2">Head</label>
            <input id="head_kgcm2" type="number" step="any" {...register("head_kgcm2")} />
            {headConverted !== null && <span className="unit-hint">= {formatNumber(headConverted)} KG/CM2</span>}
          </div>

          <div className="field">
            <label htmlFor="head_unit">Head Unit</label>
            <select id="head_unit" {...register("head_unit")}>
              <option value="">Select</option>
              {HEAD_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="rpm">RPM</label>
            <input id="rpm" type="number" step="any" {...register("rpm")} />
          </div>

          <div className="field">
            <label htmlFor="motor_rpm">Motor RPM</label>
            <select id="motor_rpm" {...register("motor_rpm")}>
              <option value="">Select</option>
              {MOTOR_RPM_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="req_capacity">Req. Capacity</label>
            <input id="req_capacity" type="number" step="any" {...register("req_capacity")} />
            {capacityConverted !== null && <span className="unit-hint">= {formatNumber(capacityConverted)} M3/HR</span>}
          </div>

          <div className="field">
            <label htmlFor="req_capacity_unit">Capacity Unit</label>
            <select id="req_capacity_unit" {...register("req_capacity_unit")}>
              <option value="">Select</option>
              {CAPACITY_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <AttachmentsField pendingFiles={pendingFiles} onPendingFilesChange={setPendingFiles} />
        </div>

        {category === "Against R&D Trials" && (
          <div className="rd-trial-section form-grid">
            <h2 className="field-full">R&amp;D Trial Details</h2>
            <div className="field">
              <label htmlFor="media_type">Media Type</label>
              <input id="media_type" {...register("media_type")} placeholder="e.g. Water, Oil, Slurry..." />
            </div>
            <div className="field">
              <label htmlFor="target_date">Target Date</label>
              <input id="target_date" type="date" {...register("target_date")} />
            </div>
            <div className="field field-full">
              <label htmlFor="general_remarks">Open Remarks</label>
              <textarea id="general_remarks" rows={3} {...register("general_remarks")} />
            </div>
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => router.push("/dashboard")}>
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit Requisition"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default NewRequisitionPage;
