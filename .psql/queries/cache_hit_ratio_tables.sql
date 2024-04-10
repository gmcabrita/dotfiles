SELECT
  relname as table,
  sum(heap_blks_read) as heap_read,
  sum(heap_blks_hit)  as heap_hit,
  ROUND((sum(heap_blks_hit) / NULLIF((sum(heap_blks_hit) + sum(heap_blks_read)), 0)::numeric) * 100, 2) as ratio
FROM pg_statio_user_tables
WHERE heap_blks_read > 0
GROUP BY relname
ORDER BY ratio DESC;
