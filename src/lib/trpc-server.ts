import { appRouter } from "@/server/routers/_app";
import { createTRPCContext } from "@/server/trpc";

export const serverTrpc = async () => {
  const ctx = await createTRPCContext();
  return appRouter.createCaller(ctx);
};
