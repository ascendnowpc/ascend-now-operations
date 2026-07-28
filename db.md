# Ascend Now — Database Documentation

This file used to contain a full copy of the live database state. It was a duplicate of `db/docs/VERIFIED_DATABASE_STATE.md`, and the two copies had already drifted apart (both were dated June 23, 2026 and described only 6 tables, while the live database has since grown to 25). Keeping two copies of the same fast-moving document is exactly how that drift happens, so this file is now a pointer instead of a second copy.

**For the current, verified schema, see [`db/docs/VERIFIED_DATABASE_STATE.md`](./db/docs/VERIFIED_DATABASE_STATE.md).**

That file also explains *why* the schema had drifted from documentation (two overlapping migration systems, an empty Supabase migration-history table) and what to do differently going forward.
