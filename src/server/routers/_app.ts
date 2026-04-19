import { router } from "../trpc";
import { teamRouter } from "./team";
import { playerRouter } from "./player";
import { matchRouter } from "./match";
import { seasonRouter } from "./season";
import { leagueRouter } from "./league";
import { trainingRouter } from "./training";
import { vetoRouter } from "./veto";

export const appRouter = router({
  team: teamRouter,
  player: playerRouter,
  match: matchRouter,
  season: seasonRouter,
  league: leagueRouter,
  training: trainingRouter,
  veto: vetoRouter,
});

export type AppRouter = typeof appRouter;
