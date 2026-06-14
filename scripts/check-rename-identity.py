#!/usr/bin/env python3
import argparse
import dataclasses
import re
import subprocess
import sys
from pathlib import Path


@dataclasses.dataclass(frozen=True)
class Rule:
    category: str
    path_pattern: re.Pattern[str]
    line_pattern: re.Pattern[str]
    reason: str


@dataclasses.dataclass(frozen=True)
class Finding:
    path: str
    line_number: int
    term: str
    line: str
    category: str | None
    reason: str | None


def identity_pattern() -> re.Pattern[str]:
    return re.compile(
        r"0x63616c/control-center"
        r"|ghcr\.io/0x63616c/control-center"
        r"|\bcontrol-center\b"
        r"|\bcontrol_center\b"
        r"|@repo/"
        r"|@cc/"
    )


def categories() -> set[str]:
    return {
        "repo-platform-identity",
        "control-center-product-identity",
        "historical-only-docs",
        "allowed-compatibility-alias",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit repo rename identity references and require an explicit classification allowlist."
    )
    parser.add_argument(
        "--allowlist",
        default="scripts/rename-identity-allowlist.tsv",
        help="TSV with category, path regex, line regex, reason.",
    )
    parser.add_argument(
        "--format",
        choices=("summary", "tsv"),
        default="summary",
        help="Output format for classified findings.",
    )
    return parser.parse_args()


def load_rules(path: Path) -> list[Rule]:
    if not path.exists():
        raise FileNotFoundError(f"allowlist does not exist: {path}")

    rules: list[Rule] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue

        parts = raw.split("\t")
        if len(parts) != 4:
            raise ValueError(f"{path}:{line_number}: expected 4 tab-separated fields")

        category, path_regex, line_regex, reason = parts
        if category not in categories():
            allowed = ", ".join(sorted(categories()))
            raise ValueError(f"{path}:{line_number}: unknown category {category!r}, expected one of {allowed}")

        rules.append(
            Rule(
                category=category,
                path_pattern=re.compile(path_regex),
                line_pattern=re.compile(line_regex),
                reason=reason,
            )
        )

    return rules


def tracked_files() -> list[Path]:
    output = subprocess.check_output(["git", "ls-files", "-z"])
    return [Path(item.decode()) for item in output.split(b"\0") if item]


def is_text(path: Path) -> bool:
    try:
        path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    return True


def classify(path: str, line: str, rules: list[Rule]) -> tuple[str | None, str | None]:
    for rule in rules:
        if rule.path_pattern.search(path) and rule.line_pattern.search(line):
            return rule.category, rule.reason
    return None, None


def scan(rules: list[Rule]) -> list[Finding]:
    pattern = identity_pattern()
    findings: list[Finding] = []

    for path in tracked_files():
        if not is_text(path):
            continue
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for match in pattern.finditer(line):
                category, reason = classify(path.as_posix(), line, rules)
                findings.append(
                    Finding(
                        path=path.as_posix(),
                        line_number=line_number,
                        term=match.group(0),
                        line=line.strip(),
                        category=category,
                        reason=reason,
                    )
                )

    return findings


def print_summary(findings: list[Finding]) -> None:
    counts: dict[str, int] = {}
    for finding in findings:
        category = finding.category or "UNCLASSIFIED"
        counts[category] = counts.get(category, 0) + 1

    print("Rename identity audit")
    print(f"Total references: {len(findings)}")
    for category in sorted(counts):
        print(f"{category}: {counts[category]}")

    unclassified = [finding for finding in findings if finding.category is None]
    if unclassified:
        print("\nUnclassified references:")
        for finding in unclassified:
            print(f"{finding.path}:{finding.line_number}: {finding.term}: {finding.line}")


def print_tsv(findings: list[Finding]) -> None:
    print("category\tpath\tline\tterm\treason\tcontent")
    for finding in findings:
        print(
            "\t".join(
                [
                    finding.category or "UNCLASSIFIED",
                    finding.path,
                    str(finding.line_number),
                    finding.term,
                    finding.reason or "missing allowlist rule",
                    finding.line,
                ]
            )
        )


def main() -> int:
    args = parse_args()
    try:
        rules = load_rules(Path(args.allowlist))
        findings = scan(rules)
    except (FileNotFoundError, ValueError, re.error, subprocess.CalledProcessError) as error:
        print(f"identity audit failed: {error}", file=sys.stderr)
        return 1

    if args.format == "tsv":
        print_tsv(findings)
    else:
        print_summary(findings)

    return 1 if any(finding.category is None for finding in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
