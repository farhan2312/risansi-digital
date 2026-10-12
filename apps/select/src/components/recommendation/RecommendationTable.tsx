import "./RecommendationTable.css";
import type { PumpRecommendation } from "../../data/Recommendations";

type Props = {
  recommendations: PumpRecommendation[];
  selectedPump: number | null;
  setSelectedPump: React.Dispatch<React.SetStateAction<number | null>>;
};

const RecommendationTable = ({
  recommendations,
  selectedPump,
  setSelectedPump,
}: Props) => {
  return (
    <table className="recommendation-table">
      <thead>
        <tr>
          <th>Select</th>
          <th>Model</th>
          <th>RPM (VOLE max–min)</th>
          <th>Nearest Head (MWC)</th>
          <th>VOLE Min–Max</th>
          <th>Mech Eff</th>
          <th>Tested</th>
        </tr>
      </thead>

      <tbody>
        {recommendations.map((pump) => (
          <tr
            key={pump.id}
            className={selectedPump === pump.id ? "selected-row" : ""}
          >
            <td>
              <input
                type="radio"
                name="pump"
                checked={selectedPump === pump.id}
                onChange={() => setSelectedPump(pump.id)}
              />
            </td>

            <td>{pump.model}</td>
            <td>{pump.rpmRange}</td>
            <td>{pump.headMwc}</td>
            <td>
              {pump.voleMin !== null && pump.voleMax !== null
                ? `${pump.voleMin}–${pump.voleMax}%`
                : "—"}
            </td>
            <td>{pump.mechEff !== null ? `${pump.mechEff}%` : "—"}</td>

            <td>
              <span className={pump.isTested ? "badge tested" : "badge pending"}>
                {pump.isTested ? "Tested" : "Not Tested"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default RecommendationTable;
