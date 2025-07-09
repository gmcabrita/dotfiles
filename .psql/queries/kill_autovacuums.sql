select
    pg_terminate_backend(pid),
    query,
    now() - pg_stat_activity.query_start as duration
from pg_stat_activity
where query ilike 'autovacuum:%'
;
