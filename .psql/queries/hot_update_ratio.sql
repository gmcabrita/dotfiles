select
    relname as table_name,
    seq_scan as seq_scans,
    idx_scan as index_scans,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_hot_upd as hot_updates,
    round((n_tup_hot_upd / n_tup_upd::numeric) * 100, 2) as hot_update_pct
from pg_stat_user_tables
where n_tup_upd > 0
order by hot_updates desc
;
