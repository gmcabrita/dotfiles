---
name: cloudsql-metrics
description: Query Cloud SQL for PostgreSQL system metrics (CPU, memory, disk, connections, TPS) and Query Insights data (top queries, per-tag/controller time, latency percentiles, lock and IO time) with PromQL through Cloud Monitoring. Use when asked for DB metrics, slow or expensive queries, "db insights", or "query insights" on a Cloud SQL instance such as ampledash-prod-N.
---

# Cloud SQL metrics via Cloud Monitoring PromQL

Query Cloud SQL system metrics and Query Insights through Cloud Monitoring's
Prometheus API, authenticated with the user's gcloud login. The only permission it needs is
`monitoring.timeSeries.list` on the project.

## Running queries

```bash
S=~/.agents/skills/cloudsql-metrics/scripts/promql.sh
$S ampledash-prod '<promql>'                          # instant
$S ampledash-prod '<promql>' START END 300s           # range; START/END are RFC3339 or unix ts
```

The script prints the raw JSON response. Use `jq` to filter it, for example
`jq -r '.data.result[] | "\(.value[1])\t\(.metric)"'`.

## Authentication

The script uses `gcloud auth print-access-token`, so it runs as the active gcloud
account. The agent cannot log in: login opens a browser and needs the user. When
auth fails, stop, tell the user which case applies and what command to run, and
wait for them to confirm before you retry.

| Symptom | Cause | What the user runs |
|---|---|---|
| Script exits 3 with `gcloud has no valid credentials`, or a direct gcloud call says `Reauthentication failed` | Login expired or missing | `gcloud auth login` in their own terminal (it opens a browser) |
| HTTP 401 / `UNAUTHENTICATED` | Token expired mid-session | `gcloud auth login` |
| HTTP 403 / `PERMISSION_DENIED` on `monitoring.timeSeries.list` | Wrong active account, or the account lacks access | `gcloud auth list` to check the account (should be their `@amplemarket.com` one), then `gcloud config set account <account>`. If the account is right, they need `roles/monitoring.viewer` on the project from a GCP admin. |

To check the setup before querying, run `gcloud auth list` and
`gcloud auth print-access-token >/dev/null && echo ok`.

Application Default Credentials (`gcloud auth application-default login`) are
not used here. Do not ask the user to set them up or to set a quota project.

Metric names contain `/` and `.`, so use the quoted selector form:
`{"__name__"="cloudsql.googleapis.com/...", ...}`.

## Finding instances

- Amplemarket ampledash: project `ampledash-prod` (staging: `ampledash-staging`),
  region `us-central1`. Instances are `ampledash-prod-N` with replicas
  `ampledash-prod-N-replicaNN`. To list them, run
  `rg -n 'name: ampledash-prod' ~/Developer/Amplemarket/ampledash-infra/infra/Pulumi.production.yaml`
  or `gcloud sql instances list --project ampledash-prod`.

## Two monitored resources with different labels

| Data | `monitored_resource` | Instance label |
|---|---|---|
| System metrics (`database/cpu`, `database/memory`, `database/disk`, `database/postgresql/*`) | `cloudsql_database` | `database_id="PROJECT:INSTANCE"` |
| Query Insights (`database/postgresql/insights/*`) | `cloudsql_instance_database` | `resource_id="PROJECT:INSTANCE"` |

If you use the wrong label, the query returns an empty result with no error.

## System metrics

Use this selector, substituting the metric:

```
{"__name__"="cloudsql.googleapis.com/database/<METRIC>","monitored_resource"="cloudsql_database","database_id"="ampledash-prod:ampledash-prod-3"}
```

