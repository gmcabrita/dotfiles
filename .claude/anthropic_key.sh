set -e

signin_output=$(op signin --account my.1password.com)
eval "$signin_output"

op read "op://Personal/ebpfp27lruzgaf57gwcxs7s4ka/password"
