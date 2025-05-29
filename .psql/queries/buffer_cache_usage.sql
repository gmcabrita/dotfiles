-- ideal is buffer at 100% utilization and having a sufficient subset of
-- tables/indexes in the buffer
with
    state as (
        select
            count(*) filter (where relfilenode is not null) as used,
            count(*) filter (where relfilenode is null) as empty,
            count(*) as total
        from pg_buffercache
    )
select *, round(used * 1.0 / total * 100, 1) as percent
from state
;
