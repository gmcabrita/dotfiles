select
    sum(calls) as calls,
    round(sum(total_exec_time)::numeric, 2) as total_exec_t,
    round((sum(mean_exec_time * calls) / sum(calls))::numeric, 2) as mean_exec_t,
    format(
        '%s–%s',
        round(min(min_exec_time)::numeric, 2),
        round(max(max_exec_time)::numeric, 2)
    ) as min_max_exec_t,
    round(sum(total_plan_time)::numeric, 2) as total_plan_t,
    round((sum(mean_plan_time * calls) / sum(calls))::numeric, 2) as mean_plan_t,
    format(
        '%s–%s',
        round(min(min_plan_time)::numeric, 2),
        round(max(max_plan_time)::numeric, 2)
    ) as min_max_plan_t,
    sum(rows) as rows,
    (select usename from pg_user where usesysid = userid) as usr,
    (select datname from pg_database where oid = dbid) as db,
    left(query, 100) as query,
    sum(shared_blks_hit) as shared_blks_hit,
    sum(shared_blks_read) as shared_blks_read,
    sum(shared_blks_dirtied) as shared_blks_dirtied,
    sum(shared_blks_written) as shared_blks_written,
    sum(local_blks_hit) as local_blks_hit,
    sum(local_blks_read) as local_blks_read,
    sum(local_blks_dirtied) as local_blks_dirtied,
    sum(local_blks_written) as local_blks_written,
    sum(temp_blks_read) as temp_blks_read,
    sum(temp_blks_written) as temp_blks_written,
    sum(blk_read_time) as blk_read_time,
    sum(blk_write_time) as blk_write_time,
    array_agg(queryid) as queryids
from pg_stat_statements
group by userid, dbid, query
order by sum(total_exec_time) desc
limit 50
;
