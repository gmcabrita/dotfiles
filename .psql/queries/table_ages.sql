select
    c.oid::regclass,
    age(c.relfrozenxid),
    pg_size_pretty(pg_total_relation_size(c.oid))
from pg_class c
join pg_namespace n on c.relnamespace = n.oid
where relkind in ('r', 't', 'm') and n.nspname not in ('pg_toast')
order by 2 desc
limit 20
;
