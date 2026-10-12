import "./TestReportModal.css";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  pump: any;
};

// Not an actual test report — pump_test_reports lives in the separate
// testing-portal database and isn't wired up here yet. This just surfaces
// what pump_model_master actually knows about the selected model.
const TestReportModal = ({ isOpen, onClose, pump }: Props) => {
  if (!isOpen || !pump) return null;

  return (
    <div className="report-overlay">
      <div className="report-modal">

        <h2>Pump Master Data</h2>

        <div className="report-grid">

          <p><strong>Model:</strong> {pump.model}</p>

          <p><strong>RPM (VOLE max–min):</strong> {pump.rpmRange}</p>

          <p><strong>Nearest Charted Head:</strong> {pump.headMwc} MWC</p>

          <p><strong>VOLE Min–Max:</strong> {pump.voleMin != null && pump.voleMax != null ? `${pump.voleMin}–${pump.voleMax}%` : "—"}</p>

          <p><strong>Testing Status:</strong> {pump.isTested ? "Tested" : "Not Tested"}</p>

          {pump.testingRemarks && (
            <p><strong>Remarks:</strong> {pump.testingRemarks}</p>
          )}

        </div>

        <button onClick={onClose}>
          Close
        </button>

      </div>
    </div>
  );
};

export default TestReportModal;
