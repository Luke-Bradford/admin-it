# app/utils/host_resolver.py

import os
import socket


def is_running_in_docker() -> bool:
    try:
        return os.path.exists("/.dockerenv") or any(
            "docker" in line for line in open("/proc/self/cgroup", "rt", errors="ignore")
        )
    except Exception:
        return False


def get_local_machine_name() -> str:
    return socket.gethostname()


def resolve_hostname(input_host: str, use_localhost_alias: bool = False) -> str:
    """
    Resolves host to connectable IP/hostname. If 'use_localhost_alias' is True,
    then 'host.docker.internal' is returned regardless of the input.
    Otherwise, we attempt to resolve the provided hostname.
    """
    if use_localhost_alias:
        return "host.docker.internal"

    try:
        socket.gethostbyname(input_host)
        return input_host
    except socket.error:
        raise RuntimeError(f"Unable to resolve host: {input_host}")
