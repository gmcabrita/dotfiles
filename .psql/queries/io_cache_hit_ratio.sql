SELECT (hits/(reads+hits)::float) *100
FROM pg_stat_io
WHERE
	backend_type ='client backend' AND
	io_object = 'relation' AND
	io_context = 'normal';
