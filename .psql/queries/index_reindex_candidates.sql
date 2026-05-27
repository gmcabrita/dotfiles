-- noqa: disable=all
-- https://docs.aws.amazon.com/prescriptive-guidance/latest/postgresql-maintenance-rds-aurora/reindex.html
-- Catalog-only estimate for btree, hash, GiST, and SP-GiST indexes.
-- GiST/SP-GiST operator classes can store compressed or derived values, so bloat can be overstated.
-- SP-GiST also has inner tuples; this estimates leaf tuple pages plus fixed pages.
with constants as (
    select
        --- feel free to change these:
        2147483648::numeric as min_index_size,
        2147483648::numeric as min_pct_bloat_size,
        50 as min_bloat_pct,
        10737418240::numeric as min_bloat_size,
        --- do not change the ones below unless you know what you are doing
        current_setting('block_size')::numeric as bs,
        24::numeric as pagehdr,
        1024::numeric as default_avg_width,
        case -- maxalign: 4 on 32bits, 8 on 64bits (and mingw32 ?)
            when
                version() ~ 'mingw32'
                or version() ~ '64-bit|x86_64|ppc64|ia64|amd64'
                then 8
            else 4
        end as maxalign
),

method_config as (
    select
        method_config.index_method,
        method_config.default_fillfactor::smallint,
        method_config.pageopqdata::numeric,
        method_config.min_pages::numeric,
        method_config.estimation_base_pages::numeric
    from (
        values
            ('btree', 90, 16, 1, 1),
            ('hash', 75, 16, 2, 1),
            ('gist', 90, 16, 1, 1),
            ('spgist', 80, 8, 3, 2)
    ) as method_config(
        index_method,
        default_fillfactor,
        pageopqdata,
        min_pages,
        estimation_base_pages
    )
),

idx_data as (
    select
        am.amname::text as index_method,
        ci.relname as idxname,
        ci.reltuples,
        ci.relpages,
        i.indrelid as tbloid,
        i.indexrelid as idxoid,
        coalesce(
            substring(
                array_to_string(ci.reloptions, ' ')
                from 'fillfactor=([0-9]+)'
            )::smallint,
            m.default_fillfactor
        ) as fillfactor,
        i.indnatts,
        pg_catalog.string_to_array(pg_catalog.textin(
            pg_catalog.int2vectorout(i.indkey)
        ), ' ')::int [] as indkey,
        m.pageopqdata,
        m.min_pages,
        m.estimation_base_pages
    from pg_catalog.pg_index i
    join pg_catalog.pg_class ci on ci.oid = i.indexrelid
    join pg_catalog.pg_am am on am.oid = ci.relam
    join method_config m on m.index_method = am.amname::text
    cross join constants c
    where ci.relpages * c.bs > c.min_index_size
),

keyed_ic as (
    select
        index_method,
        idxname,
        reltuples,
        relpages,
        tbloid,
        idxoid,
        fillfactor,
        indkey,
        pageopqdata,
        min_pages,
        estimation_base_pages,
        pg_catalog.generate_series(1, indnatts) as attpos
    from idx_data
    where index_method in ('btree', 'gist', 'spgist')
),

keyed_index_columns as (
    select
        ic.index_method,
        ct.relname as tblname,
        ct.relnamespace,
        ic.idxname,
        ic.attpos,
        ic.indkey,
        ic.reltuples,
        ic.relpages,
        ic.tbloid,
        ic.idxoid,
        ic.fillfactor,
        ic.pageopqdata,
        ic.min_pages,
        ic.estimation_base_pages,
        coalesce(a1.attnum, a2.attnum) as attnum,
        coalesce(a1.attname, a2.attname) as attname,
        coalesce(a1.atttypid, a2.atttypid) as atttypid,
        case
            when a1.attnum is null
                then ic.idxname
            else ct.relname
        end as attrelname
    from keyed_ic ic
    join pg_catalog.pg_class ct on ct.oid = ic.tbloid
    left join pg_catalog.pg_attribute a1
        on
            ic.indkey[ic.attpos] <> 0
            and a1.attrelid = ic.tbloid
            and a1.attnum = ic.indkey[ic.attpos]
    left join pg_catalog.pg_attribute a2 on
        ic.indkey[ic.attpos] = 0
        and a2.attrelid = ic.idxoid
        and a2.attnum = ic.attpos
),

