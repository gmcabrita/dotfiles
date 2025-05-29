-- read and write ratio close to 1 may indicate Postgres is constantly cycling the
-- same pages in and out of shared_buffers
select (hits / (reads + hits)::float) as hit_ratio, reads, writes
from pg_stat_io
where backend_type = 'client backend' and object = 'relation' and context = 'normal'
;
