#!/usr/bin/env python3
"""Compare the recorded startup transcript with the corrected public path.

Requires tiktoken 0.11.0 and the component JSON emitted by the canary's
read-only measure-startup.mjs script.
"""

import argparse
import json
from pathlib import Path

import tiktoken


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--components", required=True, type=Path)
    parser.add_argument("--old-skill", required=True, type=Path)
    parser.add_argument("--old-readme", required=True, type=Path)
    parser.add_argument(
        "--current-skill",
        type=Path,
        default=Path(__file__).parents[1] / "skills/deliver/SKILL.md",
    )
    return parser.parse_args()


def grouped_components(path):
    measured = json.loads(path.read_text())
    grouped = {}
    for component in measured["components"]:
        grouped.setdefault(component["name"], []).append(component["text"])
    return grouped


def main():
    args = arguments()
    if tiktoken.__version__ != "0.11.0":
        raise RuntimeError("This accounting is pinned to tiktoken 0.11.0")

    before_text = grouped_components(args.components)
    old_skill = args.old_skill.read_text()
    old_public = old_skill + args.old_readme.read_text()
    if before_text["directorPublicInstructions"] != [old_public]:
        raise RuntimeError("Recorded public instructions differ from supplied files")

    binding = json.loads(before_text["directorBinding"][0])
    bound_actor = binding["actor"]
    env_argument = "--actor-env 'CODEX_THREAD_ID'"

    def replace_placeholder(text):
        return text.replace("--actor '<actual-native-task-id>'", env_argument)

    def replace_bound_actor(text):
        return text.replace(f"--actor '{bound_actor}'", env_argument)

    current_skill = args.current_skill.read_text()
    skill_output = before_text["workerToolOutput"][0]
    if old_skill not in skill_output:
        raise RuntimeError("Recorded skill output does not contain the supplied skill")

    after_text = {
        "directorSpec": before_text["directorSpec"][0],
        "directorPrepare": replace_placeholder(before_text["directorPrepare"][0]),
        "directorCreationResult": before_text["directorCreationResult"][0],
        "directorBinding": replace_bound_actor(before_text["directorBinding"][0]),
        "workerBrief": replace_placeholder(before_text["workerBrief"][0]),
        "directorPublicInstructions": current_skill,
        "directorNativeRequest": replace_placeholder(
            before_text["directorNativeRequest"][0]
        ),
        "workerToolRequest": (
            before_text["workerToolRequest"][0]
            + replace_bound_actor(before_text["workerToolRequest"][-1])
        ),
        "workerToolOutput": (
            skill_output.replace(old_skill, current_skill)
            + before_text["workerToolOutput"][-1]
        ),
    }
    encoding = tiktoken.get_encoding("o200k_base")
    before = {
        name: sum(len(encoding.encode(text)) for text in texts)
        for name, texts in before_text.items()
    }
    after = {
        name: len(encoding.encode(text)) for name, text in after_text.items()
    }
    result = {
        "method": (
            "o200k_base proxy; same nine declared components; corrected public "
            "path reads the scoped skill and invokes generated start directly"
        ),
        "before": before,
        "beforeTotal": sum(before.values()),
        "after": after,
        "afterTotal": sum(after.values()),
        "reduction": sum(before.values()) - sum(after.values()),
        "nativeQualification": "not exercised",
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
