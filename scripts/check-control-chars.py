#!/usr/bin/env python3
"""Fails if any tracked source file contains a NUL byte or another
control character that has no legitimate reason to be there.

Written after a stray "\\x00" ended up inside a TypeScript string
literal during an editing session and sat there undetected for a
while (plain `grep` silently treats a file with a NUL byte as binary
and stops matching lines in it, which is exactly how it went unnoticed).
This walks every tracked source file itself, byte by byte, so it can't
be fooled the same way.

Allowed: tab (0x09), LF (0x0A), CR (0x0D), and anything from 0x20 up
(including the whole non-ASCII range — this is a control-character
check, not an ASCII-only check). Everything else in 0x00-0x1F, plus
DEL (0x7F), is rejected.
"""

import subprocess
import sys

# Extensions worth checking — source and config text, not binary assets.
# `git ls-files` already excludes anything gitignored (node_modules,
# target/, dist/, ...), so this is just about skipping images/fonts/etc.
# that might be tracked directly.
TEXT_EXTENSIONS = {
    ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".css", ".html", ".htm",
    ".toml", ".json", ".yml", ".yaml",
    ".md", ".txt", ".sh", ".py",
}

ALLOWED_CONTROL_BYTES = {0x09, 0x0A, 0x0D}


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=None,
        capture_output=True,
        text=True,
        check=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def has_text_extension(path: str) -> bool:
    for ext in TEXT_EXTENSIONS:
        if path.endswith(ext):
            return True
    return False


def find_offending_bytes(data: bytes) -> list[tuple[int, int]]:
    """Returns (byte_offset, byte_value) for every disallowed byte."""
    offenders = []
    for i, b in enumerate(data):
        if b in ALLOWED_CONTROL_BYTES:
            continue
        if b < 0x20 or b == 0x7F:
            offenders.append((i, b))
    return offenders


def line_number_at(data: bytes, offset: int) -> int:
    return data.count(b"\n", 0, offset) + 1


def main() -> int:
    files = [f for f in tracked_files() if has_text_extension(f)]
    had_problems = False

    for path in files:
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            continue

        offenders = find_offending_bytes(data)
        if not offenders:
            continue

        had_problems = True
        print(f"::error file={path}::contains disallowed control byte(s)")
        for offset, value in offenders[:10]:
            line = line_number_at(data, offset)
            print(f"  {path}:{line} — byte 0x{value:02x} at file offset {offset}")
        if len(offenders) > 10:
            print(f"  ...and {len(offenders) - 10} more in this file")

    if had_problems:
        print(
            "\nFound control characters that don't belong in source files "
            "(NUL and friends). Remove them — a stray one can hide from "
            "plain `grep`, since a NUL byte makes grep treat the whole "
            "file as binary and stop reporting matching lines in it."
        )
        return 1

    print(f"Checked {len(files)} files — no stray control characters.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
