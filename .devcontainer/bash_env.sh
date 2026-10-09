#!/usr/bin/env bash
if [ -z "${__BASH_ENV_DIRENV:-}" ] && command -v direnv >/dev/null 2>&1; then
  eval "$(__BASH_ENV_DIRENV=1 direnv export bash 2>/dev/null)" || true
fi
