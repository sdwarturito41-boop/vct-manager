"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { D } from "@/constants/design";

const CATEGORY_COLORS: Record<string, string> = {
  MATCH: D.red,
  PLAYER: D.blue,
  COACH: D.purple,
  SPONSOR: D.gold,
  BOARD: D.amber,
  MARKET: D.green,
  NEWS: D.textMuted,
  MEDIA: D.textMuted,
};

type MessageRow = {
  id: string;
  category: string;
  fromName: string;
  fromRole: string;
  subject: string;
  body: string;
  eventType: string | null;
  eventData: unknown;
  isRead: boolean;
  requiresAction: boolean;
  actionResolved: boolean;
  actionResult: string | null;
  week: number;
  season: number;
  createdAt: string | Date;
};

export default function InboxPage() {
  const utils = trpc.useUtils();
  const { data: messagesRaw = [] } = trpc.message.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const messages = messagesRaw as unknown as MessageRow[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "actions">("all");

  const markRead = trpc.message.markRead.useMutation({
    onSuccess: () => utils.message.invalidate(),
  });
  const markAllRead = trpc.message.markAllRead.useMutation({
    onSuccess: () => utils.message.invalidate(),
  });
  const resolveAction = trpc.message.resolveAction.useMutation({
    onSuccess: () => utils.message.invalidate(),
  });
  const deleteMsg = trpc.message.delete.useMutation({
    onSuccess: () => {
      utils.message.invalidate();
      setSelectedId(null);
    },
  });

  const filtered = messages.filter((m) => {
    if (filter === "unread") return !m.isRead;
    if (filter === "actions") return m.requiresAction && !m.actionResolved;
    return true;
  });

  const selected = messages.find((m) => m.id === selectedId) ?? filtered[0] ?? null;

  // Auto-mark as read on select
  function handleSelect(id: string) {
    setSelectedId(id);
    const msg = messages.find((m) => m.id === id);
    if (msg && !msg.isRead) markRead.mutate({ messageId: id });
  }

  const unreadCount = messages.filter((m) => !m.isRead).length;
  const actionsCount = messages.filter((m) => m.requiresAction && !m.actionResolved).length;

  return (
    <div className="flex min-h-full flex-col">
      {/* ── Hero ── */}
      <section
        className="flex items-end justify-between px-10 pt-8 pb-5"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div>
          <div
            className="text-[11px] font-medium "
            style={{ color: D.textSubtle }}
          >
            Manager
          </div>
          <h1
            className="mt-1 text-[34px] font-medium leading-none "
            style={{ color: D.textPrimary }}
          >
            Inbox
          </h1>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex flex-col items-end">
            <span
              className="text-[10px] font-medium "
              style={{ color: D.textSubtle }}
            >
              Unread
            </span>
            <span className="text-[22px] font-medium tabular-nums" style={{ color: unreadCount > 0 ? D.red : D.textPrimary }}>
              {unreadCount}
            </span>
          </div>
          <button
            onClick={() => markAllRead.mutate()}
            disabled={unreadCount === 0 || markAllRead.isPending}
            className="rounded px-4 py-2 text-[11px] font-medium transition-colors"
            style={{
              background: "transparent",
              border: `1px solid ${D.borderStrong}`,
              color: unreadCount === 0 ? D.textFaint : D.textMuted,
              cursor: unreadCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            Mark all read
          </button>
        </div>
      </section>

      {/* ── Filters ── */}
      <section className="flex gap-2 px-10 py-3" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
        {(["all", "unread", "actions"] as const).map((f) => {
          const isActive = filter === f;
          const count = f === "unread" ? unreadCount : f === "actions" ? actionsCount : messages.length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                background: isActive ? "rgba(255,255,255,0.9)" : "transparent",
                color: isActive ? "#0a0a14" : D.textMuted,
                border: isActive ? "none" : `1px solid ${D.border}`,
              }}
            >
              {f}
              <span className="tabular-nums" style={{ color: isActive ? "rgba(10,10,20,0.5)" : D.textSubtle }}>
                {count}
              </span>
            </button>
          );
        })}
      </section>

      {/* ── Split view: list + detail ── */}
      <section className="grid flex-1 grid-cols-[360px_1fr] min-h-0">
        {/* Message list */}
        <div
          className="flex min-h-0 flex-col overflow-y-auto"
          style={{ borderRight: `1px solid ${D.border}` }}
        >
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-[12px]" style={{ color: D.textSubtle }}>
              No messages.
            </div>
          ) : (
            filtered.map((msg) => {
              const isSelected = selected?.id === msg.id;
              const catColor = CATEGORY_COLORS[msg.category] ?? D.textMuted;
              return (
                <button
                  key={msg.id}
                  onClick={() => handleSelect(msg.id)}
                  className="flex flex-col gap-1 px-5 py-3 text-left transition-colors"
                  style={{
                    borderBottom: `1px solid ${D.borderFaint}`,
                    background: isSelected ? "rgba(255,255,255,0.04)" : msg.isRead ? "transparent" : "rgba(255,70,85,0.03)",
                    borderLeft: isSelected ? `2px solid ${D.red}` : "2px solid transparent",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[9px] font-medium "
                      style={{ color: catColor }}
                    >
                      {msg.category}
                    </span>
                    {!msg.isRead && (
                      <div className="h-1.5 w-1.5 rounded-full" style={{ background: D.red }} />
                    )}
                    {msg.requiresAction && !msg.actionResolved && (
                      <span
                        className="ml-auto rounded px-1.5 py-0.5 text-[8px] font-medium "
                        style={{ background: "rgba(239,159,39,0.15)", color: D.amber, border: "1px solid rgba(239,159,39,0.3)" }}
                      >
                        Action
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[13px] font-medium" style={{ color: msg.isRead ? D.textMuted : D.textPrimary }}>
                    {msg.subject}
                  </div>
                  <div className="flex items-center gap-2 text-[10px]" style={{ color: D.textSubtle }}>
                    <span>{msg.fromName}</span>
                    <span>·</span>
                    <span className="">W{msg.week}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail pane */}
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-[13px]" style={{ color: D.textSubtle }}>
              Select a message
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex flex-col gap-3 px-8 py-6" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-medium "
                    style={{ color: CATEGORY_COLORS[selected.category] ?? D.textMuted }}
                  >
                    {selected.category}
                  </span>
                  <span style={{ color: D.textFaint }}>·</span>
                  <span className="text-[10px] " style={{ color: D.textSubtle }}>
                    Week {selected.week} · Season {selected.season}
                  </span>
                </div>
                <h2 className="text-[24px] font-medium leading-tight" style={{ color: D.textPrimary }}>
                  {selected.subject}
                </h2>
                <div className="flex items-center gap-3 text-[12px]" style={{ color: D.textMuted }}>
                  <span style={{ color: D.textPrimary }}>{selected.fromName}</span>
                  <span style={{ color: D.textFaint }}>·</span>
                  <span>{selected.fromRole}</span>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 px-8 py-6">
                <div
                  className="whitespace-pre-wrap text-[13px] leading-[1.65]"
                  style={{ color: D.textPrimary, opacity: 0.85 }}
                >
                  {selected.body}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between gap-3 px-8 py-5" style={{ borderTop: `1px solid ${D.borderFaint}` }}>
                <div className="flex gap-2">
                  {selected.requiresAction && !selected.actionResolved ? (
                    <>
                      <button
                        onClick={() => resolveAction.mutate({ messageId: selected.id, result: "accepted" })}
                        disabled={resolveAction.isPending}
                        className="rounded px-5 py-2 text-[11px] font-medium transition-colors"
                        style={{
                          background: "rgba(76,175,125,0.12)",
                          color: D.green,
                          border: "1px solid rgba(76,175,125,0.3)",
                        }}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => resolveAction.mutate({ messageId: selected.id, result: "rejected" })}
                        disabled={resolveAction.isPending}
                        className="rounded px-5 py-2 text-[11px] font-medium transition-colors"
                        style={{
                          background: "rgba(255,70,85,0.1)",
                          color: D.red,
                          border: "1px solid rgba(255,70,85,0.25)",
                        }}
                      >
                        Reject
                      </button>
                    </>
                  ) : selected.actionResolved ? (
                    <div
                      className="rounded px-4 py-2 text-[10px] font-medium "
                      style={{ background: "rgba(255,255,255,0.04)", color: D.textSubtle }}
                    >
                      Resolved: {selected.actionResult}
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={() => deleteMsg.mutate({ messageId: selected.id })}
                  disabled={deleteMsg.isPending}
                  className="rounded px-4 py-2 text-[10px] font-medium transition-colors"
                  style={{
                    background: "transparent",
                    color: D.textSubtle,
                    border: `1px solid ${D.border}`,
                  }}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
