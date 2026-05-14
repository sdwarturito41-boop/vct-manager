"use client";

import { trpc } from "@/lib/trpc-client";
import { D } from "@/constants/design";

/**
 * Star button — adds/removes a player to/from the user team's shortlist.
 * Used in market rows + player detail pages. Triggers the scouting reveal
 * cycle: 4 weeks of weekly ticks → potential becomes visible.
 */
export function ShortlistButton({
  playerId,
  size = "sm",
}: {
  playerId: string;
  size?: "sm" | "md";
}) {
  const utils = trpc.useUtils();
  const statusQ = trpc.scouting.isShortlisted.useQuery({ playerId });
  const isShortlisted = statusQ.data ?? false;

  const addMut = trpc.scouting.add.useMutation({
    onSuccess: () => {
      utils.scouting.isShortlisted.invalidate({ playerId });
      utils.scouting.list.invalidate();
    },
  });
  const removeMut = trpc.scouting.remove.useMutation({
    onSuccess: () => {
      utils.scouting.isShortlisted.invalidate({ playerId });
      utils.scouting.list.invalidate();
    },
  });

  const pending = addMut.isPending || removeMut.isPending;
  const dim = size === "sm" ? 14 : 18;
  const padding = size === "sm" ? "px-2 py-1.5" : "px-2.5 py-2";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (pending) return;
        if (isShortlisted) removeMut.mutate({ playerId });
        else addMut.mutate({ playerId });
      }}
      title={isShortlisted ? "Remove from shortlist" : "Add to shortlist (scout)"}
      className={`rounded ${padding} transition-colors`}
      style={{
        background: isShortlisted ? "rgba(239,159,39,0.12)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${isShortlisted ? D.amber : D.borderFaint}`,
        cursor: pending ? "wait" : "pointer",
        opacity: pending ? 0.6 : 1,
      }}
    >
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 24 24"
        fill={isShortlisted ? D.amber : "none"}
        stroke={isShortlisted ? D.amber : D.textMuted}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}
