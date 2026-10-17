"""Build the demo's offline leaderboard snapshot from the repository README."""
import json
import re
import sys
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
REPO = "https://github.com/zhaoyiyidan/modded-nanogpt-npu"


def parse(readme: str):
    section = readme.split("## NPU leaderboard", 1)[1].split("## Below is the original", 1)[0]
    rows = []
    for line in section.splitlines():
        match = re.match(r"^(\d+)\s*\|\s*([\d.]+) minutes\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*\[log\]\((.*?)\)", line)
        if not match:
            continue
        position, minutes, gpu_record, description, log = match.groups()
        optimized = "[optimized]" in description
        clean_description = re.sub(r"\*\*\[optimized\]\*\*\s*", "", description).strip().rstrip(".")
        folder = log.split("/logs/")[0]
        slug = folder.rsplit("/", 1)[-1]
        rows.append({
            "id": slug,
            "historyIndex": int(position),
            "minutes": float(minutes),
            "gpuRecord": int(gpu_record),
            "description": clean_description,
            "optimized": optimized,
            "logUrl": f"{REPO}/blob/master/{log}",
            "sourceUrl": f"{REPO}/tree/master/{folder}/source",
            "recordUrl": f"{REPO}/tree/master/{folder}",
        })
    if not rows:
        raise ValueError("No NPU leaderboard rows found")
    return rows


if __name__ == "__main__":
    if len(sys.argv) > 1:
        readme = Path(sys.argv[1]).read_text(encoding="utf-8")
    else:
        with urlopen("https://raw.githubusercontent.com/zhaoyiyidan/modded-nanogpt-npu/master/README.md") as response:
            readme = response.read().decode("utf-8")
    rows = parse(readme)
    output = ROOT / "dist" / "data.js"
    output.write_text("window.NPU_SNAPSHOT = " + json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Wrote {len(rows)} records to {output}")
