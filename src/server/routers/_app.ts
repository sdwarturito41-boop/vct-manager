import { router } from "../trpc";
import { teamRouter } from "./team";
import { playerRouter } from "./player";
import { matchRouter } from "./match";
import { seasonRouter } from "./season";
import { leagueRouter } from "./league";
import { trainingRouter } from "./training";
import { vetoRouter } from "./veto";
import { scrimRouter } from "./scrim";
import { transferRouter } from "./transfer";
import { sponsorRouter } from "./sponsor";
import { coachRouter } from "./coach";
import { playstyleRouter } from "./playstyle";
import { patchRouter } from "./patch";
import { messageRouter } from "./message";

export const appRouter = router({
  team: teamRouter,
  player: playerRouter,
  match: matchRouter,
  season: seasonRouter,
  league: leagueRouter,
  training: trainingRouter,
  veto: vetoRouter,
  scrim: scrimRouter,
  transfer: transferRouter,
  sponsor: sponsorRouter,
  coach: coachRouter,
  playstyle: playstyleRouter,
  patch: patchRouter,
  message: messageRouter,
});

export type AppRouter = typeof appRouter;
