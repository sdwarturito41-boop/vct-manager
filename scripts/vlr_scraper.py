"""
VCT roster + agent scraper for vlr.gg
---------------------------------------
Scrapes the 4 VCT Kickoff 2026 event pages to discover all 48 teams,
then visits each team + player page to extract:
- Roster (starters only)
- Per-player top 3 agents (based on most recent VCT matches)
- Inferred role from the dominant agent category

Output: data/vct_2026_rosters.json + data/vct_2026_rosters.csv

Usage:
    pip install requests beautifulsoup4 lxml
    python vlr_scraper.py

Respects vlr.gg by using a 1.5s delay between requests.
Expect ~15 minutes runtime for all 48 teams.
"""

import csv
import json
import re
import time
from collections import Counter
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://www.vlr.gg"
HEADERS = {"User-Agent": "Mozilla/5.0 (VCT roster compiler / personal project)"}
DELAY = 1.5  # seconds between requests

# The 4 Kickoff 2026 events
KICKOFF_EVENTS = {
    "Americas": 2682,
    "EMEA": 2684,
    "Pacific": 2683,
    "China": 2685,
}

# Agent -> role mapping
AGENT_ROLES = {
    "jett": "Duelist", "raze": "Duelist", "phoenix": "Duelist",
    "reyna": "Duelist", "yoru": "Duelist", "neon": "Duelist",
    "iso": "Duelist", "waylay": "Duelist",
    "brimstone": "Controller", "omen": "Controller", "viper": "Controller",
    "astra": "Controller", "harbor": "Controller", "clove": "Controller",
    "miks": "Controller",
    "killjoy": "Sentinel", "cypher": "Sentinel", "sage": "Sentinel",
    "chamber": "Sentinel", "deadlock": "Sentinel", "vyse": "Sentinel",
    "sova": "Initiator", "breach": "Initiator", "skye": "Initiator",
    "kayo": "Initiator", "fade": "Initiator", "gekko": "Initiator",
    "tejo": "Initiator",
}

session = requests.Session()
session.headers.update(HEADERS)


def get(url: str) -> BeautifulSoup:
    time.sleep(DELAY)
    r = session.get(url, timeout=20)
    r.raise_for_status()
    return BeautifulSoup(r.text, "lxml")


def discover_teams(event_id: int) -> list[tuple[int, str]]:
    soup = get(f"{BASE}/event/{event_id}/")
    teams = {}
    for a in soup.select('a[href^="/team/"]'):
        m = re.match(r"/team/(\d+)/([^/]+)", a.get("href", ""))
        if not m:
            continue
        tid = int(m.group(1))
        name = a.get_text(strip=True) or m.group(2).replace("-", " ").title()
        if name and tid not in teams:
            teams[tid] = name
    return sorted(teams.items(), key=lambda x: x[1].lower())


def get_roster(team_id: int) -> tuple[str, list[tuple[int, str]]]:
    soup = get(f"{BASE}/team/{team_id}/")
    name_tag = soup.find("h1", class_="wf-title")
    team_name = name_tag.get_text(strip=True) if name_tag else f"Team {team_id}"

    players = []
    for item in soup.select(".team-roster-item"):
        role_label = item.select_one(".wf-tag") or item.select_one(".team-roster-item-name-role")
        if role_label and any(x in role_label.get_text(strip=True).lower() for x in ("coach", "manager", "staff")):
            continue
        link = item.select_one('a[href^="/player/"]')
        if not link:
            continue
        m = re.match(r"/player/(\d+)/([^/]+)", link.get("href", ""))
        if not m:
            continue
        pid = int(m.group(1))
        handle_el = item.select_one(".team-roster-item-name-alias") or link
        handle = handle_el.get_text(strip=True).split("\n")[0]
        players.append((pid, handle))
    return team_name, players[:5]


def get_player_agents(player_id: int) -> list[str]:
    soup = get(f"{BASE}/player/{player_id}/")
    agents = []
    for img in soup.select('img[src*="/game/agents/"]'):
        src = img.get("src", "")
        m = re.search(r"/game/agents/([a-z0-9]+)\.png", src)
        if m:
            agents.append(m.group(1))
    counts = Counter(agents)
    return [a for a, _ in counts.most_common()]


def infer_role(top_agents: list[str]) -> str:
    for agent in top_agents[:3]:
        if agent in AGENT_ROLES:
            return AGENT_ROLES[agent]
    return "Flex"


def main() -> None:
    all_rows: list[dict] = []

    for region, event_id in KICKOFF_EVENTS.items():
        print(f"\n=== {region} ===")
        teams = discover_teams(event_id)
        print(f"  Found {len(teams)} teams")

        for team_id, _ in teams:
            try:
                team_name, roster = get_roster(team_id)
            except Exception as e:
                print(f"  ! roster fetch failed for team {team_id}: {e}")
                continue
            print(f"  {team_name} ({len(roster)} players)")

            for player_id, handle in roster:
                try:
                    agents = get_player_agents(player_id)
                except Exception as e:
                    print(f"    ! {handle}: {e}")
                    continue
                top3 = agents[:3]
                role = infer_role(top3)
                all_rows.append({
                    "region": region,
                    "team": team_name,
                    "player": handle,
                    "role": role,
                    "agent_1": top3[0] if len(top3) > 0 else "",
                    "agent_2": top3[1] if len(top3) > 1 else "",
                    "agent_3": top3[2] if len(top3) > 2 else "",
                })

    role_order = {"Duelist": 0, "Controller": 1, "Sentinel": 2, "Initiator": 3, "Flex": 4}
    all_rows.sort(key=lambda r: (
        list(KICKOFF_EVENTS).index(r["region"]),
        r["team"].lower(),
        role_order.get(r["role"], 9),
        r["player"].lower(),
    ))

    out_dir = Path("data")
    out_dir.mkdir(exist_ok=True)

    json_path = out_dir / "vct_2026_rosters.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(all_rows, f, indent=2, ensure_ascii=False)

    csv_path = out_dir / "vct_2026_rosters.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["region", "team", "player", "role", "agent_1", "agent_2", "agent_3"]
        )
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\n✔ Wrote {len(all_rows)} rows to:")
    print(f"    {json_path}")
    print(f"    {csv_path}")


if __name__ == "__main__":
    main()
