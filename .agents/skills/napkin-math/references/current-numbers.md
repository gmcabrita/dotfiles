# Napkin Math Numbers Snapshot

Source: https://github.com/sirupsen/napkin-math @ `aae5832`
Captured from README.md. Rounded for memorization, not faux precision.

## Caveats

- Some throughput and latency numbers intentionally don't line up, for ease of calculations.
- Take I/O and cloud numbers with a grain of salt; upstream updates them as measurements improve.
- Rows refreshable on one host were remeasured on GCP `c4-standard-48-lssd` on March 8, 2026.

## Numbers

| Operation                           | Latency     | Throughput | 1 MiB  | 1 GiB  |
| ----------------------------------- | -------     | ---------- | ------ | ------ |
| Sequential Memory R/W (64 bytes)    | 0.5 ns      |            |        |        |
| ├ Single Thread                     |             | 20 GiB/s   | 50 μs  | 50 ms  |
| ├ Threaded                          |             | 200 GiB/s  | 5 μs   | 5 ms   |
| Network Same-Zone                   |             | 10 GiB/s   | 100 μs | 100 ms |
| ├ Inside VPC                        |             | 10 GiB/s   | 100 μs | 100 ms |
| ├ Outside VPC                       |             | 3 GiB/s    | 300 μs | 300 ms |
| Hashing, not crypto-safe (64 bytes) | 10 ns       | 5 GiB/s    | 200 μs | 200 ms |
| Random Memory R/W (64 bytes)        | 20 ns       | 3 GiB/s    | 300 μs | 300 ms |
| Fast Serialization `[8]` `[9]` †    | N/A         | 1 GiB/s    | 1 ms   | 1s     |
| Fast Deserialization `[8]` `[9]` †  | N/A         | 1 GiB/s    | 1 ms   | 1s     |
| System Call                         | 300 ns      | N/A        | N/A    | N/A    |
| Hashing, crypto-safe (64 bytes)     | 100 ns      | 1 GiB/s    | 1 ms   | 1s     |
| Sequential SSD read (8 KiB)         | 1 μs        | 8 GiB/s    | 100 μs | 100 ms |
| Context Switch `[1] [2]`            | 10 μs       | N/A        | N/A    | N/A    |
| Sequential SSD write, -fsync (8KiB) | 2 μs        | 3 GiB/s    | 300 μs | 300 ms |
| TCP Echo Server (32 KiB)            | 50 μs       | 500 MiB/s  | 2 ms   | 2s     |
| Random SSD Read (8 KiB)             | 100 μs      | 70 MiB/s   | 15 ms  | 15s    |
| Decompression `[11]`                | N/A         | 1 GiB/s    | 1 ms   | 1s     |
| Compression `[11]`                  | N/A         | 500 MiB/s  | 2 ms   | 2s     |
| Sorting (64-bit integers)           | N/A         | 500 MiB/s  | 2 ms   | 2s     |
| Proxy: Envoy/ProxySQL/Nginx/HAProxy | 50 μs       | ?          | ?      | ?      |
| Network within same region          | 250 μs      | 2 GiB/s    | 500 μs | 500 ms |
| Premium network within zone/VPC     | 250 μs      | 25 GiB/s   | 50 μs  | 40 ms  |
| Sequential SSD write, +fsync (8KiB) | 300 μs      | 30 MiB/s   | 30 ms  | 30s    |
| {MySQL, Memcached, Redis, ..} Query | 500 μs      | ?          | ?      | ?      |
| Serialization `[8]` `[9]` †         | N/A         | 100 MiB/s  | 10 ms  | 10s    |
| Deserialization `[8]` `[9]` †       | N/A         | 100 MiB/s  | 10 ms  | 10s    |
| Sequential HDD Read (8 KiB)         | 10 ms       | 250 MiB/s  | 2 ms   | 2s     |
| Random HDD Read (8 KiB)             | 10 ms       | 0.7 MiB/s  | 2 s    | 30m    |
| Blob Storage GET, if-not-match 304  | 30 ms       |            |        |        |
| Blob Storage GET, 1 conn (128KiB)   | 80 ms       | 100 MiB/s  | 10 ms  | 10s    |
| Blob Storage GET, n conn (offsets)  | 80 ms       | NW limit   |        |        |
| Blob Storage LIST                   | 100 ms      |            |        |        |
| Blob Storage PUT, 1 conn (128KiB)   | 200 ms      | 100 MiB/s  | 10 ms  | 10s    |
| Blob Storage PUT, n conn (multipart)| 200 ms      | NW limit   | 10 ms  | 10s    |
| Network between regions `[6]`       | [Varies][i] | 25 MiB/s   | 40 ms  | 40s    |
| Network NA Central <-> East         | 25 ms       | 25 MiB/s   | 40 ms  | 40s    |
| Network NA Central <-> West         | 40 ms       | 25 MiB/s   | 40 ms  | 40s    |
| Network NA East <-> West            | 60 ms       | 25 MiB/s   | 40 ms  | 40s    |
| Network EU West <-> NA East         | 80 ms       | 25 MiB/s   | 40 ms  | 40s    |
| Network EU West <-> NA Central      | 100 ms      | 25 MiB/s   | 40 ms  | 40s    |
| Network NA West <-> Singapore       | 180 ms      | 25 MiB/s   | 40 ms  | 40s    |
| Network EU West <-> Singapore       | 160 ms      | 25 MiB/s   | 40 ms  | 40s    |

