#!/usr/bin/env python3
"""Refuse hand-maintained facts that a command already computes.

CANON, established 2026-08-29. Lives in fourier-basis; hydrated into every
consumer by `coherence hydrate`. This file is the only copy anyone edits.

WHY THIS EXISTS. A document that states how many tests a suite has is making a
claim about a moving world, and the commit that wrote it froze the sentence
while the world kept going. It was honest when it was made and false a month
later, and re-examining commits will never find it, because nothing in the
repository disagrees with it. A commit settles the WORK; it does not refresh a
CLAIM.

The fix is not suspicion, it is arithmetic: do not hand-maintain a fact that a
command derives. A test count belongs in the command that produces it. Every
number in a document that could have been computed is a number that will
eventually be wrong, and the cheapest way to never check it again is to not
write it down.

WHAT IS AND IS NOT A VIOLATION. A devlog entry is DATED. It says "at this
session, 268 tests", and that stays true forever because the date is part of the
claim. A status block, a CLAUDE.md or a README says "228 tests" in the present
tense. The first is a record; the second is a promise nobody can keep.

So devlog paths are skipped wholesale, and anything else may carry an inline
`derived-ok:` marker giving the reason a number is historical rather than
maintained. The marker is not a mute button -- it forces the temporal claim to
be stated out loud, which is the entire point of the rule.

Exit 0 = clean. Exit 1 = violations found. Exit 2 = could not establish truth,
in which case NOTHING is reported clean: a check that did not run must never be
indistinguishable from a check that ran and passed.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

# A claim about how many tests exist. Two shapes, because both occur in the wild:
# "228 tests" and "Test count: 28".
# The number must not be a fragment of a larger one. Without the lookbehind,
# the section heading "### 22.5 Test environment" reads as "5 Test", and the
# branch note "8/8 tests" reads as a count of 8 -- both were live in the org's
# master reference on the day this was written.
_LEAD = r"(?<![\d./\\-])"

COUNT_PATTERNS = (
    # PLURAL ONLY, deliberately. "a Windows 10 test target" and "one test file"
    # are nouns, not counts, and a check that cries wolf on them gets muted --
    # which costs more than the handful of singular counts it would ever catch.
    re.compile(_LEAD + r"(\d[\d,]*)\s+(?:unit\s+|integration\s+)?tests\b", re.I),
    re.compile(r"\btests?\s+count\s*[:=]\s*" + _LEAD + r"(\d[\d,]*)", re.I),
    re.compile(r"\btest\s+count\s+at\b[^.\n]*?" + _LEAD + r"(\d[\d,]*)\b", re.I),
)

# The escape hatch. Same line or the line above.
MARKER = re.compile(r"derived-ok\s*:\s*(.+?)\s*(?:-->|$)", re.I)

# Paths whose numbers are dated records, not maintained claims.
# A devlog entry and a diary entry are both DATED by construction -- the date is
# part of the claim, so the number stays true forever. (fourier-chan's diary is
# her own canon besides, and nothing here mints or edits I-nodes.)
EXEMPT_SEGMENTS = ("devlog", "devlogs", "diary", "diaries")
EXEMPT_SUBSTRINGS = (".superseded", ".moved-to-", ".bak", ".orig")

DEFAULT_FIX = "delete the number and name the command that prints it"


class Violation:
    def __init__(self, path: str, line_no: int, text: str, matched: str):
        self.path = path
        self.line_no = line_no
        self.text = text.rstrip("\n")
        self.matched = matched

    def __repr__(self) -> str:
        return "<%s:%d %r>" % (self.path, self.line_no, self.matched)


def is_exempt_path(rel: str) -> bool:
    """A dated record, or a retired file that has left the read path."""
    parts = rel.replace("\\", "/").split("/")
    for p in parts:
        low = p.lower()
        if low in EXEMPT_SEGMENTS:
            return True
        if "devlog" in low or "diary" in low:
            return True
    low_rel = rel.lower()
    return any(s in low_rel for s in EXEMPT_SUBSTRINGS)


def _marked(lines: list[str], i: int) -> bool:
    """Is line `i` covered by a derived-ok marker?

    A marker covers its own line and the PARAGRAPH beneath it, ending at the
    first blank line. Prose wraps, so a number routinely lands two or three
    lines below the sentence that dates it, and a strict one-line marker would
    force the author to reflow the paragraph to satisfy the checker. The blank
    line is what stops it from becoming a file-wide mute button: a marker can
    excuse the claim it introduces and nothing further.
    """
    if MARKER.search(lines[i]):
        return True
    j = i - 1
    while j >= 0 and lines[j].strip():
        if MARKER.search(lines[j]):
            return True
        j -= 1
    return False


def scan_text(rel: str, body: str) -> list[Violation]:
    """Every maintained test-count claim in one document."""
    out: list[Violation] = []
    lines = body.split("\n")
    for i, line in enumerate(lines):
        if _marked(lines, i):
            continue
        for pat in COUNT_PATTERNS:
            m = pat.search(line)
            if m:
                out.append(Violation(rel, i + 1, line, m.group(0).strip()))
                break
    return out


def tracked_documents(root: str) -> list[str]:
    """Tracked AND untracked markdown.

    Untracked needs its own source: a diff-based view is structurally blind to
    a file that was never committed, and a status block living only in an
    untracked doc is read by every session on this machine regardless.
    """
    cmd = ["git", "-C", root, "ls-files", "--cached", "--others",
           "--exclude-standard", "-z", "*.md", "*.markdown"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise RuntimeError("git ls-files failed in %s: %s"
                           % (root, proc.stderr.strip() or proc.returncode))
    return [p for p in proc.stdout.split("\0") if p]


def check(root: str) -> list[Violation]:
    out: list[Violation] = []
    for rel in tracked_documents(root):
        if is_exempt_path(rel):
            continue
        full = os.path.join(root, rel)
        try:
            with open(full, "r", encoding="utf-8", errors="replace") as fh:
                body = fh.read()
        except OSError:
            continue          # deleted between listing and reading; not a claim
        out.extend(scan_text(rel, body))
    return out


def git_root(start: str) -> str:
    proc = subprocess.run(["git", "-C", start, "rev-parse", "--show-toplevel"],
                          capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise RuntimeError("not a git repository: %s" % start)
    return proc.stdout.rstrip("\n")


def report(violations: list[Violation], suite: str) -> str:
    fix = suite or DEFAULT_FIX
    lines = []
    for v in violations:
        lines.append("  %s:%d" % (v.path, v.line_no))
        lines.append("      %s" % v.text.strip()[:100])
        lines.append("      claims: %s" % v.matched)
    lines.append("")
    lines.append("  %d hand-maintained test count(s)." % len(violations))
    lines.append("")
    lines.append("  A test count belongs in the command that produces it. Replace the")
    lines.append("  number with the command, and let the run report it:")
    lines.append("")
    lines.append("      %s" % fix)
    lines.append("")
    lines.append("  If a number is a DATED record rather than a maintained claim, say so")
    lines.append("  on the line or the one above it:")
    lines.append("")
    lines.append("      <!-- derived-ok: session-end snapshot, 2026-08-29 -->")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="refuse hand-maintained facts a command already computes")
    ap.add_argument("--root", default=".", help="repository to check (default: cwd)")
    ap.add_argument("--suite", default="",
                    help="this repo's test command, quoted in the fix line")
    args = ap.parse_args(argv)

    try:
        root = git_root(args.root)
        violations = check(root)
    except Exception as exc:                      # noqa: BLE001 -- surfaced, never swallowed
        # Exit 2, not 0. A check that cannot look must not report clean.
        sys.stderr.write("derived-facts: could not establish truth: %s: %s\n"
                         % (type(exc).__name__, exc))
        return 2

    if not violations:
        print("derived-facts: clean")
        return 0
    print("derived-facts: hand-maintained numbers found\n")
    print(report(violations, args.suite))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
