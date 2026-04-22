import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TRPCProvider } from "@/components/TRPCProvider";
import { SidebarNav } from "@/components/SidebarNav";

export default async function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login");
  }

  const team = await prisma.team.findUnique({
    where: { userId: session.user.id! },
    select: { id: true, name: true, tag: true, budget: true, region: true },
  });

  if (!team) {
    redirect("/onboarding");
  }

  return (
    <TRPCProvider>
      <div
        className="flex h-screen overflow-hidden"
        style={{
          background: "#0F0F14",
          fontFamily: "Inter, system-ui, sans-serif",
          color: "#ECE8E1",
        }}
      >
        <SidebarNav />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </TRPCProvider>
  );
}
