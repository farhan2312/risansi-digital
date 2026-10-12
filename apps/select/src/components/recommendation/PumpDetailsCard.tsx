import "./PumpDetailsCard.css";

// Pump Type, Sealing Type and Nearest Charted Head are intentionally NOT shown
// here — the summary already reports them under Operating Conditions, Sealing
// Details and General Information, so repeating them on this card is noise.
type Props = {
  pump: any;
  /** Step-5 Suction & Discharge Size (from viscosity range), or null if not set. */
  size?: number | null;
  /** AG / BK feed option chosen for very thick media (>10 000 cP). */
  agBk?: string;
  /** Pump stage count (1/2/4/8), from the confirmed pump's model. */
  stage?: number | null;
};

const PumpDetailsCard = ({
  pump,
  size = null,
  agBk = "",
  stage = null,
}: Props) => {
  if (!pump) return null;

  return (
    <div className="pump-card">

      <h3>Recommended Pump Details</h3>

      <div className="pump-grid">

        <div>
          <span>Pump Model</span>
          <strong>{pump.model}</strong>
        </div>

        <div>
          <span>Stage</span>
          <strong>{stage ?? "—"}</strong>
        </div>

        {agBk && (
          <div>
            <span>AG / BK</span>
            <strong>{agBk}</strong>
          </div>
        )}

        <div>
          <span>Pump RPM (VOLE max–min)</span>
          <strong>{pump.rpmRange}</strong>
        </div>

        <div>
          <span>VOLE Min–Max</span>
          <strong>
            {pump.voleMin != null && pump.voleMax != null
              ? `${pump.voleMin}–${pump.voleMax}%`
              : "—"}
          </strong>
        </div>

        <div>
          <span>Mechanical Efficiency</span>
          <strong>{pump.mechEff != null ? `${pump.mechEff}%` : "—"}</strong>
        </div>

        <div>
          <span>Suction &amp; Discharge Size</span>
          <strong>{size !== null ? size : "—"}</strong>
        </div>

        <div>
          <span>Testing Status</span>
          <strong>
            <span
              className={`pump-status-pill ${
                pump.isTested ? "pump-status-tested" : "pump-status-not-tested"
              }`}
            >
              {pump.isTested ? "Tested" : "Not Tested"}
            </span>
          </strong>
        </div>

        {pump.testingRemarks && (
          <div>
            <span>Testing Remarks</span>
            <strong>{pump.testingRemarks}</strong>
          </div>
        )}

      </div>

    </div>
  );
};

export default PumpDetailsCard;
