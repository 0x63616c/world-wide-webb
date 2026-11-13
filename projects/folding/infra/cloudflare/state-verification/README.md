# R2 state acceptance check

Run `scripts/check-remote-state.py` in the authorized persistent credential session, with AWS S3 credentials, `TF_VAR_state_passphrase` and boto3 available. It creates two independent OpenTofu clients against a fresh verification key, holds one lock, requires the competing client to fail specifically on lock acquisition, and verifies an encrypted byte-for-byte backup can be restored and decrypted from another key. It does not touch production or staging state.

Verification objects remain in the dedicated bucket as evidence. They contain no app data. The local-exec delay only exists in this verification root, never a deployment root. Use the bootstrap state key from 1Password for this disposable test; deployment roots have their own state keys.
