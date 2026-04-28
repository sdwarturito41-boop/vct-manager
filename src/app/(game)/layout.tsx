import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TRPCProvider } from "@/components/TRPCProvider";
import { TopNav } from "@/components/TopNav";
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

  // Multi-save guard: user must have a save to enter the game.
  // No save → send them to create one.
  const save = await prisma.save.findUnique({
    where: { userId: session.user.id! },
    select: { id: true },
  });
  if (!save) {
    redirect("/new-save");
  }

  // User's team within this save
  const team = await prisma.team.findFirst({
    where: { saveId: save.id, isPlayerTeam: true },
    select: { id: true, name: true, tag: true, budget: true, region: true },
  });
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
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </TRPCProvider>
  );
}
