with env as ( /* pgwatch_generated */
    select
    -- Check if native pg_get_multixact_stats() is available (PG19+)
        exists(
            select
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where
                p.proname = 'pg_get_multixact_stats'
                and n.nspname = 'pg_catalog'
        ) as has_native_fn,
        -- Fallback checks for cloud providers that may not have native function yet
        exists(
            select
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where p.proname = 'pg_ls_multixactdir' and n.nspname = 'rds_tools'
        ) as has_rds_fn,
        exists(
            select
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where p.proname = 'aurora_stat_file' and n.nspname = 'pg_catalog'
        ) as has_aurora_fn,
        exists(
            select from pg_proc
            where proname = 'pg_ls_dir')
            as has_pg_ls_dir_func,
        exists(
            select from pg_proc
            where proname = 'pg_stat_file')
            as has_pg_stat_file_func
),

can_local as (
    select (has_pg_ls_dir_func and has_pg_stat_file_func) as ok from env
),

-- Use native pg_get_multixact_stats() when available (preferred for PG19+).
-- Returns members_size directly; offsets_bytes is calculated from num_mxids.
-- Each offset SLRU segment is 256KB (262144 bytes) and holds 32768 8-byte entries.
native_probe_xml as (
    select query_to_xml($q$
    select
      members_size::bigint as members_bytes,
      (ceiling(num_mxids::numeric / 32768) * 262144)::bigint as offsets_bytes,
      0 as status_code
    from pg_catalog.pg_get_multixact_stats()
  $q$, true, true, '') as x
    where (select has_native_fn from env)
),

-- Aurora fallback: uses aurora_stat_file() function.
aurora_probe_xml as (
    select query_to_xml($q$
    with files as (
      select filename, allocated_bytes, used_bytes
      from aurora_stat_file()
      where filename like 'pg_multixact/%'
    ),
    members as (
      select sum(used_bytes)::bigint as sz from files where filename like 'pg_multixact/members%'
    ),
    offsets as (
      select sum(used_bytes)::bigint as sz from files where filename like 'pg_multixact/offsets%'
    ),
    has_rows as (
      select exists(select 1 from files) as any_rows
    )
    select
      case when (select any_rows from has_rows) then coalesce((select sz from members), 0) end as members_bytes,
      case when (select any_rows from has_rows) then coalesce((select sz from offsets), 0) end as offsets_bytes,
      case when (select any_rows from has_rows) then 0 else 1 end as status_code
  $q$, true, true, '') as x
    where
        (select has_aurora_fn from env) and not (select has_native_fn from env)
),

-- RDS fallback: uses rds_tools.pg_ls_multixactdir() function.
rds_probe_xml as (
    select query_to_xml($q$
    with files as (
      select name, size
      from rds_tools.pg_ls_multixactdir()
    ),
    members as (
      select sum(size)::bigint as sz from files where name like 'pg_multixact/members%'
    ),
    offsets as (
      select sum(size)::bigint as sz from files where name like 'pg_multixact/offsets%'
    ),
    has_rows as (
      select exists(select 1 from files where name like 'pg_multixact/%') as any_rows
    )
    select
      case when (select any_rows from has_rows) then coalesce((select sz from members), 0) end as members_bytes,
      case when (select any_rows from has_rows) then coalesce((select sz from offsets), 0) end as offsets_bytes,
      case when (select any_rows from has_rows) then 0 else 1 end as status_code
  $q$, true, true, '') as x
    where
        (select has_rds_fn from env)
        and not (select has_aurora_fn from env)
        and not (select has_native_fn from env)
),

-- Self-managed fallback: uses pg_stat_file() + pg_ls_dir().
local_probe_xml as (
    select query_to_xml($q$
    with dirs as (
      select
        (pg_stat_file('pg_multixact/members', true)).isdir as has_members,
        (pg_stat_file('pg_multixact/offsets', true)).isdir as has_offsets
    ),
    flags as (
      select ((select has_members from dirs) or (select has_offsets from dirs)) as has_any
    ),
    members as (
      select sum((pg_stat_file(format('pg_multixact/members/%s', d), true)).size)::bigint as sz
      from pg_ls_dir('pg_multixact/members') as d(d)
      where (select has_members from dirs)
    ),
    offsets as (
      select sum((pg_stat_file(format('pg_multixact/offsets/%s', d), true)).size)::bigint as sz
      from pg_ls_dir('pg_multixact/offsets') as d(d)
      where (select has_offsets from dirs)
    )
    select
      case when (select has_any from flags) then coalesce((select sz from members), 0) end as members_bytes,
      case when (select has_any from flags) then coalesce((select sz from offsets), 0) end as offsets_bytes,
      case when (select has_any from flags) then 0 else 1 end as status_code
  $q$, true, true, '') as x
    where
        not (select has_rds_fn from env) and not (select has_aurora_fn from env)
        and not (select has_native_fn from env) and (select ok from can_local)
),

picked as (
    select * from native_probe_xml
    union all
    select * from aurora_probe_xml
    union all
    select * from rds_probe_xml
    union all
    select * from local_probe_xml
    limit 1
),

parsed as (
    select
        (xpath('//members_bytes/text()', x))[1]::text::bigint as members_bytes,
        (xpath('//offsets_bytes/text()', x))[1]::text::bigint as offsets_bytes,
        (xpath('//status_code/text()', x))[1]::text::int as status_code
    from picked
)

select * from parsed
union all
select
    null::bigint as members_bytes,
    null::bigint as offsets_bytes,
    2::int as status_code
where not exists (select 1 from parsed);