† Fast serialization/deserialization usually means a simple wire protocol that dumps bytes, or a very efficient environment. JSON is usually the slower kind.

## Cost Numbers

Approximate numbers that should be consistent between cloud providers.

| What                | Amount | $ / Month | 1y commit $ /month | Spot $ /month | Hourly Spot $ |
| --------------------| ------ | --------- | ------------------ | -------------- | ------------- |
| CPU                 | 1      | $15       | $10                | $2             | $0.005        |
| GPU                 | 1      | $5000     | $3000              | $1500          | $2            |
| Memory              | 1 GB   | $2        | $1                 | $0.2           | $0.0005       |
| Warehouse Storage   | 1 GB   | $0.02     |                    |                |               |
| Blob (S3, GCS)      | 1 GB   | $0.02     |                    |                |               |
| Zonal HDD           | 1 GB   | $0.05     |                    |                |               |
| Ephemeral SSD       | 1 GB   | $0.08     | $0.05              | $0.05          | $0.07         |
| Regional HDD        | 1 GB   | $0.1      |                    |                |               |
| Zonal SSD           | 1 GB   | $0.2      |                    |                |               |
| Regional SSD        | 1 GB   | $0.35     |                    |                |               |
| Same Zone           | 1 GB   | $0        |                    |                |               |
| Blob                | 1 GB   | $0        |                    |                |               |
| Ingress             | 1 GB   | $0        |                    |                |               |
| L4 LB               | 1 GB   | $0.008    |                    |                |               |
| Inter-Zone          | 1 GB   | $0.01     |                    |                |               |
| Inter-Region        | 1 GB   | $0.02     |                    |                |               |
| Internet Egress †   | 1 GB   | $0.1      |                    |                |               |
| CDN Egress          | 1 GB   | $0.05     |                    |                |               |
| CDN Fill ‡          | 1 GB   | $0.01     |                    |                |               |
| Warehouse Query     | 1 GB   | $0.005    |                    |                |               |
| Logs/Traces ♣       | 1 GB   | $0.5      |                    |                |               |
| Metrics             | 1000   | $20       |                    |                |               |
| EKM Keys            | 1      | $1        |                    |                |               |

† Network leaving cloud provider. ‡ Extra per cache-fill fee close to blob write costs. ♣ Logging providers vary.

Blob storage operation charges:

| Operation      | 1M   | 1000    |
| -------------- | ---- | ------- |
| Reads          | $0.4 | $0.0004 |
| Writes         | $5   | $0.005  |
| EKM Encryption | $3   | $0.003  |

## Compression Ratios

Ballpark: each extra `x` compression ratio can decrease performance by 10x.

| What        | Compression Ratio |
| ----------- | ----------------- |
| HTML        | 2-3x              |
| English     | 2-4x              |
| Source Code | 2-4x              |
| Executables | 2-3x              |
| RPC         | 5-10x             |
| SSL         | -2%               |

## Techniques

- Don't overcomplicate. More than 6 assumptions likely means too hard.
- Keep the units. They're checksums.
- Calculate with exponents. Aim within an order of magnitude.
- Perform Fermi decomposition. Guess parts until answer shape appears.
