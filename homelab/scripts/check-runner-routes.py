#!/usr/bin/env python3
"""Fail closed before mixing OS profiles in an allowlisted Actions repository.

Requires PyYAML. Audit local/reusable workflow definitions at their exact refs;
external reusable workflows and dynamic runner selection need separate review.
"""
import argparse
import pathlib
import sys
import yaml

SHARED = {'self-hosted', 'arm64'}
MAC = {'macos', 'homelab-tart'}
LINUX = {'linux', 'homelab-linux', 'homelab-operations'}


def job_problem(job):
    route = job.get('runs-on')
    if route is None:
        if str(job.get('uses', '')).startswith('./.github/workflows/'):
            return None  # All local workflow files are inspected below.
        return 'review the exact external reusable workflow and its runner routes'
    if isinstance(route, dict):
        route = route.get('labels')
    labels = route if isinstance(route, list) else [route]
    if not labels or any(not isinstance(label, str) or '${{' in label for label in labels):
        return 'replace dynamic runner selection with an audited explicit platform route'
    labels = {label.lower() for label in labels}
    if {'homelab-linux', 'homelab-operations'} <= labels:
        return 'runner route mixes build and operations profiles'
    if labels & MAC and labels & LINUX:
        return 'runner route mixes macOS and Linux labels'
    # Generic labels can match either platform even without self-hosted present.
    if labels & SHARED and not labels & (MAC | LINUX):
        return 'generic runner labels need macOS/Linux or a unique homelab routing label'
    return None


def audit(repository):
    problems = []
    files = sorted((repository / '.github/workflows').glob('*.y*ml'))
    if not files:
        return ['no workflow files found; verify the repository/ref before approval']
    for path in files:
        try:
            document = yaml.safe_load(path.read_text())
            jobs = document.get('jobs', {})
            if not isinstance(jobs, dict) or not jobs:
                raise ValueError('workflow has no jobs mapping')
            for name, job in jobs.items():
                if not isinstance(job, dict):
                    raise ValueError('invalid job mapping')
                problem = job_problem(job)
                if problem:
                    problems.append(f'{path.relative_to(repository)}:{name}: {problem}')
        except (OSError, ValueError, yaml.YAMLError, AttributeError) as error:
            problems.append(f'{path.relative_to(repository)}: cannot audit workflow ({type(error).__name__})')
    return problems


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', type=pathlib.Path)
    args = parser.parse_args()
    findings = audit(args.repository)
    for finding in findings:
        print(finding, file=sys.stderr)
    if not findings:
        print('Static workflow routes passed. Verify external refs and repository trust before approval.')
    sys.exit(bool(findings))
