select pid, pg_size_pretty(rss * 1000) as memory_overhead, fullcomm as command
from pg_proctab()
order by rss desc
;
