select
    c.relname as index_name,
    pg_size_pretty(pg_relation_size(c.oid)) as actual_size,
    pg_size_pretty((c.reltuples * 40)::bigint) as expected_size,
    round((pg_relation_size(c.oid) / nullif(c.reltuples * 40, 0))::numeric, 1)
        as bloat_ratio
from pg_class c
join pg_index i on c.oid = i.indexrelid
where
    c.relkind = 'i'
    and c.reltuples > 0
    and c.relname not like 'pg_%'
    and pg_relation_size(c.oid) > 256 * 1024 * 1024  -- only indexes > 256 MB
order by bloat_ratio desc nulls last;
