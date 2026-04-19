import { create } from "zustand";

interface GameStore {
  currentDay: number;
  currentStage: string;
  setDay: (day: number) => void;
  setStage: (stage: string) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  currentDay: 1,
  currentStage: "KICKOFF",
  setDay: (day) => set({ currentDay: day }),
  setStage: (stage) => set({ currentStage: stage }),
}));
