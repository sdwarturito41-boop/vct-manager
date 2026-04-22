"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";

const REGIONS = ["EMEA", "Americas", "Pacific", "China"] as const;

export default function NewSavePage() {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [teamTag, setTeamTag] = useState("");
  const [region, setRegion] = useState<(typeof REGIONS)[number]>("EMEA");
  const [error, setError] = useState<string | null>(null);

  const createSave = trpc.save.create.useMutation({
    onSuccess: () => router.push("/dashboard"),
    onError: (e) => setError(e.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    createSave.mutate({ teamName, teamTag, region });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F0F14]">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-md flex-col gap-5 rounded-lg p-8"
        style={{ background: "#13131A", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div>
          <h1 className="text-[22px] font-medium uppercase tracking-[0.2em] text-white">Start Career</h1>
          <p className="mt-1 text-[12px]" style={{ color: "rgba(236,232,225,0.5)" }}>
            Your save is fully independent — AI teams, matches, and stats are isolated to your career.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: "rgba(236,232,225,0.5)" }}>
            Team name
          </span>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            required
            className="rounded px-3 py-2 text-[14px] text-white"
            style={{ background: "#0F0F14", border: "1px solid rgba(255,255,255,0.1)" }}
            placeholder="Fnatic"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: "rgba(236,232,225,0.5)" }}>
            Tag
          </span>
          <input
            value={teamTag}
            onChange={(e) => setTeamTag(e.target.value)}
            required
            maxLength={5}
            className="rounded px-3 py-2 text-[14px] uppercase text-white"
            style={{ background: "#0F0F14", border: "1px solid rgba(255,255,255,0.1)" }}
            placeholder="FNC"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: "rgba(236,232,225,0.5)" }}>
            Region
          </span>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as (typeof REGIONS)[number])}
            className="rounded px-3 py-2 text-[14px] text-white"
            style={{ background: "#0F0F14", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <div className="rounded px-3 py-2 text-[12px]" style={{ background: "rgba(255,70,85,0.1)", color: "#FF4655" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={createSave.isPending}
          className="rounded px-4 py-3 text-[12px] font-medium uppercase tracking-[0.2em] text-white disabled:opacity-50"
          style={{ background: "#FF4655" }}
        >
          {createSave.isPending ? "Creating…" : "Start"}
        </button>
      </form>
    </div>
  );
}
