# Connection settings for psql / pg_dump, taken from DATABASE_URL in .env.
#
#   source scripts/pg-env.sh      (from the app folder, where .env is)
#
# Sets PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE, so the database
# tools need no connection string on their command line — where any
# other user on the machine could read it, password included, from the
# process list. Nothing is printed except the database name and host.
#
# Sourced, not run: it changes this shell only, and uses no `set -e` or
# `exit` that would close the shell it is sourced into.

_pgenv_raw=$(grep -E '^DATABASE_URL=' .env 2>/dev/null | head -n 1 | cut -d= -f2-)
_pgenv_raw=${_pgenv_raw%$'\r'}
_pgenv_raw=${_pgenv_raw#\"}; _pgenv_raw=${_pgenv_raw%\"}
_pgenv_raw=${_pgenv_raw#\'}; _pgenv_raw=${_pgenv_raw%\'}

# Percent-decoding: a password with @ or : in it is stored as %40 / %3A.
# A + stays a + — in a URL's user and password it is not a space.
_pgenv_decode() { local s=$1; printf '%b' "${s//%/\\x}"; }

_pgenv_re='^postgres(ql)?://([^:@/]*)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]+)'
if [[ $_pgenv_raw =~ $_pgenv_re ]]; then
  export PGUSER=$(_pgenv_decode "${BASH_REMATCH[2]}")
  export PGPASSWORD=$(_pgenv_decode "${BASH_REMATCH[4]}")
  export PGHOST=${BASH_REMATCH[5]}
  export PGPORT=${BASH_REMATCH[7]:-5432}
  export PGDATABASE=$(_pgenv_decode "${BASH_REMATCH[8]}")
  echo "pg-env: database ${PGDATABASE} on ${PGHOST}:${PGPORT}"
else
  echo "pg-env: could not read DATABASE_URL from .env in $(pwd) — nothing set" >&2
fi
unset _pgenv_raw _pgenv_re
unset -f _pgenv_decode
