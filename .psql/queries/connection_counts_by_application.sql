select application_name, state, count(*)
from pg_stat_activity
group by application_name, state
;
