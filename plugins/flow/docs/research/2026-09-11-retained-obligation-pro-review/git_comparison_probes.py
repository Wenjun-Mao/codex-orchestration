#!/usr/bin/env python3
"""Synthetic Git-only controls. Does not execute Codex Flow or touch a pilot."""
import json
import os
import subprocess
import tempfile
from pathlib import Path


def git(root: Path, *args: str) -> str:
    p = subprocess.run(["git", "-C", str(root), *args], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1",
                            "GIT_CONFIG_GLOBAL": os.devnull})
    return p.stdout.decode("utf-8")


def init(root: Path) -> None:
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.name", "Isolated review fixture")
    git(root, "config", "user.email", "fixture@example.invalid")


def write(root: Path, path: str, text: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def commit(root: Path, message: str) -> str:
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", message)
    return git(root, "rev-parse", "HEAD").strip()


def fields(text: str) -> list[str]:
    return [v for v in text.split("\0") if v]


def run() -> dict:
    results = {"scope": "Synthetic real-Git experiments only; no Codex Flow library or CLI was executed.",
               "git_version": subprocess.check_output(["git", "--version"], text=True).strip(),
               "probes": []}
    with tempfile.TemporaryDirectory(prefix="flow-review-git-only-") as tmp:
        root = Path(tmp)
        init(root)
        write(root, "src/allowed.txt", "baseline\n")
        baseline = commit(root, "baseline")
        path = "docs/verification/ledger.md"
        write(root, path, "out-of-scope committed ledger\n")
        violation = commit(root, "add outside assumed coordinator scope src")
        (root / path).unlink()
        final = commit(root, "remove ledger")
        endpoint = fields(git(root, "diff", "--name-only", "-z", baseline, final, "--"))
        history = []
        for rev in git(root, "rev-list", "--reverse", f"{baseline}..{final}").splitlines():
            history.append({"commit": rev, "changed_paths": fields(git(root, "diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", rev))})
        assert endpoint == [] and all(path in r["changed_paths"] for r in history)
        results["probes"].append({"name": "committed addition then reversion", "baseline": baseline,
            "adding_commit": violation, "final": final, "endpoint_paths": endpoint,
            "per_commit_paths": history, "control_passed": True})

        write(root, "docs/outside.txt", "identical rename payload\n")
        before_rename = commit(root, "seed inherited outside file")
        git(root, "mv", "docs/outside.txt", "src/moved.txt")
        after_rename = commit(root, "rename into assumed allowed scope")
        name_only = fields(git(root, "diff", "--name-only", "-M", "-z", before_rename, after_rename, "--"))
        both = fields(git(root, "diff", "--name-status", "--no-renames", "-z", before_rename, after_rename, "--"))
        assert name_only == ["src/moved.txt"]
        assert "docs/outside.txt" in both and "src/moved.txt" in both
        results["probes"].append({"name": "rename deletes outside path and adds inside path", "baseline": before_rename,
            "final": after_rename, "rename_detecting_name_only": name_only,
            "no_rename_name_status": both, "control_passed": True})

        before_child = git(root, "rev-parse", "HEAD").strip()
        child_path = "docs/child-result.md"
        write(root, child_path, "authorized child content\n")
        child_tip = commit(root, "synthetic authorized child transition")
        write(root, child_path, "coordinator overwrites child content\n")
        coordinator_tip = commit(root, "synthetic unauthorized coordinator transition")
        total_paths = set(fields(git(root, "diff", "--name-only", "--no-renames", "-z", before_child, coordinator_tip, "--")))
        child_paths = set(fields(git(root, "diff", "--name-only", "--no-renames", "-z", before_child, child_tip, "--")))
        residual_by_name = sorted(total_paths - child_paths)
        own_transition = fields(git(root, "diff", "--name-only", "--no-renames", "-z", child_tip, coordinator_tip, "--"))
        assert residual_by_name == [] and own_transition == [child_path]
        results["probes"].append({"name": "child path-name subtraction hides a later coordinator edit", "baseline": before_child,
            "child_tip": child_tip, "final": coordinator_tip, "naive_residual_path_names": residual_by_name,
            "coordinator_transition_paths": own_transition, "control_passed": True})
    results["assertions_passed"] = 3
    return results


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
