with
    cte_fsync_client_backend_io as (
        select sum(fsyncs) fsync_client_backend_io
        from pg_stat_io
        where backend_type = 'client backend'
    ),
    cte_fsync_total_io as (select sum(fsyncs) fsync_total_io from pg_stat_io)
select
    round(
        ((select fsync_client_backend_io from cte_fsync_client_backend_io) * 100)
        / (select fsync_total_io from cte_fsync_total_io),
        2
    ) as io_backend_fsync_activity_pct
;
