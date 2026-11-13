import type { Metadata } from "next";
import { Suspense } from "react";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
