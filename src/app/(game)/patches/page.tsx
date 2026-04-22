"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { getAgentByName } from "@/constants/agents";
import { D } from "@/constants/design";

export default function PatchesPage() {
  const { data: current } = trpc.patch.getCurrentPatch.useQuery(undefined, { retry: false });
  const { data: all = [] } = trpc.patch.listPatches.useQuery(undefined, { retry: false });

  const currentBuffs = current?.buffs ?? [];
  const currentNerfs = current?.nerfs ?? [];

  return (
    <div className="flex min-h-full flex-col">
      {/* ── Hero ── */}
      <section
        className="px-10 pt-8 pb-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <div
              className="text-[11px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              Agent Balance
            </div>
            <h1
              className="mt-1 text-[34px] font-medium uppercase leading-none tracking-[0.05em]"
              style={{ color: D.textPrimary }}
            >
              Patches
            </h1>
            {current ? (
              <div
                className="mt-2 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.2em]"
                style={{ color: D.textMuted }}
              >
                <span style={{ color: D.red }}>
                  Season {current.season}
                </span>
                <span>·</span>
                <span>{current.stage.replace(/_/g, " ")}</span>
              </div>
            ) : (
              <div
                className="mt-2 text-[11px] font-medium uppercase tracking-[0.2em]"
                style={{ color: D.textSubtle }}
              >
                No patch active
              </div>
            )}
          </div>

          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end">
              <span
                className="text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                Buffed
              </span>
              <span
                className="mt-1 text-[22px] font-medium tabular-nums"
                style={{ color: D.green }}
              >
                {currentBuffs.length}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span
                className="text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                Nerfed
              </span>
              <span
                className="mt-1 text-[22px] font-medium tabular-nums"
                style={{ color: D.red }}
              >
                {currentNerfs.length}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Current patch: 2 columns Buffs / Nerfs ── */}
      {!current ? (
        <section className="px-10 py-16">
          <div className="text-center text-[12px]" style={{ color: D.textSubtle }}>
            No patch active yet. The first patch will drop at the next stage transition.
          </div>
        </section>
      ) : (
        <section
          className="grid grid-cols-2"
          style={{ borderBottom: `1px solid ${D.border}` }}
        >
          <AgentColumn
            title="Buffs"
            tone="green"
            agents={currentBuffs}
            direction="up"
            showBorder
          />
          <AgentColumn
            title="Nerfs"
            tone="red"
            agents={currentNerfs}
            direction="down"
          />
        </section>
      )}

      {/* ── Patch history ── */}
      <section className="flex flex-col">
        <div
          className="flex items-center justify-between px-10 py-4"
          style={{ borderBottom: `1px solid ${D.borderFaint}` }}
        >
          <span
            className="text-[10px] font-medium uppercase tracking-[0.3em]"
            style={{ color: D.textSubtle }}
          >
            Patch History
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
            style={{ color: D.textMuted }}
          >
            {all.length} patches
          </span>
        </div>

        {all.length === 0 ? (
          <div className="px-10 py-8 text-[12px]" style={{ color: D.textSubtle }}>
            No patches yet.
          </div>
        ) : (
          <div className="flex flex-col">
            {all.map((p) => (
              <PatchRow key={p.id} patch={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AgentColumn({
  title,
  tone,
  agents,
  direction,
  showBorder,
}: {
  title: string;
  tone: "green" | "red";
  agents: string[];
  direction: "up" | "down";
  showBorder?: boolean;
}) {
  const color = tone === "green" ? D.green : D.red;
  return (
    <div
      className="flex flex-col"
      style={showBorder ? { borderRight: `1px solid ${D.border}` } : undefined}
    >
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: `1px solid ${D.borderFaint}` }}
      >
        <span
          className="text-[10px] font-medium uppercase tracking-[0.3em]"
          style={{ color }}
        >
          {title}
        </span>
        <span
          className="text-[10px] font-medium tabular-nums"
          style={{ color: D.textSubtle }}
        >
          {agents.length}
        </span>
      </div>

      {agents.length === 0 ? (
        <div className="px-6 py-5 text-[12px]" style={{ color: D.textSubtle }}>
          —
        </div>
      ) : (
        <div className="flex flex-col">
          {agents.map((name) => {
            const a = getAgentByName(name);
            return (
              <div
                key={name}
                className="flex items-center gap-3 px-6 py-3"
                style={{ borderBottom: `1px solid ${D.borderFaint}` }}
              >
                {a?.portraitUrl ? (
                  <img
                    src={a.portraitUrl}
                    alt={name}
                    className="h-8 w-8 shrink-0 rounded object-cover"
                    style={{ background: D.card }}
                  />
                ) : (
                  <div
                    className="h-8 w-8 shrink-0 rounded"
                    style={{ background: D.card }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div
                    className="truncate text-[13px] font-medium"
                    style={{ color: D.textPrimary }}
                  >
                    {name}
                  </div>
                  <div
                    className="text-[10px] uppercase tracking-[0.2em]"
                    style={{ color: D.textSubtle }}
                  >
                    {a?.role ?? "—"}
                  </div>
                </div>
                <span
                  className="text-[14px] font-medium tabular-nums"
                  style={{ color }}
                >
                  {direction === "up" ? "▲" : "▼"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PatchRow({
  patch,
}: {
  patch: {
    id: string;
    season: number;
    stage: string;
    createdAt: Date | string;
    buffs: string[];
    nerfs: string[];
  };
}) {
  const [open, setOpen] = useState(false);
  const buffs = patch.buffs;
  const nerfs = patch.nerfs;

  return (
    <div style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-10 py-4 text-left transition-colors"
        style={{ background: open ? D.hoverBg : "transparent" }}
      >
        <div className="flex items-center gap-6">
          <span
            className="text-[22px] font-medium uppercase tracking-[0.05em]"
            style={{ color: D.textPrimary }}
          >
            S{patch.season}
          </span>
          <div className="flex flex-col">
            <span
              className="text-[11px] font-medium uppercase tracking-[0.2em]"
              style={{ color: D.textPrimary }}
            >
              {patch.stage.replace(/_/g, " ")}
            </span>
            <span
              className="text-[10px] uppercase tracking-[0.2em]"
              style={{ color: D.textSubtle }}
            >
              {new Date(patch.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: D.green }}
            />
            <span
              className="text-[11px] font-medium tabular-nums"
              style={{ color: D.textMuted }}
            >
              {buffs.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: D.red }}
            />
            <span
              className="text-[11px] font-medium tabular-nums"
              style={{ color: D.textMuted }}
            >
              {nerfs.length}
            </span>
          </div>
          <span
            className="text-[10px] font-medium uppercase tracking-[0.2em]"
            style={{ color: D.textSubtle }}
          >
            {open ? "Hide" : "View"}
          </span>
        </div>
      </button>

      {open && (
        <div
          className="grid grid-cols-2"
          style={{ borderTop: `1px solid ${D.borderFaint}` }}
        >
          <InlineAgentList
            label="Buffed"
            tone="green"
            agents={buffs}
            direction="up"
            showBorder
          />
          <InlineAgentList
            label="Nerfed"
            tone="red"
            agents={nerfs}
            direction="down"
          />
        </div>
      )}
    </div>
  );
}

function InlineAgentList({
  label,
  tone,
  agents,
  direction,
  showBorder,
}: {
  label: string;
  tone: "green" | "red";
  agents: string[];
  direction: "up" | "down";
  showBorder?: boolean;
}) {
  const color = tone === "green" ? D.green : D.red;
  return (
    <div
      className="flex flex-col gap-2 px-10 py-4"
      style={showBorder ? { borderRight: `1px solid ${D.borderFaint}` } : undefined}
    >
      <span
        className="text-[10px] font-medium uppercase tracking-[0.3em]"
        style={{ color }}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {agents.length === 0 ? (
          <span className="text-[12px]" style={{ color: D.textSubtle }}>
            —
          </span>
        ) : (
          agents.map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium"
              style={{
                background: D.card,
                color: D.textPrimary,
                border: `1px solid ${D.borderFaint}`,
              }}
            >
              <span style={{ color }}>
                {direction === "up" ? "▲" : "▼"}
              </span>
              {n}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
