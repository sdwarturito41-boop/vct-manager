"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";

type Region = "EMEA" | "Americas" | "Pacific" | "China";
const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];

export default function NewSavePage() {
  const router = useRouter();
  const [selectedRegion, setSelectedRegion] = useState<Region>("EMEA");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableTeams = trpc.save.availableTeams.useQuery();
  const createSave = trpc.save.create.useMutation({
    onSuccess: () => router.push("/dashboard"),
    onError: (e) => setError(e.message),
  });

  const teamsInRegion = (availableTeams.data ?? []).filter((t) => t.region === selectedRegion);
  const selectedTeam = availableTeams.data?.find((t) => t.id === selectedTeamId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedTeam) {
      setError("Pick a team first.");
      return;
    }
    createSave.mutate({
      teamName: selectedTeam.name,
      teamTag: selectedTeam.tag,
      region: selectedTeam.region,
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F0F14] p-6">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-4xl flex-col gap-6 rounded-lg p-8"
        style={{ background: "#13131A", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div>
          <h1 className="text-[22px] font-medium uppercase tracking-[0.2em] text-white">
            Start Career
          </h1>
          <p className="mt-1 text-[12px]" style={{ color: "rgba(236,232,225,0.5)" }}>
            Pick a team to manage. Your save is fully isolated — AI teams, matches, and stats are independent per career.
          </p>
        </div>

        {/* Region tabs */}
        <div className="flex gap-2">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setSelectedRegion(r);
                setSelectedTeamId(null);
              }}
              className="rounded px-4 py-2 text-[11px] font-medium uppercase tracking-[0.2em]"
              style={{
                background: selectedRegion === r ? "#FF4655" : "rgba(255,255,255,0.05)",
                color: "white",
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Team grid */}
        <div
          className="grid gap-2 overflow-y-auto"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", maxHeight: 340 }}
        >
          {availableTeams.isLoading && (
            <div className="col-span-full text-center text-[12px]" style={{ color: "rgba(236,232,225,0.4)" }}>
              Loading teams…
            </div>
          )}
          {!availableTeams.isLoading && teamsInRegion.length === 0 && (
            <div className="col-span-full text-center text-[12px]" style={{ color: "rgba(236,232,225,0.4)" }}>
              No teams in this region — DB not seeded yet.
            </div>
          )}
          {teamsInRegion.map((t) => {
            const isSelected = t.id === selectedTeamId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTeamId(t.id)}
                className="flex items-center gap-3 rounded p-3 text-left transition-all"
                style={{
                  background: isSelected ? "rgba(255,70,85,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isSelected ? "#FF4655" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                {t.logoUrl ? (
                  <img src={t.logoUrl} alt={t.name} className="h-8 w-8 shrink-0 object-contain" />
                ) : (
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[10px] font-medium"
                    style={{ background: "rgba(255,255,255,0.08)", color: "white" }}
                  >
                    {t.tag}
                  </div>
                )}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium text-white">{t.name}</span>
                  <span
                    className="text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: "rgba(236,232,225,0.45)" }}
                  >
                    {t.tag}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="rounded px-3 py-2 text-[12px]" style={{ background: "rgba(255,70,85,0.1)", color: "#FF4655" }}>
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="text-[12px]" style={{ color: "rgba(236,232,225,0.55)" }}>
            {selectedTeam ? (
              <>Playing as <span style={{ color: "white", fontWeight: 500 }}>{selectedTeam.name}</span></>
            ) : (
              "Pick a team to continue"
            )}
          </div>
          <button
            type="submit"
            disabled={createSave.isPending || !selectedTeam}
            className="rounded px-5 py-3 text-[12px] font-medium uppercase tracking-[0.2em] text-white disabled:opacity-40"
            style={{ background: "#FF4655" }}
          >
            {createSave.isPending ? "Creating…" : "Start career"}
          </button>
        </div>
      </form>
    </div>
  );
}
