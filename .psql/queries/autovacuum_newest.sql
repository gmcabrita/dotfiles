select relname, last_vacuum, last_autovacuum
from pg_stat_user_tables
where last_autovacuum is not null
order by last_autovacuum asc
;
