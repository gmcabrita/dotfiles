select
    pid,
    now() - pg_stat_activity.xact_start as duration,
    query,
    state,
    wait_event,
    wait_event_type,
    pg_blocking_pids(pid),
    usename,
    application_name,
    client_addr
from pg_stat_activity
where (now() - pg_stat_activity.xact_start) > interval '30 seconds'
order by 2 desc
;
