import { Suspense } from "react";

import CommercialSummaryPage from "@/screens/commercial/CommercialSummaryPage";

// useSearchParams (the ?projectId) needs a Suspense boundary to build.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <CommercialSummaryPage />
    </Suspense>
  );
}
