#!/usr/bin/env python3
"""Remove all lines before the last line containing 'Found the element!' in debug_log.txt."""
import sys

LOG = "/home/rayguo/workSpace/rustWorkSpace/servo/debug_log.txt"
TMP = LOG + ".tmp"
MARKER = "Found the element!"

last_match_offset = None
with open(LOG, "rb") as fin:
    offset = 0
    for line in fin:
        if MARKER.encode() in line:
            last_match_offset = offset
        offset += len(line)

if last_match_offset is not None:
    with open(LOG, "rb") as fin, open(TMP, "wb") as fout:
        fin.seek(last_match_offset)
        for line in fin:
            fout.write(line)
    import os
    os.replace(TMP, LOG)
    print("Trimmed file, kept from last match onward.")
else:
    print("Marker not found; file unchanged.", file=sys.stderr)
    import os
    os.remove(TMP) if os.path.exists(TMP) else None
    sys.exit(1)
