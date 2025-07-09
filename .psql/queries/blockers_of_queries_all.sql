select
    a1.pid,
    a1.usename,
    (now() - a1.query_start) as running_time,
    pg_blocking_pids(a1.pid) as blocked_by,
    a1.query as blocked_query,
    a2.query as blocking_query
from pg_stat_activity as a1
inner join
    pg_stat_activity as a2
    on (a2.pid = (pg_blocking_pids(a1.pid)::integer [])[1])
where cardinality(pg_blocking_pids(a1.pid)) > 0
;
