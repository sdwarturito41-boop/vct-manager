import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TRPCProvider } from "@/components/TRPCProvider";
import { TopNav } from "@/components/TopNav";
import { SubNav } from "@/components/SubNav";
import { D } from "@/constants/design";

export const dynamic = "force-dynamic";

export default async function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login");
  }

  // Parallelize save + team lookups — both depend only on userId, so there's
  // no reason to serialize. Saves one RT to Neon on every page load.
  const userId = session.user.id!;
  const [save, team] = await Promise.all([
    prisma.save.findUnique({
      where: { userId },
      select: { id: true },
    }),
    prisma.team.findFirst({
      where: { userId, isPlayerTeam: true },
      select: { id: true, name: true, tag: true, budget: true, region: true },
    }),
  ]);
  if (!save) {
    redirect("/new-save");
  }
  if (!team) {
    // Save exists but no player team — corrupted state, recreate.
    redirect("/new-save");
  }

  return (
    <TRPCProvider>
      <div
        className="flex h-screen flex-col overflow-hidden"
        style={{
          background: D.bg,
          fontFamily: "Inter, system-ui, sans-serif",
          color: D.textPrimary,
          fontWeight: 400,
        }}
      >
        <TopNav />
        <SubNav />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </TRPCProvider>
  );
}
