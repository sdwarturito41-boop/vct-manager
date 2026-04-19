import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TRPCProvider } from "@/components/TRPCProvider";

export default async function OnboardingLayout({
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
    select: { id: true },
  });

  if (team) {
    redirect("/dashboard");
  }

  return <TRPCProvider>{children}</TRPCProvider>;
}
