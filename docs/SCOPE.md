# SCOPE & ARCHITECTURAL ADJUSTMENTS

## Single Database Mode (Current Milestone)

In this implementation stage, the system operates on a single PostgreSQL database instance instead of multi-database sharding (`rota-a` and `rota-b`).

### Key Decisions:
1. **Skipped Shard Directory Tables:**
   - `team_directory` is bypassed.
   - `user_team_index` is bypassed.
2. **Direct Membership Queries:**
   - Membership lookups and user clinic lists (`GET /v1/me`) query the `memberships` table directly, joining with `teams` where needed.
3. **Data Integrity & Foreign Keys:**
   - Team-owned models relate directly within the single database.
   - Team isolation is strictly enforced via the `forTeam` isolation helper and server middleware (`resolveTeam`, `requireMembership`).
