SELECT
  relname as table,
  sum(idx_blks_read) as idx_read,
  sum(idx_blks_hit)  as idx_hit,
  ROUND((sum(idx_blks_hit) / NULLIF((sum(idx_blks_hit) + sum(idx_blks_read)), 0)::numeric) * 100, 2) as ratio
FROM pg_statio_user_indexes
WHERE idx_blks_read > 0
GROUP BY relname
ORDER BY ratio DESC;
