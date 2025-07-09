with
cte_vacuum_io as (
    select sum(reads) + sum(writes) + sum(extends) vacuum_io
    from pg_stat_io
    where
        backend_type = 'autovacuum worker'
        or (context = 'vacuum' and (reads <> 0 or writes <> 0 or extends <> 0))
),

cte_total_io as (
    select sum(reads) + sum(writes) + sum(extends) total_io from pg_stat_io
)

select
    round(
        ((select vacuum_io from cte_vacuum_io) * 100)
        / (select total_io from cte_total_io),
        2
    ) as io_vacuum_activity_pct
;