keyed_rows_data_stats as (
    select
        i.index_method,
        n.nspname,
        i.tblname,
        i.idxname,
        i.reltuples,
        i.relpages,
        i.fillfactor,
        i.pageopqdata,
        i.min_pages,
        i.estimation_base_pages,
        c.bs,
        c.maxalign,
        c.pagehdr,
        /* per tuple header: add indexattributebitmapdata if some cols are null-able */
        case
            when max(coalesce(s.null_frac, 0)) = 0
                then case
                    when i.index_method = 'spgist' then 12 -- SpGistLeafTupleData size
                    else 8 -- IndexTupleData size
                end
            else
                case
                    when i.index_method = 'spgist' then 12 -- SpGistLeafTupleData size
                    else 8 -- IndexTupleData size
                end
                + ((32 + 8 - 1) / 8) -- IndexAttributeBitMapData size (INDEX_MAX_KEYS + 8 - 1 / 8)
        end as tuple_hdr_bm,
        /* data len: we remove null values save space using it fractionnal part from stats */
        sum(
            (1 - coalesce(s.null_frac, 0))
            * coalesce(s.avg_width, c.default_avg_width)
        ) as nulldatawidth
    from keyed_index_columns i
    cross join constants c
    join pg_catalog.pg_namespace n
        on
            n.oid = i.relnamespace
            and n.nspname <> 'pg_catalog'
    join pg_catalog.pg_stats s
        on
            s.schemaname = n.nspname
            and s.tablename = i.attrelname
            and s.attname = i.attname
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
),

keyed_tuple_stats as (
    select
        index_method,
        bs,
        nspname,
        tblname,
        idxname,
        reltuples,
        relpages,
        fillfactor,
        pagehdr,
        pageopqdata,
        min_pages,
        estimation_base_pages,
        (
            tuple_hdr_bm
            -- add padding to the index tuple header to align on maxalign
            + maxalign - case
                when tuple_hdr_bm % maxalign = 0 then maxalign
                else tuple_hdr_bm % maxalign
            end
            -- add padding to the data to align on maxalign
            + nulldatawidth + maxalign - case
                when nulldatawidth = 0 then 0
                when nulldatawidth::integer % maxalign = 0 then maxalign
                else nulldatawidth::integer % maxalign
            end
        )::numeric as tuple_width
    from keyed_rows_data_stats
),

hash_tuple_stats as (
    select
        d.index_method,
        c.bs,
        n.nspname,
        ct.relname as tblname,
        d.idxname,
        d.reltuples,
        d.relpages,
        d.fillfactor,
        c.pagehdr,
        d.pageopqdata,
        d.min_pages,
        d.estimation_base_pages,
        (
            8 -- IndexTupleData size
            + c.maxalign - case
                when 8 % c.maxalign = 0 then c.maxalign
                else 8 % c.maxalign
            end
            + 4 -- uint32 hash key
            + c.maxalign - case
                when 4 % c.maxalign = 0 then c.maxalign
                else 4 % c.maxalign
            end
        )::numeric as tuple_width
    from idx_data d
    cross join constants c
    join pg_catalog.pg_class ct on ct.oid = d.tbloid
    join pg_catalog.pg_namespace n
        on
            n.oid = ct.relnamespace
            and n.nspname <> 'pg_catalog'
    where d.index_method = 'hash'
),

tuple_stats as (
    select * from keyed_tuple_stats
    union all
    select * from hash_tuple_stats
),

relation_stats as (
    select
        greatest(
            min_pages,
            coalesce(
                estimation_base_pages
                + ceil(
                    reltuples::numeric
                    / nullif(floor(
                        (bs - pageopqdata - pagehdr) / (4 + tuple_width)
                    ), 0)
                ),
                min_pages
            )
        ) as est_pages,
        greatest(
            min_pages,
            coalesce(
                estimation_base_pages
                + ceil(
                    reltuples::numeric
                    / nullif(floor(
                        (bs - pageopqdata - pagehdr)
                        * fillfactor
                        / (100 * (4 + tuple_width))
                    ), 0)
                ),
                min_pages
            )
        ) as est_pages_ff,
        index_method,
        bs,
        nspname,
        tblname,
        idxname,
        relpages,
        fillfactor
    from tuple_stats
),

bloated_indexes as (
    select
        index_method,
        nspname,
        tblname as tbl,
        idxname as idx,
        bs * relpages as real_size,
        greatest(0::numeric, bs * (relpages - est_pages)) as extra_size,
        greatest(
            0::numeric,
            round(100 * (relpages - est_pages)::numeric / nullif(relpages, 0))
        ) as extra_pct,
        fillfactor,
        case
            when relpages > est_pages_ff
                then bs * (relpages - est_pages_ff)
            else 0
        end as bloat_size,
        greatest(
            0::numeric,
            round(100 * (relpages - est_pages_ff)::numeric / nullif(relpages, 0))
        ) as bloat_pct
    from relation_stats
)

select
    index_method,
    nspname as schemaname,
    tbl,
    idx,
    pg_size_pretty(real_size::numeric) as real_size,
    pg_size_pretty(extra_size::numeric) as extra_size,
    extra_pct,
    fillfactor,
    pg_size_pretty(bloat_size::numeric) as bloat_size_pretty,
    bloat_pct
from bloated_indexes
cross join constants c
where
    bloat_size::numeric > c.min_bloat_size -- More than 10 GiB bloat
    or (
        bloat_pct > c.min_bloat_pct -- More than 50% bloat
        and bloat_size::numeric > c.min_pct_bloat_size -- More than 2 GiB bloat
    )
order by bloat_size::numeric desc, bloat_pct desc;
