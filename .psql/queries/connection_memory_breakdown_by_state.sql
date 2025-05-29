with
    process_data as (
        select
            pid,
            pg_size_pretty(rss * 1000) as memory_overhead,
            fullcomm as command,
            rss,
            case
                when fullcomm ilike '%idle in transaction%'
                then 'idle in transaction'
                when fullcomm ilike '%idle%'
                then 'idle'
                when fullcomm ilike '%BIND%'
                then 'BIND'
                when fullcomm ilike '%PARSE%'
                then 'PARSE'
                when fullcomm ilike '%INSERT waiting%'
                then 'INSERT waiting'
                when fullcomm ilike '%INSERT%'
                then 'INSERT'
                when fullcomm ilike '%UPDATE waiting%'
                then 'UPDATE waiting'
                when fullcomm ilike '%UPDATE%'
                then 'UPDATE'
                when fullcomm ilike '%SELECT waiting%'
                then 'SELECT waiting'
                when fullcomm ilike '%SELECT%'
                then 'SELECT'
                when fullcomm ilike '%DELETE waiting%'
                then 'DELETE waiting'
                when fullcomm ilike '%DELETE%'
                then 'DELETE'
                when fullcomm ilike '%COMMIT waiting%'
                then 'COMMIT waiting'
                when fullcomm ilike '%COMMIT%'
                then 'COMMIT'
                when fullcomm ilike '%CREATE INDEX%'
                then 'CREATE INDEX'
                when fullcomm ilike '%REINDEX%'
                then 'REINDEX'
                when fullcomm ilike '%START_REPLICATION%'
                then 'START_REPLICATION'
                when fullcomm ilike '%REFRESH MATERIALIZED VIEW%'
                then 'REFRESH MATERIALIZED VIEW'
                else fullcomm
            end as connection_state_or_command
        from pg_proctab()
    )
select
    connection_state_or_command,
    count(*) as process_count,
    pg_size_pretty(sum(rss * 1000)) as total_mem,
    pg_size_pretty(
        (percentile_cont(0.5) within group (order by rss * 1000))::bigint
    ) as p50_mem,
    pg_size_pretty(
        (percentile_cont(0.95) within group (order by rss * 1000))::bigint
    ) as p95_mem,
    pg_size_pretty(
        (percentile_cont(0.99) within group (order by rss * 1000))::bigint
    ) as p99_mem
from process_data
group by connection_state_or_command
order by sum(rss) desc
;
