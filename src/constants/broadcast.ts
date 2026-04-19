import type { Region } from "@/generated/prisma/client";

// Match broadcast times in CET (Central European Time)
// These are displayed in the UI for flavor

export interface BroadcastSlot {
  matchIndex: number; // 0 = first match of day, 1 = second
  timeCET: string;
  timeLocal: string;
  timezone: string;
}

export const BROADCAST_SCHEDULE: Record<Region, {
  days: number[];       // 1=Mon..7=Sun
  label: string;        // e.g. "Wed · Thu · Fri"
  slots: BroadcastSlot[];
  flavor: string;       // short description for UI
}> = {
  EMEA: {
    days: [2, 3, 4, 5],
    label: "Tue · Wed · Thu · Fri",
    slots: [
      { matchIndex: 0, timeCET: "17:00", timeLocal: "17:00", timezone: "CET" },
      { matchIndex: 1, timeCET: "19:00", timeLocal: "19:00", timezone: "CET" },
    ],
    flavor: "Afternoon & evening CET",
  },
  Pacific: {
    days: [4, 5, 6, 7],
    label: "Thu · Fri · Sat · Sun",
    slots: [
      { matchIndex: 0, timeCET: "08:00", timeLocal: "15:00", timezone: "KST" },
      { matchIndex: 1, timeCET: "10:00", timeLocal: "17:00", timezone: "KST" },
    ],
    flavor: "Morning CET · Afternoon KST/SGT",
  },
  China: {
    days: [4, 5, 6, 7],
    label: "Thu · Fri · Sat · Sun",
    slots: [
      { matchIndex: 0, timeCET: "09:00", timeLocal: "16:00", timezone: "CST" },
      { matchIndex: 1, timeCET: "11:00", timeLocal: "18:00", timezone: "CST" },
    ],
    flavor: "Morning CET · Afternoon CST",
  },
  Americas: {
    days: [5, 6, 7],
    label: "Fri · Sat · Sun",
    slots: [
      { matchIndex: 0, timeCET: "23:00", timeLocal: "17:00", timezone: "EST" },
      { matchIndex: 1, timeCET: "01:00", timeLocal: "19:00", timezone: "EST" },
    ],
    flavor: "Late night CET · Evening EST",
  },
};

export function getMatchTime(region: Region, matchIndex: number): string {
  const schedule = BROADCAST_SCHEDULE[region];
  const slot = schedule.slots[matchIndex] ?? schedule.slots[0];
  return `${slot.timeLocal} ${slot.timezone}`;
}

export function getMatchTimeCET(region: Region, matchIndex: number): string {
  const schedule = BROADCAST_SCHEDULE[region];
  const slot = schedule.slots[matchIndex] ?? schedule.slots[0];
  return `${slot.timeCET} CET`;
}
