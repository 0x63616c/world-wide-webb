# November 7 SQLite outage

## Observed failure and recovery

The user switched off the NAS around 18:38 Pacific. The first retained database errors
were at 2026-11-08T02:38:07Z, after the current Rust image started at 02:33:34Z.
At investigation the service returned HTTP 503 `Storage unavailable`; all DB-backed
workers failed. The 371,941,376-byte database had a zeroed header and 318 entirely
zero 4-KiB pages. Compared with the 18:33 pre-release snapshot, 90,485 of 90,806 pages
matched and 321 differed. The original logs discarded SQLite's underlying error code.

The database was a macOS SSD file at `~/www-control-center/data/sqlite`, mounted
into Linux via VirtioFS. It was not on NFS/SMB, a symlink to the NAS or a NAS mount;
33 GiB of SSD space remained. Both the macOS and Linux permission checks passed.
The NAS remained unreachable during successful recovery.

The writer was stopped and the complete damaged directory retained under
`~/www-control-center/backups/incident-20261108T043336Z`. Its database SHA-256 is
`2e658a1501e15f9121fdc25630127ca143273065d11c63363e2e74c728f90285`.
The 18:33 pre-release snapshot passed full integrity and foreign-key checks and was
restored at 20:34 Pacific. It contained 136 photo rows, 11 walks and 18 notifications.
Changes committed after that snapshot may be absent; Photo Booth media was not overwritten.

At 20:38 the restored writer was stopped again and a fresh validated snapshot retained
under `~/www-control-center/backups/before-linux-volume-20261108T043821Z`. The database
was copied to the external local-driver volume `www-control-center-sqlite`, with
UID/GID 501:20 and owner-only permissions. The existing accepted immutable image was
recreated against that volume. Health returned HTTP 200 and all six workers had zero
consecutive failures while the NAS was still unreachable. Original host data, backups,
old PostgreSQL and media remain retained.

## Reproduced defect and limits

An isolated synthetic Rust service on the same mini reproduced a storage failure twice:
macOS repeatedly opened the bind-mounted live WAL database with the existing
`mode=rw; PRAGMA query_only=ON; PRAGMA quick_check` preflight pattern, while Linux
committed settings mutations over HTTP. The server crashed after 176 and 226 mutations;
the second run recorded exit 135 (SIGBUS), no OOM and no application error before exit.
The stopped synthetic database still passed integrity, so this proves the cross-OS
access hazard, not the exact zero-page corruption sequence in production.

There is no captured evidence that NAS power-off caused the zero writes. Do not report
that causal link as established. The old design exposed the same WAL/SHM to independent
macOS and Linux SQLite users; closing a host connection and shared-memory cleanup can
interfere with the guest's memory mappings. Moving storage and all live database access
inside Linux removes that demonstrated hazard. The specific production writer, syscall
and NAS-trigger relationship remain unproven. No production NAS shutdown or service-wide
network disruption was performed for testing.

SQLite documents the requirement that WAL clients share locks and memory on one host:
[SQLite WAL](https://sqlite.org/wal.html). OrbStack documents the distinction between
macOS VirtioFS bind mounts and Linux-local volumes:
[OrbStack volumes and mounts](https://docs.orbstack.dev/docker/file-sharing).

## Permanent controls

- Production uses an existing external, local-driver volume without network/bind options.
- Preflight validates schema/integrity in Linux; it never opens the live database on macOS.
- Backup refuses a running writer, copies all SQLite sidecars with the writer stopped,
  and opens only a private offline copy. Missing production databases are not auto-created.
- Local verification is recorded before NAS upload. NAS failure retains local snapshots
  and healthy services; `backup.py --local-only` never contacts the NAS.
- Database logs record safe numeric error codes for future diagnosis.
- `deploy/mini/storage_probe.py` is an opt-in synthetic real-Docker reproducer and volume
  regression workload; it never mounts production files or credentials.

## Regression evidence before publication

The Linux-volume workload completed 3,000 real HTTP mutations alongside 131
in-Linux integrity/schema validations, with no errors, no OOM and a running server.
A graceful restart preserved the final committed setting. An initial harness run
could not reconnect after restart because Docker reassigned its automatic host
port; the harness now re-reads the published port, and the rerun passed.

Local validation passed: `tools/check lint`, `tools/check rust` (24 Rust tests),
`tools/check ops` (67 Python tests), `tools/check dependencies` and the real
Swift/Rust round trip through `tools/check integration`. Independent final review
found a rollback issue with old images lacking the new validator command; it was
fixed and re-reviewed. Capability probing runs read-only without data mounts,
and rollback uses the current accepted image for validation rather than the old
target. Unsupported validators fail before obtaining production storage.
