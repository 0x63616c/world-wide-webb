# Shared v1 contracts

The critical write path has JSON Schema Draft 2020-12 definitions for events, event batches, receipts, reset requests, and errors. Files under `fixtures/` are deterministic examples and expected domain outcomes. HTTP route inputs/outputs are defined in [http-contracts.md](../docs/technical/http-contracts.md).

Schema validation is necessary, not sufficient: IANA timezone validity, unique IDs within a batch, matching event epoch, participant/device ownership, and generation/attestation validity are semantic checks. `accepted` means accepted observation, not one additional fold. Never upload `expected` fixture values as authoritative totals.

Integers are limited to the exactly representable JSON range even though Swift/Rust support larger values. Compare reset UUIDs as normalized lowercase ASCII strings. Do not serialize enum ordinals or localized strings. Fixture event times near the Unix epoch are synthetic domain inputs, not production-eligible submissions.

F01 turns this catalog into typed DTOs and adds schemas for the remaining operation families before their implementation. Adding optional response fields is compatible; changing required input fields or meanings requires a new contract version. Tests in Swift and Rust consume these same files; neither implementation generates the expected answers for the other.

Validate schemas/examples before editing dependent code:

```sh
python3 -m venv /tmp/folding-contract-check
/tmp/folding-contract-check/bin/pip install -r scripts/requirements-contracts.txt
/tmp/folding-contract-check/bin/python scripts/check-contracts.py
```

This runs schema and rejection checks; it does not execute the future Swift/Rust reducers or device integrations. `lifecycle.json` and `auth-flow.json` define additional acceptance scenarios for those implementations.
