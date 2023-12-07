select blockers.pid, blockers.usename, blockers.query_start, blockers.query
from pg_stat_activity blockers
inner join
    (
        select pg_blocking_pids(pid) blocking_pids
        from pg_stat_activity
        where pid != pg_backend_pid() and query like 'ALTER TABLE%'
    ) my_query
    on blockers.pid = any (my_query.blocking_pids)
;
