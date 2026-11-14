import { Suspense } from "react";
import { Consent } from "./consent";

export const metadata = { title: "Connect an app · Wura" };

export default function AuthorizePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#EEF3FC] px-4 py-10">
      <Suspense>
        <Consent />
      </Suspense>
    </main>
  );
}
