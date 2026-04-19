"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [csrfToken, setCsrfToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/csrf", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setCsrfToken(data.csrfToken);
      })
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setError("Invalid credentials. Please try again.");
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--val-red)]/5 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--val-white)]/40 transition-colors hover:text-[var(--val-red)]"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>

        <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-8">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-black uppercase tracking-[0.15em] text-[var(--val-white)]">
              VCT <span className="text-[var(--val-red)]">Manager</span>
            </h1>
            <p className="mt-2 text-xs uppercase tracking-[0.1em] text-[var(--val-white)]/40">
              {mode === "signin" ? "Welcome back, agent" : "Join the circuit"}
            </p>
          </div>

          <div className="mb-6 flex rounded border border-[var(--val-gray)] bg-[var(--val-bg)]">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-[0.15em] transition-all ${
                mode === "signin"
                  ? "bg-[var(--val-red)] text-white"
                  : "text-[var(--val-white)]/40 hover:text-[var(--val-white)]/60"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-[0.15em] transition-all ${
                mode === "signup"
                  ? "bg-[var(--val-red)] text-white"
                  : "text-[var(--val-white)]/40 hover:text-[var(--val-white)]/60"
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Native HTML form — submits directly to NextAuth */}
          <form
            method="POST"
            action="/api/auth/callback/credentials"
            className="space-y-4"
          >
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="callbackUrl" value="/dashboard" />

            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/40"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full rounded border border-[var(--val-gray)] bg-[var(--val-bg)] px-4 py-3 text-sm text-[var(--val-white)] placeholder-[var(--val-white)]/20 outline-none transition-colors focus:border-[var(--val-red)]"
                placeholder="agent@valorant.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/40"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="w-full rounded border border-[var(--val-gray)] bg-[var(--val-bg)] px-4 py-3 text-sm text-[var(--val-white)] placeholder-[var(--val-white)]/20 outline-none transition-colors focus:border-[var(--val-red)]"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded border border-[var(--val-red)]/30 bg-[var(--val-red)]/10 px-4 py-2 text-xs text-[var(--val-red)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded bg-[var(--val-red)] py-3 text-sm font-bold uppercase tracking-[0.15em] text-white transition-all hover:bg-[var(--val-red)]/90 hover:shadow-lg hover:shadow-[var(--val-red)]/25 disabled:opacity-50"
            >
              {mode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
