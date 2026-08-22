#!/usr/bin/env python3
"""Run deterministic, local checks against a proposed GitHub README.

The validator deliberately avoids network access. It checks the parts of a
README that can be verified from the repository itself: structure, local
links and images, Mermaid fences, common command provenance, placeholders,
and high-confidence secret patterns.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit


SEVERITY_RANK = {"blocker": 0, "warning": 1, "note": 2}

CANONICAL_HEADINGS = {
    "project snapshot": 0,
    "what it does": 1,
    "key features": 2,
    "architecture": 3,
    "project structure": 4,
    "getting started": 5,
    "usage and examples": 6,
    "configuration": 7,
    "development and testing": 8,
    "deployment and operations": 9,
    "security data and limitations": 10,
    "contributing and support": 11,
    "license and credits": 12,
}

HEADING_ALIASES = {
    "project overview": "project snapshot",
    "overview": "project snapshot",
    "features": "key features",
    "how it works": "architecture",
    "structure": "project structure",
    "quick start": "getting started",
    "installation": "getting started",
    "usage": "usage and examples",
    "examples": "usage and examples",
    "development": "development and testing",
    "testing": "development and testing",
    "deployment": "deployment and operations",
    "operations": "deployment and operations",
    "security": "security data and limitations",
    "contributing": "contributing and support",
    "support": "contributing and support",
    "license": "license and credits",
}

MERMAID_TYPES = {
    "flowchart",
    "graph",
    "sequencediagram",
    "classdiagram",
    "statediagram",
    "erdiagram",
    "journey",
    "gantt",
    "pie",
    "mindmap",
    "timeline",
    "gitgraph",
}

FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)\s]+)")
MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)")
HTML_IMAGE_RE = re.compile(
    r"<img\b[^>]*\bsrc\s*=\s*[\"']([^\"']+)[\"'][^>]*>", re.IGNORECASE
)
HTML_ALT_RE = re.compile(r"\balt\s*=\s*[\"']([^\"']*)[\"']", re.IGNORECASE)
HTML_WIDTH_RE = re.compile(r"\bwidth\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
HTML_HEIGHT_RE = re.compile(r"\bheight\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SOF_MARKERS = {
    0xC0,
    0xC1,
    0xC2,
    0xC3,
    0xC5,
    0xC6,
    0xC7,
    0xC9,
    0xCA,
    0xCB,
    0xCD,
    0xCE,
    0xCF,
}

PLACEHOLDER_PATTERNS = (
    (re.compile(r"\bTODO\b", re.IGNORECASE), "unfinished TODO marker"),
    (re.compile(r"\bTBD\b", re.IGNORECASE), "unfinished TBD marker"),
    (re.compile(r"\bPLACEHOLDER\b", re.IGNORECASE), "placeholder marker"),
    (re.compile(r"<(?:project|repository|organization|username)(?:-[^>]+)?>", re.IGNORECASE), "template placeholder"),
    (re.compile(r"\b(?:your|replace-with|insert)-[a-z0-9_-]+\b", re.IGNORECASE), "template placeholder"),
)

SECRET_PATTERNS = (
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"), "private key material"),
    (re.compile(r"\b(?:ghp|github_pat|glpat|xoxb|xoxp|sk_live|sk_test)-[A-Za-z0-9_-]{12,}\b"), "high-confidence token"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key"),
    (re.compile(r"\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[\"']?[A-Za-z0-9/+=._-]{12,}", re.IGNORECASE), "credential-like assignment"),
)

SHELL_LANGUAGES = {
    "bash",
    "sh",
    "shell",
    "zsh",
    "console",
    "terminal",
    "powershell",
    "pwsh",
    "ps1",
    "cmd",
    "bat",
}

COMMAND_RE = re.compile(
    r"^\s*(?:[$>]\s*)?(?P<command>"
    r"(?:npm|pnpm|yarn|bun|make|docker|cargo|go|dotnet|mvn|gradle|pytest|uv|poetry|pip|pipx|composer|terraform|kubectl|helm)\b.*)$",
    re.IGNORECASE,
)

ENTRY_PATH_RE = re.compile(
    r"^\s*(?:[$>]\s*)?(?:"
    r"npm|pnpm|yarn|bun|python(?:3)?|node|ruby|java|go|cargo|dotnet|mvn|gradle|"
    r"pytest|uv|poetry|pip|pipx|composer|terraform|kubectl|helm|make|docker|"
    r"curl|wget|\.\.?/|https?://"
    r")\b",
    re.IGNORECASE,
)
MARKDOWN_ENTRY_LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)\s]+)")
ENTRY_LANGUAGE_WORDS_RE = re.compile(
    r"\b(?:install|run|start|launch|invoke|execute|clone|usage|quick\s+start)\b",
    re.IGNORECASE,
)

CONSUMABLE_MANIFESTS = (
    "package.json",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "Pipfile",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "composer.json",
    "Gemfile",
)
CONSUMABLE_GLOBS = ("*.sln", "*.csproj", "Dockerfile", "Dockerfile.*")
SOURCE_LAYOUT_DIRECTORIES = ("src", "app", "lib", "cmd", "bin", "packages")


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    message: str
    line: int | None = None
    path: str | None = None

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class CodeBlock:
    start_line: int
    end_line: int
    info: str
    content: tuple[str, ...]


def normalize_heading(value: str) -> str:
    value = value.strip().lower().replace("&", "and")
    value = re.sub(r"[`*_]", "", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def canonical_heading(value: str) -> str | None:
    normalized = normalize_heading(value)
    if normalized in CANONICAL_HEADINGS:
        return normalized
    return HEADING_ALIASES.get(normalized)


def add_finding(
    findings: list[Finding],
    severity: str,
    code: str,
    message: str,
    line: int | None = None,
    path: str | None = None,
) -> None:
    findings.append(Finding(severity, code, message, line, path))


def parse_headings(lines: list[str], findings: list[Finding]) -> list[tuple[int, int, str]]:
    headings: list[tuple[int, int, str]] = []
    previous_level: int | None = None
    h1_lines: list[int] = []

    for line_number, line in enumerate(lines, start=1):
        match = HEADING_RE.match(line)
        if not match:
            continue
        level = len(match.group(1))
        title = match.group(2).strip()
        headings.append((line_number, level, title))
        if level == 1:
            h1_lines.append(line_number)
        if previous_level is not None and level > previous_level + 1:
            add_finding(
                findings,
                "warning",
                "HEADING_JUMP",
                f"Heading level jumps from H{previous_level} to H{level}.",
                line_number,
            )
        previous_level = level

    if not h1_lines:
        add_finding(findings, "warning", "MISSING_TITLE", "README has no Markdown H1 project title.")
    elif len(h1_lines) > 1:
        add_finding(
            findings,
            "warning",
            "MULTIPLE_TITLES",
            f"README has {len(h1_lines)} H1 headings; keep one project title when possible.",
            h1_lines[1],
        )

    last_index = -1
    seen_canonical: dict[str, int] = {}
    for line_number, _, title in headings:
        key = canonical_heading(title)
        if key is None:
            continue
        index = CANONICAL_HEADINGS[key]
        if key in seen_canonical:
            add_finding(
                findings,
                "warning",
                "DUPLICATE_SECTION",
                f"Canonical section '{title}' appears more than once.",
                line_number,
            )
        if index < last_index:
            add_finding(
                findings,
                "warning",
                "SECTION_ORDER",
                f"Section '{title}' is out of the README contract order.",
                line_number,
            )
        last_index = max(last_index, index)
        seen_canonical[key] = line_number

    if headings and not any(canonical_heading(title) == "project snapshot" for _, _, title in headings):
        add_finding(
            findings,
            "note",
            "NO_SNAPSHOT",
            "README does not expose a recognizable Project Snapshot section.",
        )

    return headings


def parse_code_blocks(lines: list[str], findings: list[Finding]) -> list[CodeBlock]:
    blocks: list[CodeBlock] = []
    active_char: str | None = None
    active_length = 0
    active_start = 0
    active_info = ""
    active_content: list[str] = []

    for line_number, line in enumerate(lines, start=1):
        match = FENCE_RE.match(line)
        if match:
            marker = match.group(1)
            char = marker[0]
            length = len(marker)
            info = match.group(2).strip()
            if active_char is None:
                active_char = char
                active_length = length
                active_start = line_number
                active_info = info
                active_content = []
            elif char == active_char and length >= active_length:
                blocks.append(CodeBlock(active_start, line_number, active_info, tuple(active_content)))
                active_char = None
                active_length = 0
                active_start = 0
                active_info = ""
                active_content = []
            else:
                active_content.append(line)
            continue

        if active_char is not None:
            active_content.append(line)

    if active_char is not None:
        add_finding(
            findings,
            "blocker",
            "UNCLOSED_FENCE",
            f"Code fence opened on line {active_start} is not closed.",
            active_start,
        )
        blocks.append(CodeBlock(active_start, len(lines), active_info, tuple(active_content)))

    return blocks


def is_external_target(target: str) -> bool:
    parsed = urlsplit(target)
    return bool(parsed.scheme or parsed.netloc) or target.startswith(("//", "data:"))


def local_target(target: str) -> str:
    cleaned = target.strip().strip("<>")
    parsed = urlsplit(cleaned)
    return unquote(parsed.path)


def resolve_local_target(repo: Path, readme: Path, target: str) -> Path | None:
    if not target or target.startswith("#") or is_external_target(target):
        return None

    path_part = local_target(target)
    if not path_part:
        return None

    candidate = (repo / path_part.lstrip("/")) if path_part.startswith("/") else (readme.parent / path_part)
    candidate = candidate.resolve()
    try:
        candidate.relative_to(repo.resolve())
    except ValueError:
        return None
    return candidate


def read_image_dimensions(path: Path) -> tuple[int, int] | None:
    """Read PNG or JPEG dimensions without requiring Pillow or network access."""

    try:
        with path.open("rb") as handle:
            header = handle.read(24)
            if header.startswith(PNG_SIGNATURE) and len(header) >= 24:
                width, height = struct.unpack(">II", header[16:24])
                return width, height

            if not header.startswith(b"\xff\xd8"):
                return None

            handle.seek(2)
            while True:
                byte = handle.read(1)
                if not byte:
                    return None
                if byte != b"\xff":
                    continue

                marker_byte = handle.read(1)
                while marker_byte == b"\xff":
                    marker_byte = handle.read(1)
                if not marker_byte:
                    return None
                marker = marker_byte[0]

                if marker == 0xD9:
                    return None
                if marker in {0xD8, 0x01} or 0xD0 <= marker <= 0xD7:
                    continue

                length_bytes = handle.read(2)
                if len(length_bytes) != 2:
                    return None
                segment_length = struct.unpack(">H", length_bytes)[0]
                if segment_length < 2:
                    return None

                if marker in JPEG_SOF_MARKERS:
                    frame = handle.read(segment_length - 2)
                    if len(frame) < 5:
                        return None
                    height, width = struct.unpack(">HH", frame[1:5])
                    return width, height

                handle.seek(segment_length - 2, 1)
    except (OSError, struct.error, ValueError):
        return None


def parse_dimension_value(value: str) -> tuple[float, str] | None:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(px|%)?\s*", value, re.IGNORECASE)
    if not match:
        return None
    unit = (match.group(2) or "px").lower()
    return float(match.group(1)), unit


def check_hero_image_sizing(
    repo: Path,
    readme: Path,
    target: str,
    element: str | None,
    line: int,
    is_first_image: bool,
    findings: list[Finding],
) -> bool:
    """Check a local first image for practical 2:1 hero sizing guidance."""

    if not is_first_image:
        return False

    candidate = resolve_local_target(repo, readme, target)
    if candidate is None or not candidate.is_file():
        return False

    dimensions = read_image_dimensions(candidate)
    if dimensions is None:
        return False

    width, height = dimensions
    if width <= 0 or height <= 0:
        return False

    aspect_ratio = width / height
    if not 1.6 <= aspect_ratio <= 2.4:
        return True

    width_attribute = HTML_WIDTH_RE.search(element or "")
    height_attribute = HTML_HEIGHT_RE.search(element or "")
    display_fraction = 1.0
    display_pixels = 830.0

    if width_attribute:
        parsed_width = parse_dimension_value(width_attribute.group(1))
        if parsed_width:
            value, unit = parsed_width
            if unit == "%":
                display_fraction = value / 100
                display_pixels = 830.0 * display_fraction
            else:
                display_fraction = value / 830.0
                display_pixels = value

    rendered_height = display_pixels / aspect_ratio

    if width > 1280:
        add_finding(
            findings,
            "note",
            "BANNER_SOURCE_LARGE",
            f"The first local 2:1-style hero is {width}x{height}; consider a proportional copy near 1280x640.",
            line,
        )

    if height_attribute:
        add_finding(
            findings,
            "note",
            "BANNER_FIXED_HEIGHT",
            "Hero image declares a fixed height; omit height unless the aspect ratio is intentionally controlled.",
            line,
        )

    if display_fraction >= 0.9 or rendered_height > 320:
        width_value = width_attribute.group(1) if width_attribute else "implicit full width"
        add_finding(
            findings,
            "warning",
            "BANNER_RENDER_WIDTH",
            f"The first local 2:1-style hero uses {width_value} and is likely to render about {rendered_height:.0f}px tall at an 830px README width; consider width=70-75%.",
            line,
        )

    return True


def check_local_target(
    repo: Path,
    readme: Path,
    target: str,
    line: int,
    findings: list[Finding],
    kind: str,
) -> None:
    if not target or target.startswith("#") or is_external_target(target):
        return

    path_part = local_target(target)
    if not path_part:
        return

    candidate = (repo / path_part.lstrip("/")) if path_part.startswith("/") else (readme.parent / path_part)
    candidate = candidate.resolve()
    try:
        candidate.relative_to(repo.resolve())
    except ValueError:
        add_finding(
            findings,
            "warning",
            "PATH_OUTSIDE_REPO",
            f"{kind} target resolves outside the repository: {target}",
            line,
        )
        return

    if not candidate.exists():
        add_finding(
            findings,
            "warning",
            "MISSING_LOCAL_TARGET",
            f"Local {kind} target does not exist: {target}",
            line,
        )


def check_links_and_images(
    repo: Path,
    readme: Path,
    lines: list[str],
    findings: list[Finding],
) -> dict[str, int]:
    links_checked = 0
    images_checked = 0
    image_dimensions_checked = 0

    for line_number, line in enumerate(lines, start=1):
        for match in MARKDOWN_LINK_RE.finditer(line):
            links_checked += 1
            check_local_target(repo, readme, match.group(1), line_number, findings, "link")

        for match in MARKDOWN_IMAGE_RE.finditer(line):
            is_first_image = images_checked == 0
            images_checked += 1
            alt = match.group(1).strip()
            if not alt:
                add_finding(
                    findings,
                    "warning",
                    "IMAGE_ALT",
                    "Markdown image is missing useful alt text.",
                    line_number,
                )
            check_local_target(repo, readme, match.group(2), line_number, findings, "image")
            if check_hero_image_sizing(
                repo,
                readme,
                match.group(2),
                None,
                line_number,
                is_first_image,
                findings,
            ):
                image_dimensions_checked += 1

        for match in HTML_IMAGE_RE.finditer(line):
            is_first_image = images_checked == 0
            images_checked += 1
            element = match.group(0)
            alt_match = HTML_ALT_RE.search(element)
            if not alt_match or not alt_match.group(1).strip():
                add_finding(
                    findings,
                    "warning",
                    "IMAGE_ALT",
                    "HTML image is missing useful alt text.",
                    line_number,
                )
            check_local_target(repo, readme, match.group(1), line_number, findings, "image")
            if check_hero_image_sizing(
                repo,
                readme,
                match.group(1),
                element,
                line_number,
                is_first_image,
                findings,
            ):
                image_dimensions_checked += 1

    return {
        "links_checked": links_checked,
        "images_checked": images_checked,
        "image_dimensions_checked": image_dimensions_checked,
    }


def check_placeholders_and_secrets(lines: list[str], findings: list[Finding]) -> dict[str, int]:
    placeholders = 0
    secrets = 0
    for line_number, line in enumerate(lines, start=1):
        for pattern, description in PLACEHOLDER_PATTERNS:
            if pattern.search(line):
                placeholders += 1
                add_finding(
                    findings,
                    "warning",
                    "PLACEHOLDER",
                    f"README contains a {description}.",
                    line_number,
                )
        for pattern, description in SECRET_PATTERNS:
            if pattern.search(line):
                secrets += 1
                severity = "blocker" if "private key" in description or "token" in description or "access key" in description else "warning"
                add_finding(
                    findings,
                    severity,
                    "POSSIBLE_SECRET",
                    f"README contains possible {description}; remove or redact it.",
                    line_number,
                )
    return {"placeholders": placeholders, "possible_secrets": secrets}


def first_meaningful_line(content: tuple[str, ...]) -> str:
    for line in content:
        stripped = line.strip()
        if stripped and not stripped.startswith("%%"):
            return stripped
    return ""


def check_mermaid(blocks: list[CodeBlock], findings: list[Finding]) -> int:
    mermaid_count = 0
    flow_like_types = {
        "flowchart",
        "graph",
        "sequencediagram",
        "classdiagram",
        "statediagram",
        "erdiagram",
        "journey",
        "gitgraph",
    }
    edge_re = re.compile(r"(?:-->|-.->|==>|---|--x|<--|<->|->>|-\.-)")
    visible_entry_re = re.compile(
        r"\b(?:user|client|consumer|operator|developer|browser|input|request|command|"
        r"source|trigger|start|entry)\b",
        re.IGNORECASE,
    )
    for block in blocks:
        info = block.info.strip().split()[0].lower() if block.info.strip() else ""
        if info != "mermaid":
            continue
        mermaid_count += 1
        first = first_meaningful_line(block.content)
        if not first:
            add_finding(findings, "blocker", "EMPTY_MERMAID", "Mermaid block is empty.", block.start_line)
            continue

        first_token = re.split(r"\s+", first, maxsplit=1)[0].lower()
        if first_token not in MERMAID_TYPES:
            add_finding(
                findings,
                "warning",
                "MERMAID_TYPE",
                f"Mermaid block starts with an unrecognized diagram type: {first_token}.",
                block.start_line + 1,
            )

        if first_token == "flowchart":
            parts = first.split()
            if len(parts) < 2 or parts[1].upper() not in {"TB", "TD", "BT", "RL", "LR"}:
                add_finding(
                    findings,
                    "warning",
                    "MERMAID_DIRECTION",
                    "Flowchart should declare a direction such as LR or TB.",
                    block.start_line + 1,
                )

        if first_token in flow_like_types:
            visible_lines = [line for line in block.content if not line.strip().startswith("%%")]
            diagram_text = "\n".join(visible_lines)
            if not edge_re.search(diagram_text):
                add_finding(
                    findings,
                    "warning",
                    "MERMAID_NO_FLOW",
                    "Mermaid diagram has no visible relationship or flow edge; show how at least two evidenced elements connect.",
                    block.start_line,
                )
            if not visible_entry_re.search(diagram_text):
                add_finding(
                    findings,
                    "warning",
                    "MERMAID_ENTRY_POINT",
                    "Mermaid diagram has no visible user, client, input, request, command, source, or other entry-point label.",
                    block.start_line,
                )

        subgraph_count = sum(1 for line in block.content if line.strip().lower().startswith("subgraph "))
        end_count = sum(1 for line in block.content if line.strip().lower() == "end")
        if subgraph_count != end_count:
            add_finding(
                findings,
                "warning",
                "MERMAID_SUBGRAPH",
                f"Mermaid subgraph count ({subgraph_count}) does not match end count ({end_count}).",
                block.start_line,
            )

        if any("<script" in line.lower() or "javascript:" in line.lower() for line in block.content):
            add_finding(
                findings,
                "blocker",
                "MERMAID_UNSAFE_LABEL",
                "Mermaid block contains script-like content.",
                block.start_line,
            )

    return mermaid_count


def find_file(repo: Path, names: tuple[str, ...]) -> Path | None:
    lower_names = {name.lower() for name in names}
    for candidate in repo.iterdir():
        if candidate.name.lower() in lower_names:
            return candidate
    return None


def has_any_file(repo: Path, names: tuple[str, ...]) -> bool:
    return find_file(repo, names) is not None


def detect_consumable_project(repo: Path) -> tuple[bool | None, str]:
    """Classify whether the repository needs an executable entry path.

    A recognized package, build, or container manifest is positive evidence.
    A repository with only documentation-shaped top-level content is negative
    evidence.  A source-shaped layout without a recognized manifest remains
    unknown so the validator can report an uncertainty instead of inventing a
    required chapter.
    """

    if has_any_file(repo, CONSUMABLE_MANIFESTS) or any(
        any(repo.glob(pattern)) for pattern in CONSUMABLE_GLOBS
    ):
        return True, "recognized executable, installable, or consumable manifest"

    if any((repo / directory).is_dir() for directory in SOURCE_LAYOUT_DIRECTORIES):
        return None, "source-shaped layout without a recognized project manifest"

    return False, "no executable, installable, or consumable project evidence detected"


def section_body(
    lines: list[str],
    headings: list[tuple[int, int, str]],
    requested: str,
) -> list[str] | None:
    for index, (line_number, _, title) in enumerate(headings):
        if canonical_heading(title) != requested:
            continue
        next_heading_line = headings[index + 1][0] if index + 1 < len(headings) else len(lines) + 1
        return lines[line_number:next_heading_line - 1]
    return None


def check_structural_minimum(
    repo: Path,
    lines: list[str],
    headings: list[tuple[int, int, str]],
    findings: list[Finding],
) -> dict[str, object]:
    """Validate mandatory spine elements and evidence-backed conditional chapters."""

    present = {
        key
        for _, _, title in headings
        if (key := canonical_heading(title)) is not None
    }

    for required in ("project snapshot", "what it does"):
        if required not in present:
            display_name = required.title()
            add_finding(
                findings,
                "blocker",
                "REQUIRED_SECTION",
                f"README is missing the required '{display_name}' section.",
            )

    consumable, evidence_reason = detect_consumable_project(repo)
    getting_started_body = section_body(lines, headings, "getting started")
    if consumable is True and "getting started" not in present:
        add_finding(
            findings,
            "blocker",
            "REQUIRED_GETTING_STARTED",
            "Repository evidence indicates an executable, installable, or consumable project, but the README has no Getting Started section.",
        )

    entry_path = "not-applicable"
    if getting_started_body is not None:
        body_text = "\n".join(getting_started_body)
        has_command = any(ENTRY_PATH_RE.search(line) for line in getting_started_body)
        has_link = bool(MARKDOWN_ENTRY_LINK_RE.search(body_text))
        has_entry_path = has_command or has_link
        has_weak_instruction = bool(ENTRY_LANGUAGE_WORDS_RE.search(body_text))
        entry_path = "strong" if has_entry_path else "weak" if has_weak_instruction else "missing"

        if not has_entry_path:
            severity = "warning" if consumable is not False else "note"
            code = "ENTRY_PATH_WEAK" if has_weak_instruction else "ENTRY_PATH_MISSING"
            add_finding(
                findings,
                severity,
                code,
                "Getting Started does not contain a visible executable command or confirmed local link for the reader's entry path.",
            )
    elif consumable is None:
        add_finding(
            findings,
            "note",
            "GETTING_STARTED_UNCERTAIN",
            f"{evidence_reason}; Getting Started was not required, but the conditional chapter should be reviewed manually.",
        )

    return {
        "required_sections": ["project snapshot", "what it does"],
        "consumable_project": consumable,
        "consumable_evidence": evidence_reason,
        "getting_started_present": "getting started" in present,
        "entry_path": entry_path,
    }


def check_documented_commands(
    repo: Path,
    blocks: list[CodeBlock],
    findings: list[Finding],
) -> int:
    commands_checked = 0
    package_manifest = find_file(repo, ("package.json",))
    package_scripts: set[str] = set()
    if package_manifest:
        try:
            package_data = json.loads(package_manifest.read_text(encoding="utf-8"))
            package_scripts = set((package_data.get("scripts") or {}).keys())
        except (OSError, json.JSONDecodeError):
            add_finding(
                findings,
                "warning",
                "MANIFEST_READ",
                f"Could not parse {package_manifest.name} to verify package scripts.",
            )

    makefile = find_file(repo, ("Makefile", "makefile"))
    make_targets: set[str] = set()
    if makefile:
        try:
            for line in makefile.read_text(encoding="utf-8").splitlines():
                match = re.match(r"^([A-Za-z0-9_.-]+)\s*:", line)
                if match:
                    make_targets.add(match.group(1))
        except OSError:
            add_finding(findings, "warning", "MAKEFILE_READ", f"Could not read {makefile.name}.")

    shell_blocks = [
        block
        for block in blocks
        if (block.info.strip().split()[0].lower() if block.info.strip() else "") in SHELL_LANGUAGES
    ]

    for block in shell_blocks:
        for offset, raw_line in enumerate(block.content, start=block.start_line + 1):
            line = raw_line.strip()
            if not line or line.startswith(("#", "//")):
                continue
            command_match = COMMAND_RE.match(line)
            if not command_match:
                continue
            command = command_match.group("command").strip()
            commands_checked += 1
            lowered = command.lower()

            script_match = re.match(r"(?:npm|pnpm|yarn|bun)\s+run\s+([A-Za-z0-9:_-]+)", command, re.IGNORECASE)
            if script_match:
                script_name = script_match.group(1)
                if not package_manifest:
                    add_finding(
                        findings,
                        "warning",
                        "COMMAND_SOURCE_MISSING",
                        f"Package script '{script_name}' is documented but no package.json exists.",
                        offset,
                    )
                elif script_name not in package_scripts:
                    add_finding(
                        findings,
                        "warning",
                        "UNKNOWN_PACKAGE_SCRIPT",
                        f"Documented package script '{script_name}' is not defined in {package_manifest.name}.",
                        offset,
                    )
                continue

            make_match = re.match(r"make(?:\s+([A-Za-z0-9_.-]+))?", command, re.IGNORECASE)
            if make_match:
                target = make_match.group(1)
                if not makefile:
                    add_finding(
                        findings,
                        "warning",
                        "COMMAND_SOURCE_MISSING",
                        "Make command is documented but no Makefile exists.",
                        offset,
                    )
                elif target and target not in make_targets:
                    add_finding(
                        findings,
                        "warning",
                        "UNKNOWN_MAKE_TARGET",
                        f"Documented make target '{target}' is not defined in {makefile.name}.",
                        offset,
                    )
                continue

            if lowered.startswith("docker compose"):
                if not has_any_file(repo, ("compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml")):
                    add_finding(
                        findings,
                        "warning",
                        "COMMAND_SOURCE_MISSING",
                        "Docker Compose command is documented but no Compose file exists.",
                        offset,
                    )
                continue

            if lowered.startswith("docker build") and not has_any_file(repo, ("Dockerfile",)):
                add_finding(
                    findings,
                    "warning",
                    "COMMAND_SOURCE_MISSING",
                    "Docker build command is documented but no Dockerfile exists.",
                    offset,
                )
                continue

            tool_requirements = {
                "cargo": ("Cargo.toml",),
                "go": ("go.mod",),
                "dotnet": ("*.sln", "*.csproj"),
                "mvn": ("pom.xml",),
                "gradle": ("build.gradle", "build.gradle.kts", "gradlew"),
                "pytest": ("pyproject.toml", "pytest.ini", "setup.cfg"),
                "uv": ("pyproject.toml",),
                "poetry": ("pyproject.toml",),
                "pip": ("pyproject.toml", "requirements.txt", "setup.py"),
                "pipx": ("pyproject.toml", "setup.py"),
                "composer": ("composer.json",),
                "terraform": ("main.tf", "terraform.tf"),
                "kubectl": ("k8s", "kubernetes"),
                "helm": ("Chart.yaml",),
            }
            tool = lowered.split()[0]
            required = tool_requirements.get(tool)
            if required and not any(
                (repo / item).exists() if not item.startswith("*") else any(repo.glob(item))
                for item in required
            ):
                add_finding(
                    findings,
                    "warning",
                    "COMMAND_SOURCE_MISSING",
                    f"Documented {tool} command has no obvious repository source file.",
                    offset,
                )

    return commands_checked


def validate_repository(repo: Path, readme: Path) -> dict[str, object]:
    findings: list[Finding] = []
    repo = repo.resolve()
    readme = readme.resolve()

    if not repo.is_dir():
        add_finding(findings, "blocker", "REPO_MISSING", f"Repository path does not exist: {repo}")
        return build_report(repo, readme, findings, {})

    if not readme.exists():
        add_finding(findings, "blocker", "README_MISSING", f"README path does not exist: {readme}")
        return build_report(repo, readme, findings, {})

    try:
        readme.relative_to(repo)
    except ValueError:
        add_finding(findings, "blocker", "README_OUTSIDE_REPO", "README path is outside the repository root.")

    try:
        text = readme.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        add_finding(findings, "blocker", "README_ENCODING", "README is not valid UTF-8.")
        return build_report(repo, readme, findings, {})
    except OSError as exc:
        add_finding(findings, "blocker", "README_READ", f"Could not read README: {exc}")
        return build_report(repo, readme, findings, {})

    lines = text.splitlines()
    headings = parse_headings(lines, findings)
    blocks = parse_code_blocks(lines, findings)
    structure_checks = check_structural_minimum(repo, lines, headings, findings)
    path_checks = check_links_and_images(repo, readme, lines, findings)
    text_checks = check_placeholders_and_secrets(lines, findings)
    mermaid_count = check_mermaid(blocks, findings)
    commands_checked = check_documented_commands(repo, blocks, findings)

    checks: dict[str, object] = {
        "line_count": len(lines),
        "heading_count": len(headings),
        "code_blocks": len(blocks),
        "mermaid_blocks": mermaid_count,
        "commands_checked": commands_checked,
        **structure_checks,
        **path_checks,
        **text_checks,
    }
    return build_report(repo, readme, findings, checks)


def build_report(
    repo: Path,
    readme: Path,
    findings: list[Finding],
    checks: dict[str, object],
) -> dict[str, object]:
    findings.sort(key=lambda item: (SEVERITY_RANK.get(item.severity, 9), item.line or 0, item.code))
    counts = {severity: sum(1 for item in findings if item.severity == severity) for severity in SEVERITY_RANK}
    return {
        "repo": str(repo),
        "readme": str(readme),
        "checks": checks,
        "summary": counts,
        "findings": [item.as_dict() for item in findings],
    }


def render_text(report: dict[str, object]) -> str:
    summary = report["summary"]
    lines = [
        f"README validation: {report['readme']}",
        f"Findings: {summary['blocker']} blocker(s), {summary['warning']} warning(s), {summary['note']} note(s)",
    ]
    checks = report.get("checks") or {}
    if checks:
        lines.append("Checks: " + ", ".join(f"{key}={value}" for key, value in checks.items()))
    for finding in report["findings"]:
        location = f":{finding['line']}" if finding.get("line") else ""
        lines.append(f"[{finding['severity'].upper()}] {finding['code']}{location}: {finding['message']}")
    return "\n".join(lines)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path, help="Repository root to validate")
    parser.add_argument("--readme", type=Path, help="README path; defaults to <repo>/README.md")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    parser.add_argument("--strict", action="store_true", help="Return non-zero for warnings as well as blockers")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    repo = args.repo.resolve()
    readme = (args.readme or (repo / "README.md")).resolve()
    report = validate_repository(repo, readme)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(render_text(report))

    summary = report["summary"]
    if summary["blocker"]:
        return 1
    if args.strict and summary["warning"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
