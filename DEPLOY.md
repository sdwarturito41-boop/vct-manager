# Deploy to alwaysdata

## 1. Database (PostgreSQL)

Already created:
- **DB name** : `mmibetmaster_vct`
- **Host** : `postgresql-mmibetmaster.alwaysdata.net`
- **Port** : `5432` (default)
- **User / password** : from alwaysdata dashboard

## 2. Environment variables

On the server (`~/vct-manager/.env`) :

```bash
DATABASE_URL="postgresql://USER:PASSWORD@postgresql-mmibetmaster.alwaysdata.net:5432/mmibetmaster_vct?schema=public"
NEXTAUTH_SECRET="GENERATE_WITH_openssl_rand_-base64_32"
NEXTAUTH_URL="https://yourdomain.alwaysdata.net"
AUTH_TRUST_HOST="true"
```

Generate `NEXTAUTH_SECRET` with: `openssl rand -base64 32`

> ⚠️ If alwaysdata requires SSL : append `&sslmode=require` to the URL.

## 3. SSH deploy flow

```bash
# First deploy
ssh mmibetmaster@ssh-mmibetmaster.alwaysdata.net
git clone <YOUR_REPO> vct-manager
cd vct-manager
npm ci
npx prisma generate
npx prisma migrate deploy    # creates all tables from scratch on Postgres
npx tsx --env-file=.env scripts/seed.ts   # seed VctTeamTemplate + presets
npm run build
# Start via alwaysdata's Node.js site config (point at `npm start`)
```

Subsequent deploys:
```bash
cd ~/vct-manager
git pull
npm ci
npx prisma migrate deploy
npm run build
# Restart the Node site in alwaysdata panel
```

## 4. Multi-save status (as of this commit)

**What works**:
- `Save` model with cascade delete on user removal
- `save.current`, `save.create`, `save.delete` tRPC endpoints
- `/new-save` page for creating a save
- `saveProcedure` middleware (opt-in — not yet applied to existing routers)

**What's TODO** (follow-up PRs):
- Scope all queries by `saveId` (team, match, season, league, sponsor, market, etc.)
- Replace `/onboarding` with `/new-save` flow + add layout guard
- Seed players + Kickoff schedule per save inside `initializeSaveWorld`
- Delete-save button in settings UI
- `saveId` → required once all routers migrated (currently optional for backward-compat)

Until the follow-ups ship, multiple users may step on each other's world state. The
infrastructure is in place; refactoring queries is mechanical but repetitive.

## 5. Useful commands

```bash
# Reset a user's stats (single-user legacy flow)
npx tsx --env-file=.env scripts/reset-user-stats.ts

# List all users
npx tsx --env-file=.env scripts/list-users.ts

# Regenerate prisma client after schema changes
npx prisma generate

# Apply new migration
npx prisma migrate dev --name <description>     # dev
npx prisma migrate deploy                       # prod
```
