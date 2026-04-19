"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { useRouter } from "next/navigation";

const REGIONS = ["EMEA", "Americas", "Pacific", "China"] as const;

interface TeamTemplate {
  name: string;
  tag: string;
  region: string;
  budget: number;
  prestige: number;
  logoUrl: string | null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<TeamTemplate | null>(null);
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");

  const { data: templates } = trpc.team.getTemplates.useQuery(
    { region: selectedRegion as string },
    { enabled: !!selectedRegion }
  );

  const createTeam = trpc.team.create.useMutation({
    onSuccess: () => router.push("/dashboard"),
    onError: (err) => setError(err.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--val-bg)" }}>
      <div className="max-w-4xl w-full">
        <h1
          className="text-4xl font-bold tracking-widest uppercase mb-2 text-center"
          style={{ color: "var(--val-white)" }}
        >
          Choose Your Team
        </h1>
        <p className="text-center mb-10" style={{ color: "var(--val-gray)" }}>
          {step === 1 ? "Select a region to start" : "Pick the team you want to manage"}
        </p>

        {step === 1 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {REGIONS.map((region) => (
              <button
                key={region}
                onClick={() => {
                  setSelectedRegion(region);
                  setStep(2);
                }}
                className="p-6 rounded-lg border-2 transition-all duration-200 hover:scale-105 cursor-pointer"
                style={{
                  background: "var(--val-surface)",
                  borderColor: selectedRegion === region ? "var(--val-red)" : "var(--val-gray)",
                  color: "var(--val-white)",
                }}
              >
                <div className="text-2xl font-bold tracking-wider">{region}</div>
                <div className="text-sm mt-1" style={{ color: "var(--val-gray)" }}>
                  12 teams
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && templates && (
          <>
            <button
              onClick={() => { setStep(1); setSelectedTeam(null); }}
              className="mb-6 text-sm underline cursor-pointer"
              style={{ color: "var(--val-gray)" }}
            >
              ← Back to regions
            </button>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
              {templates.map((t: TeamTemplate) => (
                <button
                  key={t.name}
                  onClick={() => {
                    setSelectedTeam(t);
                    setTeamName(t.name);
                  }}
                  className="p-4 rounded-lg border-2 text-left transition-all duration-200 hover:scale-102 cursor-pointer"
                  style={{
                    background: "var(--val-surface)",
                    borderColor: selectedTeam?.name === t.name ? "var(--val-red)" : "var(--val-gray)",
                    color: "var(--val-white)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    {t.logoUrl ? (
                      <img
                        src={t.logoUrl}
                        alt={t.name}
                        className="h-10 w-10 object-contain"
                      />
                    ) : (
                      <div
                        className="h-10 w-10 rounded flex items-center justify-center text-xs font-bold"
                        style={{ background: "var(--val-gray)", color: "var(--val-white)" }}
                      >
                        {t.tag}
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-bold tracking-wide">{t.name}</span>
                        <span
                          className="text-xs px-2 py-1 rounded font-mono"
                          style={{ background: "var(--val-gray)", color: "var(--val-white)" }}
                        >
                          {t.tag}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 mt-3 text-sm" style={{ color: "var(--val-gray)" }}>
                    <span>💰 ${(t.budget / 1000000).toFixed(1)}M</span>
                    <span>⭐ {t.prestige}</span>
                  </div>
                </button>
              ))}
            </div>

            {selectedTeam && (
              <div
                className="p-6 rounded-lg border-2 mb-4"
                style={{ background: "var(--val-surface)", borderColor: "var(--val-red)" }}
              >
                <h2 className="text-xl font-bold mb-4" style={{ color: "var(--val-white)" }}>
                  Confirm: Manage {selectedTeam.name}
                </h2>
                <div className="flex gap-6 mb-4 text-sm" style={{ color: "var(--val-gray)" }}>
                  <span>Region: {selectedRegion}</span>
                  <span>Budget: ${(selectedTeam.budget / 1000000).toFixed(1)}M</span>
                  <span>Prestige: {selectedTeam.prestige}/100</span>
                </div>
                {error && (
                  <p className="text-sm mb-3" style={{ color: "var(--val-red)" }}>{error}</p>
                )}
                <button
                  onClick={() =>
                    createTeam.mutate({
                      name: teamName,
                      tag: selectedTeam.tag,
                      region: selectedRegion as "EMEA" | "Americas" | "Pacific" | "China",
                      templateTeamName: selectedTeam.name,
                    })
                  }
                  disabled={createTeam.isPending}
                  className="px-8 py-3 rounded font-bold uppercase tracking-wider transition-opacity cursor-pointer"
                  style={{ background: "var(--val-red)", color: "white", opacity: createTeam.isPending ? 0.5 : 1 }}
                >
                  {createTeam.isPending ? "Creating..." : "Start Career"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
