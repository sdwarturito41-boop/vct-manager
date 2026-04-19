import { serverTrpc } from "@/lib/trpc-server";
import { BracketView } from "@/components/BracketView";
import { prisma } from "@/lib/prisma";
import { VCT_STAGES } from "@/constants/vct-format";
import type { StageId } from "@/constants/vct-format";

export default async function LeaguePage() {
  const api = await serverTrpc();

  let season;
  try { season = await api.season.getCurrent(); } catch {
    return <p className="py-16 text-center text-[var(--val-white)]/40">No active season.</p>;
  }

  const schedule = await api.season.getSchedule();
  const team = await api.team.get();

  const templates = await prisma.vctTeamTemplate.findMany({ select: { name: true, logoUrl: true } });
  const allTeams = await prisma.team.findMany({ select: { name: true, logoUrl: true } });
  const teamNameToLogo: Record<string, string | null> = {};
  for (const t of templates) teamNameToLogo[t.name] = t.logoUrl;
  for (const t of allTeams) if (t.logoUrl) teamNameToLogo[t.name] = t.logoUrl;

  // Check if we have Kickoff matches (current or completed)
  const hasKickoffMatches = schedule.some((m) => m.stageId.startsWith("KICKOFF"));
  const kickoffComplete = hasKickoffMatches && schedule.filter((m) => m.stageId.startsWith("KICKOFF")).every((m) => m.isPlayed);

  const currentStageName = season.currentStage in VCT_STAGES
    ? VCT_STAGES[season.currentStage as StageId].name
    : season.currentStage;

  const regions = ["EMEA", "Americas", "Pacific", "China"] as const;
  const byRegion = new Map<string, typeof schedule>();
  for (const r of regions) byRegion.set(r, []);
  for (const m of schedule) byRegion.get(m.team1.region)?.push(m);

  const orderedRegions = [team.region, ...regions.filter((r) => r !== team.region)];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black uppercase tracking-[0.15em] text-[var(--val-white)]">
          {hasKickoffMatches ? "Kickoff 2026" : currentStageName}
        </h1>
        <p className="mt-1 text-sm uppercase tracking-[0.1em] text-[var(--val-white)]/30">
          {hasKickoffMatches ? "Triple Elimination · Top 3 → Masters" : "Coming soon"}
        </p>
      </div>

      {kickoffComplete && season.currentStage !== "KICKOFF" && (
        <div className="rounded-lg border border-[var(--val-gold)]/30 bg-[var(--val-gold)]/10 p-5 text-center">
          <div className="text-lg font-black uppercase tracking-[0.15em] text-[var(--val-gold)]">
            Kickoff Complete
          </div>
          <p className="mt-1 text-sm text-[var(--val-white)]/40">
            {currentStageName} is next — schedule coming soon. Bracket below shows final Kickoff results.
          </p>
        </div>
      )}

      {hasKickoffMatches && orderedRegions.map((region) => (
        <BracketView
          key={region}
          matches={byRegion.get(region) ?? []}
          userTeamId={team.id}
          region={region}
          isUserRegion={region === team.region}
          teamNameToLogo={teamNameToLogo}
        />
      ))}

      {!hasKickoffMatches && (
        <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-16 text-center">
          <p className="text-[var(--val-white)]/30">No matches scheduled yet for {currentStageName}.</p>
        </div>
      )}
    </div>
  );
}
