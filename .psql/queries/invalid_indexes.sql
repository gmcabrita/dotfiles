select
    coalesce(nullif(pn.nspname, 'public') || '.', '') || pct.relname as "relation_name",
    pci.relname as index_name,
    pn.nspname as schema_name,
    pct.relname as table_name,
    pg_size_pretty(pg_relation_size(pidx.indexrelid)) index_size,
    format(
        'DROP INDEX CONCURRENTLY %s; -- %s, table %s',
        pidx.indexrelid::regclass::text,
        'Invalid index',
        pct.relname
    ) as drop_code,
    replace(
        format('%s; -- table %s', pg_get_indexdef(pidx.indexrelid), pct.relname),
        'CREATE INDEX',
        'CREATE INDEX CONCURRENTLY'
    ) as revert_code
from pg_index pidx
join pg_class as pci on pci.oid = pidx.indexrelid
join pg_class as pct on pct.oid = pidx.indrelid
left join pg_namespace pn on pn.oid = pct.relnamespace
where pidx.indisvalid = false
;
