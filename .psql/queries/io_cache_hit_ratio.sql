select (hits/(reads+hits)::float) *100 as hit_ratio,
  reads, writes
from pg_stat_io
where
  backend_type ='client backend' and
  io_object = 'relation' and
  io_context = 'normal';
