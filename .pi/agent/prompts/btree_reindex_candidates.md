Find bloated btree indexes on every production PostgreSQL primary database and reindex them with `amplmkt`.

## 1. Check authentication

Run `amplmkt auth status`. If there is no active session, stop and tell the user to run `amplmkt auth login`. Do not run it yourself. If any later `amplmkt` command fails with an authentication error, stop and give the same instruction.

## 2. Enumerate targets

1. `amplmkt db list --env production --format json` lists instances.
2. Keep only instances whose `kind` is `cloudsql`. Skip `starrocks` and `timescaledb`.
3. Skip every instance whose name matches `amplmkt-gcp-prod-usce1-cluster*`.
4. Skip replicas: drop names containing `replica`, then confirm each remaining instance with `select pg_is_in_recovery();` and skip any that return `t`.
5. For each instance, list its databases:
   `amplmkt db connect --instance $instance -- -X -At -c "select datname from pg_database where datallowconn and not datistemplate and datname not in ('cloudsqladmin', 'rdsadmin');"`

## 3. Find candidates

Run the candidate query on every (instance, database) pair:

```
amplmkt db connect --instance $instance --database $database -- -X -A -F $'\t' -f ~/.psql/queries/btree_reindex_candidates.sql
```

`:btree_reindex_candidates` in `~/.psqlrc` holds this file's contents. Use `-f` because psql does not expand variables inside `-c`. Do not edit the query or its thresholds.

The query returns `tbl` and `idx` but no schema. Before reindexing, look up the schema for each index:
`select schemaname from pg_indexes where indexname = '$idx' and tablename = '$tbl';`

Before starting any reindex, show the user the full candidate list grouped by instance and database, with `real_size`, `bloat_size_pretty`, and `bloat_pct`. Then proceed without waiting for approval.

## 4. Reindex

For each candidate:

1. Start it: `amplmkt db reindex --instance $instance --database $database --schema $schema --index $idx --format json`. Take the reindex operation id from the output.
2. Wait for it: `amplmkt db reindex watch --id $id --interval 30s`. It exits nonzero if the reindex fails.

Concurrency rules:

- Within one database, run reindexes in parallel only when they target different tables. Never run two reindexes on the same table at once; queue them.
- Never run more than 3 reindexes at once in one database. Start the next queued one when a running one finishes.
- Different instances may run in parallel.
- Never retry. If `amplmkt db reindex` errors, or `watch` reports failure, record the error and move on to the next index.

## 5. Report

When all candidates are done, print a table with columns instance, database, schema, table, index, size before, bloat before, reindex id, and result (succeeded, failed with error, or not started with error). Also list any instances or databases that could not be queried and why.
