#!/usr/bin/env python3
"""Run only inside sops exec-env on trusted release jobs. Never write credentials into app sources."""

import os
import uuid

KEYS = {
    "APP_STORE_CONNECT_API__MATCH_PASSWORD": "MATCH_PASSWORD",
    "MATCH_GIT_BASIC_AUTHORIZATION": "MATCH_GIT_BASIC_AUTHORIZATION",
    "APP_STORE_CONNECT_API__KEY_ID": "ASC_KEY_ID",
    "APP_STORE_CONNECT_API__ISSUER_ID": "ASC_ISSUER_ID",
    "APP_STORE_CONNECT_API__P8_CONTENT": "ASC_KEY_CONTENT",
}


def main():
    with open(os.environ["GITHUB_ENV"], "a") as output:
        for source, target in KEYS.items():
            value = os.environ[source]
            print("::add-mask::" + value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
            delimiter = uuid.uuid4().hex
            output.write(f"{target}<<{delimiter}\n{value}\n{delimiter}\n")
        output.write("MATCH_GIT_URL=https://github.com/0x63616c/certificates.git\n")


if __name__ == "__main__":
    main()
