const BASE_URL = "https://api.pandascore.co/valorant";

function getToken(): string {
  const token = process.env.PANDASCORE_TOKEN;
  if (!token) throw new Error("PANDASCORE_TOKEN not set");
  return token;
}

async function fetchPS<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    throw new Error(`PandaScore ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export interface PSPlayer {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  nationality: string | null;
  age: number | null;
  birthday: string | null;
  image_url: string | null;
  role: string | null;
  active: boolean;
  slug: string;
}

export interface PSTeam {
  id: number;
  name: string;
  acronym: string | null;
  location: string | null;
  image_url: string | null;
  dark_mode_image_url: string | null;
  players: PSPlayer[];
  slug: string;
}

export async function fetchTeamByName(name: string): Promise<PSTeam | null> {
  const teams = await fetchPS<PSTeam[]>("/teams", {
    "search[name]": name,
    per_page: "5",
  });
  return teams.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? teams[0] ?? null;
}

export async function fetchTeamsByNames(names: string[]): Promise<Map<string, PSTeam>> {
  const results = new Map<string, PSTeam>();
  for (const name of names) {
    const team = await fetchTeamByName(name);
    if (team) results.set(name, team);
    await sleep(200);
  }
  return results;
}

export async function fetchPlayerById(id: number): Promise<PSPlayer | null> {
  try {
    const players = await fetchPS<PSPlayer[]>("/players", {
      "filter[id]": String(id),
      per_page: "1",
    });
    return players[0] ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
