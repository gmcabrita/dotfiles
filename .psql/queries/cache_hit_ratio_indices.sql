select
    relname as table,
    sum(idx_blks_read) as idx_read,
    sum(idx_blks_hit) as idx_hit,
    round(
        (
            sum(idx_blks_hit)
            / nullif((sum(idx_blks_hit) + sum(idx_blks_read)), 0)::numeric
        )
        * 100,
        2
    ) as ratio
from pg_statio_user_indexes
where idx_blks_read > 0
group by relname
order by ratio desc
;
