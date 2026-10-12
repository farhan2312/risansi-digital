"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Reports can only be filled from a requisition's "Fill Test Report" flow
// (see requisitions/[id]/report) -- this standalone, not-tied-to-a-requisition
// entry point is no longer allowed, so redirect away rather than render it.
const NewViscosityChartPage = () => {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return null;
};

export default NewViscosityChartPage;
