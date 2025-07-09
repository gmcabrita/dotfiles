select
    state,
    count(*)
from pg_stat_activity
group by state
;
