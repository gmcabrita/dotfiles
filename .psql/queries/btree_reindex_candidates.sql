-- https://docs.aws.amazon.com/prescriptive-guidance/latest/postgresql-maintenance-rds-aurora/reindex.html
select
  tbl,
  idx,
  pg_size_pretty(real_size::numeric) as real_size,
  pg_size_pretty(extra_size::numeric) as extra_size,
  extra_pct,
  fillfactor,
  pg_size_pretty(bloat_size::numeric) as bloat_size,
  bloat_pct
from (
  select
      tblname as tbl,
      idxname as idx,
      bs * (relpages) as real_size,
      bs * (relpages - est_pages) as extra_size,
      round(100 * (relpages - est_pages)::float / relpages) as extra_pct,
      fillfactor,
      case
          when relpages > est_pages_ff
              then (bs * (relpages - est_pages_ff))
          else 0
      end as bloat_size,
      round(100 * (relpages - est_pages_ff)::float / relpages) as bloat_pct
  -- , 100-(pst).avg_leaf_density as pst_avg_bloat, est_pages, index_tuple_hdr_bm, maxalign, pagehdr, nulldatawidth, nulldatahdrwidth, reltuples, relpages -- (debug info)
  from (
      select
          coalesce(
              1
              + ceil(reltuples / floor((bs - pageopqdata - pagehdr) / (4 + nulldatahdrwidth)::float)), 0 -- itemiddata size + computed avg size of a tuple (nulldatahdrwidth)
          ) as est_pages,
          coalesce(
              1
              + ceil(reltuples / floor((bs - pageopqdata - pagehdr) * fillfactor / (100 * (4 + nulldatahdrwidth)::float))), 0
          ) as est_pages_ff,
          bs,
          nspname,
          tblname,
          idxname,
          relpages,
          fillfactor,
          is_na
      -- , pgstatindex(idxoid) as pst, index_tuple_hdr_bm, maxalign, pagehdr, nulldatawidth, nulldatahdrwidth, reltuples -- (debug info)
      from (
          select
              maxalign,
              bs,
              nspname,
              tblname,
              idxname,
              reltuples,
              relpages,
              idxoid,
              fillfactor,
              (
                  index_tuple_hdr_bm
                  + maxalign - case -- add padding to the index tuple header to align on maxalign
                      when index_tuple_hdr_bm % maxalign = 0 then maxalign
                      else index_tuple_hdr_bm % maxalign
                  end
                  -- add padding to the data to align on maxalign
                  + nulldatawidth + maxalign - case
                      when nulldatawidth = 0 then 0
                      when nulldatawidth::integer % maxalign = 0 then maxalign
                      else nulldatawidth::integer % maxalign
                  end
              )::numeric as nulldatahdrwidth,
              pagehdr,
              pageopqdata,
              is_na
              -- , index_tuple_hdr_bm, nulldatawidth -- (debug info)
          from (
              select
                  n.nspname,
                  i.tblname,
                  i.idxname,
                  i.reltuples,
                  i.relpages,
                  i.idxoid,
                  i.fillfactor,
                  current_setting('block_size')::numeric as bs,
                  case -- maxalign: 4 on 32bits, 8 on 64bits (and mingw32 ?)
                      when
                          version() ~ 'mingw32'
                          or version() ~ '64-bit|x86_64|ppc64|ia64|amd64'
                          then 8
                      else 4
                  end as maxalign,
                  /* per page header, fixed size: 20 for 7.x, 24 for others */
                  24 as pagehdr,
                  /* per page btree opaque data */
                  16 as pageopqdata,
                  /* per tuple header: add indexattributebitmapdata if some cols are null-able */
                  case
                      when max(coalesce(s.null_frac, 0)) = 0
                          then 8 -- indextupledata size
                      else 8 + ((32 + 8 - 1) / 8) -- indextupledata size + indexattributebitmapdata size ( max num filed per index + 8 - 1 /8)
                  end as index_tuple_hdr_bm,
                  /* data len: we remove null values save space using it fractionnal part from stats */
                  sum(
                      (1 - coalesce(s.null_frac, 0)) * coalesce(s.avg_width, 1024)
                  ) as nulldatawidth,
                  max(
                      case
                          when
                              i.atttypid = 'pg_catalog.name'::regtype
                              then 1
                          else 0
                      end
                  )
                  > 0 as is_na
              from (
                  select
                      ct.relname as tblname,
                      ct.relnamespace,
                      ic.idxname,
                      ic.attpos,
                      ic.indkey,
                      ic.indkey[ic.attpos],
                      ic.reltuples,
                      ic.relpages,
                      ic.tbloid,
                      ic.idxoid,
                      ic.fillfactor,
                      coalesce(a1.attnum, a2.attnum) as attnum,
                      coalesce(a1.attname, a2.attname) as attname,
                      coalesce(a1.atttypid, a2.atttypid) as atttypid,
                      case
                          when a1.attnum is null
                              then ic.idxname
                          else ct.relname
                      end as attrelname
                  from (
                      select
                          idxname,
                          reltuples,
                          relpages,
                          tbloid,
                          idxoid,
                          fillfactor,
                          indkey,
                          pg_catalog.generate_series(1, indnatts) as attpos
                      from (
                          select
                              ci.relname as idxname,
                              ci.reltuples,
                              ci.relpages,
                              i.indrelid as tbloid,
                              i.indexrelid as idxoid,
                              coalesce(substring(
                                  array_to_string(ci.reloptions, ' ')
                                  from 'fillfactor=([0-9]+)'
                              )::smallint, 90) as fillfactor,
                              i.indnatts,
                              pg_catalog.string_to_array(pg_catalog.textin(
                                  pg_catalog.int2vectorout(i.indkey)
                              ), ' ')::int [] as indkey
                          from pg_catalog.pg_index i
                          join pg_catalog.pg_class ci on ci.oid = i.indexrelid
                          where
                              ci.relam
                              = (
                                  select oid from pg_am
                                  where amname = 'btree'
                              )
                              and ci.relpages > 0
                      ) as idx_data
                  ) as ic
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
              ) i
              join pg_catalog.pg_namespace n on n.oid = i.relnamespace
              join pg_catalog.pg_stats s
                  on
                      s.schemaname = n.nspname
                      and s.tablename = i.attrelname
                      and s.attname = i.attname
              group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
          ) as rows_data_stats
      ) as rows_hdr_pdg_stats
  ) as relation_stats
  where nspname <> 'pg_catalog'
) as bloated_indexes
where
  bloat_pct > 25 -- More than 25% bloat
  and bloat_size > 2147483648 -- More than 2 GiB bloat
order by bloat_size desc, bloat_pct desc;
