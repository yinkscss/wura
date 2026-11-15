import type { Metadata } from "next";
import { Suspense } from "react";
import { Approve } from "./approve";

export const metadata: Metadata = { title: "Approve" };

export default function ApprovePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Approve params={params} />
    </Suspense>
  );
}
