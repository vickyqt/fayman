"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Workspace } from "@/components/workspace/Workspace";

function Study() {
  const topic = useSearchParams().get("topic")?.trim() || "TCP 3-Way Handshake";
  return <Workspace key={topic} topic={topic} />;
}

export default function StudyPage() {
  return (
    <Suspense fallback={null}>
      <Study />
    </Suspense>
  );
}
