#!/bin/sh
set -eu

# The supervisor owns setup, both shard process groups and bounded shutdown.
script_root="${DST_SCRIPT_ROOT:-/usr/local/bin}"
exec python3 "${script_root}/dst-supervisor.py"
