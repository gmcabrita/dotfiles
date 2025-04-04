select pg_size_pretty(sum(rss) * 1000) as total_memory_overhead
from pg_proctab()
;
