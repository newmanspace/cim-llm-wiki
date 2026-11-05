"""Gate govulncheck JSON on reachable vulnerable symbols, without a second scan."""
import json
import sys
from pathlib import Path


def main():
    remaining = Path(sys.argv[1]).read_text(encoding="utf-8").strip()
    decoder = json.JSONDecoder()
    events = []
    while remaining:
        event, end = decoder.raw_decode(remaining)
        events.append(event)
        remaining = remaining[end:].lstrip()
    if not any(e.get("config", {}).get("scanner_name") == "govulncheck" for e in events):
        raise ValueError("Missing govulncheck scan configuration")
    if not any(e.get("SBOM", {}).get("modules") for e in events):
        raise ValueError("No Go modules scanned")
    called = {
        event["finding"]["osv"]
        for event in events
        if "finding" in event
        and any(frame.get("function") for frame in event["finding"].get("trace", []))
    }
    print(f"Go reachable vulnerability advisories: {len(called)}")
    for advisory in sorted(called):
        print(advisory)
    return 1 if called else 0


if __name__ == "__main__":
    sys.exit(main())
