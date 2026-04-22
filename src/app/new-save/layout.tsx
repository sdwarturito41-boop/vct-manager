import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TRPCProvider } from "@/components/TRPCProvider";

// Force dynamic rendering (not prerendered) — /new-save uses tRPC client which
// needs a runtime provider context.
export const dynamic = "force-dynamic";

export default async function NewSaveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login");
  }
  return <TRPCProvider>{children}</TRPCProvider>;
}
