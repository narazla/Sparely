"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { PARAMS_COOKIE } from "@/lib/params";

export function clearScenarioCookie() {
  document.cookie = `${PARAMS_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function ScenarioBanner() {
  const router = useRouter();
  return (
    <div className="relative z-10 -mx-4 -mt-5 mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-l-4 border-b-line border-l-accent bg-accent-soft px-4 py-2 text-[13px] text-ink md:-mx-6 md:px-6">
      <span className="flex items-center gap-2">
        <FlaskConical size={15} aria-hidden className="text-accent" />
        Scenario active: a custom cost–risk policy is applied to every view.
        <Link href="/scenario" className="font-semibold text-accent hover:underline">
          Edit scenario
        </Link>
      </span>
      <button
        onClick={() => {
          clearScenarioCookie();
          router.refresh();
        }}
        className="btn btn-secondary btn-sm"
      >
        Reset to default
      </button>
    </div>
  );
}
