with
    raw_data as (
        select
            pg_namespace.nspname,
            pg_class.relname,
            pg_class.oid as relid,
            pg_class.reltuples,
            pg_stat_all_tables.n_dead_tup,
            pg_stat_all_tables.n_mod_since_analyze,
            (
                select split_part(x, '=', 2)
                from unnest(pg_class.reloptions) q(x)
                where x ~ '^autovacuum_analyze_scale_factor='
            ) as c_analyze_factor,
            (
                select split_part(x, '=', 2)
                from unnest(pg_class.reloptions) q(x)
                where x ~ '^autovacuum_analyze_threshold='
            ) as c_analyze_threshold,
            (
                select split_part(x, '=', 2)
                from unnest(pg_class.reloptions) q(x)
                where x ~ '^autovacuum_vacuum_scale_factor='
            ) as c_vacuum_factor,
            (
                select split_part(x, '=', 2)
                from unnest(pg_class.reloptions) q(x)
                where x ~ '^autovacuum_vacuum_threshold='
            ) as c_vacuum_threshold,
            to_char(
                pg_stat_all_tables.last_vacuum, 'YYYY-MM-DD HH24:MI:SS'
            ) as last_vacuum,
            to_char(
                pg_stat_all_tables.last_autovacuum, 'YYYY-MM-DD HH24:MI:SS'
            ) as last_autovacuum,
            to_char(
                pg_stat_all_tables.last_analyze, 'YYYY-MM-DD HH24:MI:SS'
            ) as last_analyze,
            to_char(
                pg_stat_all_tables.last_autoanalyze, 'YYYY-MM-DD HH24:MI:SS'
            ) as last_autoanalyze
        from pg_class
        join pg_namespace on pg_class.relnamespace = pg_namespace.oid
        left outer join pg_stat_all_tables on pg_class.oid = pg_stat_all_tables.relid
        where
            n_dead_tup is not null
            and nspname not in ('information_schema', 'pg_catalog')
            and nspname not like 'pg_toast%'
            and pg_class.relkind = 'r'
    ),
    data as (
        select
            *,
            coalesce(
                raw_data.c_analyze_factor,
                current_setting('autovacuum_analyze_scale_factor')
            )::float8 as analyze_factor,
            coalesce(
                raw_data.c_analyze_threshold,
                current_setting('autovacuum_analyze_threshold')
            )::float8 as analyze_threshold,
            coalesce(
                raw_data.c_vacuum_factor,
                current_setting('autovacuum_vacuum_scale_factor')
            )::float8 as vacuum_factor,
            coalesce(
                raw_data.c_vacuum_threshold,
                current_setting('autovacuum_vacuum_threshold')
            )::float8 as vacuum_threshold
        from raw_data
    )
select
    relname,
    reltuples,
    n_dead_tup,
    n_mod_since_analyze,
    round(reltuples * vacuum_factor + vacuum_threshold) as v_threshold,
    round(reltuples * analyze_factor + analyze_threshold) as a_threshold,
    round(
        cast(
            n_dead_tup / (reltuples * vacuum_factor + vacuum_threshold) * 100 as numeric
        ),
        2
    ) as v_percent,
    round(
        cast(
            n_mod_since_analyze
            / (reltuples * analyze_factor + analyze_threshold)
            * 100 as numeric
        ),
        2
    ) as a_percent,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
from data
order by a_percent desc
;
