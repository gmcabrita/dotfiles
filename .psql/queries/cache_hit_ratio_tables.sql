select
    relname as table,
    sum(heap_blks_read) as heap_read,
    sum(heap_blks_hit) as heap_hit,
    round(
        (
            sum(heap_blks_hit)
            / nullif((sum(heap_blks_hit) + sum(heap_blks_read)), 0)::numeric
        )
        * 100,
        2
    ) as ratio
from pg_statio_user_tables
where heap_blks_read > 0
group by relname
order by ratio desc
;
