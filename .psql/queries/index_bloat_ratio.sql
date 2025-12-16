select
    c.relname as index_name,
    pg_size_pretty(pg_relation_size(c.oid)) as actual_size,
    pg_size_pretty((c.reltuples * 40)::bigint) as expected_size,
    round((pg_relation_size(c.oid) / nullif(c.reltuples * 40, 0))::numeric, 1) as bloat_ratio
from pg_class c
join pg_index i on c.oid = i.indexrelid
join pg_am am on c.relam = am.oid
left join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'i'
  and c.reltuples > 0
  and c.relname not like 'pg_%'
  and am.amname = 'btree'  -- filter for b-tree only
  and pg_relation_size(c.oid) > 512 * 1024 * 1024 -- only indexes >512 MB
order by bloat_ratio desc nulls last;
