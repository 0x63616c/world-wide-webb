#!/usr/bin/env python3
"""Transfer only private signing-repository authentication from the existing CI vault."""

import os
import uuid


def main():
    value = os.environ["MATCH_GIT_BASIC_AUTHORIZATION"]
    if not value:
        raise ValueError("Private signing-repository authentication is missing")
    print("::add-mask::" + value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
    delimiter = uuid.uuid4().hex
    with open(os.environ["GITHUB_ENV"], "a") as output:
        output.write(f"MATCH_GIT_BASIC_AUTHORIZATION<<{delimiter}\n{value}\n{delimiter}\n")


if __name__ == "__main__":
    main()
