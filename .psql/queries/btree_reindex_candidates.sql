with
    step1 as (
        select
            i.nspname as schema_name,
            i.tblname as table_name,
            i.idxname as index_name,
            i.reltuples,
            i.relpages,
            i.relam,
            a.attrelid as table_oid,
            current_setting('block_size')::numeric as bs,
            fillfactor,
            case
                when version() ~ 'mingw32|64-bit|x86_64|ppc64|ia64|amd64' then 8 else 4
            end as maxalign,
            24 as pagehdr,
            16 as pageopqdata,
            case
                when max(coalesce(s.null_frac, 0)) = 0
                then 8  -- IndexTupleData size
                else 8 + ((32 + 8 - 1) / 8)  -- IndexTupleData size + IndexAttributeBitMapData size ( max num filed per index + 8 - 1 /8)
            end as index_tuple_hdr_bm,
            sum(
                (1 - coalesce(s.null_frac, 0)) * coalesce(s.avg_width, 1024)
            ) as nulldatawidth,
            max(case when a.atttypid = 'pg_catalog.name'::regtype then 1 else 0 end)
            > 0 as is_na
        from pg_attribute as a
        join
            (
                select
                    nspname,
                    tbl.relname as tblname,
                    idx.relname as idxname,
                    idx.reltuples,
                    idx.relpages,
                    idx.relam,
                    indrelid,
                    indexrelid,
                    indkey::smallint[] as attnum,
                    coalesce(
                        substring(
                            array_to_string(idx.reloptions, ' ')
                            from 'fillfactor=([0-9]+)'
                        )::smallint,
                        90
                    ) as fillfactor
                from pg_index
                join pg_class idx on idx.oid = pg_index.indexrelid
                join pg_class tbl on tbl.oid = pg_index.indrelid
                join pg_namespace on pg_namespace.oid = idx.relnamespace
                where pg_index.indisvalid and tbl.relkind = 'r' and idx.relpages > 0
            ) as i
            on a.attrelid = i.indexrelid
        join
            pg_stats as s
            on s.schemaname = i.nspname
            and (
                (
                    s.tablename = i.tblname
                    and s.attname
                    = pg_catalog.pg_get_indexdef(a.attrelid, a.attnum, true)
                )
                or (s.tablename = i.idxname and s.attname = a.attname)
            )
        join pg_type as t on a.atttypid = t.oid
        where a.attnum > 0
        group by 1, 2, 3, 4, 5, 6, 7, 8, 9
    ),
    step2 as (
        select
            *,
            (
                index_tuple_hdr_bm
                + maxalign
                - case
                    when index_tuple_hdr_bm % maxalign = 0
                    then maxalign
                    else index_tuple_hdr_bm % maxalign
                end
                + nulldatawidth
                + maxalign
                - case
                    when nulldatawidth = 0
                    then 0
                    when nulldatawidth::integer % maxalign = 0
                    then maxalign
                    else nulldatawidth::integer % maxalign
                end
            )::numeric as nulldatahdrwidth
        from step1
    ),
    step3 as (
        select
            *,
            coalesce(
                1 + ceil(
                    reltuples / floor(
                        (bs - pageopqdata - pagehdr) / (4 + nulldatahdrwidth)::float
                    )
                ),
                0
            ) as est_pages,
            coalesce(
                1 + ceil(
                    reltuples / floor(
                        (bs - pageopqdata - pagehdr)
                        * fillfactor
                        / (100 * (4 + nulldatahdrwidth)::float)
                    )
                ),
                0
            ) as est_pages_ff
        from step2
        join pg_am am on step2.relam = am.oid
        where am.amname = 'btree'
    ),
    step4 as (
        select
            *,
            bs * (relpages)::bigint as real_size,
            bs * (relpages - est_pages)::bigint as extra_size,
            100 * (relpages - est_pages)::float / relpages as extra_pct,
            bs * (relpages - est_pages_ff) as bloat_size,
            100 * (relpages - est_pages_ff)::float / relpages as bloat_pct
        from step3
    )
select
    table_name,
    index_name,
    pg_size_pretty(real_size::numeric)::text as index_size,
    pg_size_pretty(bloat_size::numeric)::text as bloat_size,
    round(bloat_pct::numeric, 2)::text as "bloat_pct"
from step4
where
    step4.bloat_pct is not null
    and step4.bloat_pct > 20.0
    and step4.bloat_size is not null
    and step4.bloat_size >= (10 ^ 9)::numeric
order by step4.bloat_size desc
;
