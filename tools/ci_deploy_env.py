#!/usr/bin/env python3
"""Export only the deployment credentials from one trusted sops exec-env call."""
import os
from pathlib import Path
import uuid


def main():
    with open(os.environ['GITHUB_ENV'], 'a') as output:
        for source, target in [('TAILSCALE_OAUTH_CLIENT__CLIENT_ID','TS_CLIENT_ID'),
                               ('TAILSCALE_OAUTH_CLIENT__CLIENT_SECRET','TS_CLIENT_SECRET')]:
            value=os.environ[source]
            print('::add-mask::'+value.replace('%','%25').replace('\r','%0D').replace('\n','%0A'))
            delimiter=uuid.uuid4().hex
            output.write(f'{target}<<{delimiter}\n{value}\n{delimiter}\n')
    key=Path(os.environ['RUNNER_TEMP'])/'mini-key'
    key.touch(mode=0o600,exist_ok=False)
    key.write_text(os.environ['HOMELAB_SSH__PRIVATE_KEY']+'\n')


if __name__ == '__main__':
    main()
