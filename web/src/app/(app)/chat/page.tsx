import type { Metadata } from "next";
import { Suspense } from "react";
import { Chat } from "./chat";

export const metadata: Metadata = { title: "Chat" };

export default function Page() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}
