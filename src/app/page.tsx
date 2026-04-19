import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      {/* Background gradient effects */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--val-red)]/10 blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-[400px] w-[600px] -translate-x-1/3 rounded-full bg-[var(--val-red)]/5 blur-[100px]" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(var(--val-white) 1px, transparent 1px), linear-gradient(90deg, var(--val-white) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center">
        {/* Small tag */}
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--val-red)]/30 bg-[var(--val-red)]/10 px-4 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--val-red)] animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--val-red)]">
            Season 2026
          </span>
        </div>

        {/* Main title */}
        <h1 className="text-6xl font-black uppercase tracking-[0.15em] text-[var(--val-white)] sm:text-7xl md:text-8xl lg:text-9xl">
          VCT
          <br />
          <span className="text-[var(--val-red)]">Manager</span>
        </h1>

        {/* Tagline */}
        <p className="max-w-lg text-lg font-medium uppercase tracking-[0.1em] text-[var(--val-white)]/50">
          Manage your VCT team. Dominate the circuit.
        </p>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <div className="h-px w-16 bg-[var(--val-red)]/40" />
          <div className="h-1.5 w-1.5 rotate-45 bg-[var(--val-red)]" />
          <div className="h-px w-16 bg-[var(--val-red)]/40" />
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/auth/login"
            className="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded bg-[var(--val-red)] px-8 text-sm font-bold uppercase tracking-[0.15em] text-white transition-all hover:bg-[var(--val-red)]/90 hover:shadow-lg hover:shadow-[var(--val-red)]/25"
          >
            Sign In
            <span className="absolute inset-0 -translate-x-full bg-white/10 transition-transform group-hover:translate-x-full" />
          </Link>

          <Link
            href="/auth/login"
            className="inline-flex h-12 items-center justify-center rounded border border-[var(--val-gray)] bg-[var(--val-surface)] px-8 text-sm font-bold uppercase tracking-[0.15em] text-[var(--val-white)] transition-all hover:border-[var(--val-red)]/40 hover:bg-[var(--val-surface)]/80"
          >
            Create Account
          </Link>
        </div>
      </div>

      {/* Bottom accent line */}
      <div className="absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent via-[var(--val-red)] to-transparent opacity-30" />
    </div>
  );
}