| Question | PromQL (`SEL(metric)` is the selector above) |
|---|---|
| CPU avg / peak over 1h (0–1 fraction) | `avg(avg_over_time(SEL(cpu/utilization)[1h]))`, `max(max_over_time(SEL(cpu/utilization)[1h]))` |
| vCPUs | `max(SEL(cpu/reserved_cores))` |
| Connections by state | `sum by (state)(SEL(postgresql/num_backends_by_state))` |
| Connections by application | `sum by (application)(SEL(postgresql/num_backends_by_application))` |
| Memory % by component | `avg by (component)(avg_over_time(SEL(memory/components)[15m]))` |
| Disk used / quota (GiB) | `sum(SEL(disk/bytes_used_by_data_type))/1024^3`, `max(SEL(disk/quota))/1024^3` |
| Transactions/s | `sum(rate(SEL(postgresql/transaction_count)[10m]))` |
| XID wraparound (0–1) | `max(SEL(postgresql/transaction_id_utilization))` |
| Backends waiting, by event | `sum by (wait_event_type, wait_event)(SEL(postgresql/backends_in_wait))` |
| Oldest unvacuumed xact age | `max by (oldest_transaction_type)(SEL(postgresql/vacuum/oldest_transaction_age))` |
| Deadlocks | `sum(increase(SEL(postgresql/deadlock_count)[1h]))` |
| Temp bytes written | `sum(increase(SEL(postgresql/temp_bytes_written_count)[1h]))` |
| Replica lag (seconds, run against the replica) | `max(SEL(replication/replica_lag))` |

To find any other metric, list the descriptors:

```bash
curl -s "https://monitoring.googleapis.com/v3/projects/ampledash-prod/metricDescriptors?filter=metric.type%3Dstarts_with(%22cloudsql.googleapis.com/database/postgresql%22)" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" | jq -r '.metricDescriptors[].type'
```

## Query Insights

Use this selector:

```
{"__name__"="cloudsql.googleapis.com/database/postgresql/insights/<SCOPE>/<METRIC>","monitored_resource"="cloudsql_instance_database","resource_id"="ampledash-prod:ampledash-prod-3"}
```

The three scopes expose the same metrics:
`execution_time`, `io_time`, `lock_time`, `row_count`, `shared_blk_access_count`, `latencies`.

- `aggregate` has labels `user` and `client_addr`.
- `perquery` adds `query_hash` and `querystring` (normalized SQL, possibly truncated).
- `pertag` adds the sqlcommenter tags `application`, `controller`, `action`,
  `route`, `framework`, `db_driver`, and `tag_hash`.

These are cumulative counters, so wrap them in `increase(...[window])` or
`rate(...)`. All time metrics, including `latencies`, are in microseconds.
`latencies` is a distribution. Query it as `latencies_bucket`, `latencies_sum`,
or `latencies_count`. The bare name returns an empty result.

| Question | PromQL (`SEL(...)` is the selector above) |
|---|---|
| Top queries by total time, 1h | `topk(10, sum by (query_hash, querystring)(increase(SEL(perquery/execution_time)[1h])))` |
| Top controller#action by total time | `topk(10, sum by (controller, action)(increase(SEL(pertag/execution_time)[1h])))` |
| Top queries by lock time | `topk(10, sum by (query_hash, querystring)(increase(SEL(perquery/lock_time)[1h])))` |
| Top queries by rows | `topk(10, sum by (query_hash, querystring)(increase(SEL(perquery/row_count)[1h])))` |
| p99 latency for one query (add `"query_hash"="<hash>"` to SEL) | `histogram_quantile(0.99, sum by (le)(rate(SEL(perquery/latencies_bucket)[10m])))` |
| Instance-wide p99 | `histogram_quantile(0.99, sum by (le)(rate(SEL(aggregate/latencies_bucket)[10m])))` |
| Mean latency | `sum(rate(SEL(aggregate/latencies_sum)[10m])) / sum(rate(SEL(aggregate/latencies_count)[10m]))` |
| Calls/s per query | `topk(10, sum by (query_hash, querystring)(rate(SEL(perquery/latencies_count)[10m])))` |

To filter on a single query, add `"query_hash"="<hash>"` to the selector. `topk`
does not sort its output, so sort the values with `jq` or `sort -rn`. To put
execution time in perspective, compare it with the instance's capacity:
`vCPUs × window_seconds`.

## Reporting

- Convert units: microseconds to seconds or ms, bytes to GiB (1024-based), and
  0–1 fractions to %.
- State the aggregation and window used, for example "avg over 1h" or "max
  5-minute window".
- Flag anything that needs attention: disk above ~90% of quota, many
  `idle in transaction` backends, high XID utilization, or sustained CPU above 80%.
