SELECT
  relname AS table_name,
  seq_scan AS seq_scans,
  idx_scan AS index_scans,
  n_tup_ins AS inserts,
  n_tup_upd AS updates,
  n_tup_hot_upd AS hot_updates,
  ROUND((n_tup_hot_upd / n_tup_upd::numeric) * 100, 2) AS hot_update_pct
FROM pg_stat_user_tables
WHERE n_tup_upd > 0
ORDER BY hot_updates DESC;
