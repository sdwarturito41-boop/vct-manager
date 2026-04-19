import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TRPCProvider } from "@/components/TRPCProvider";

export default async function MatchDayLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  return <TRPCProvider><div className="min-h-screen" style={{ background: "#0a0a0f" }}>{children}</div></TRPCProvider>;
}
