# Restricted National page applier

`admin-pages.py` targets ONLY `k8qhkp-gn.myshopify.com`, Admin GraphQL API `2026-07`. It never reads credentials from files and never prints them. Set `SHOPIFY_NATIONAL_ADMIN_TOKEN` using the secure environment/secret settings of the execution environment. Do not paste a token into commands, commit it, or run a shell with command tracing enabled. The token needs `read_content` for snapshots and `write_content` for applying pages; the 2026-07 mutation docs also permit the corresponding online-store-page scopes. This tool does not request or broaden scopes.

Python 3.9+ and the standard library are sufficient. HTTPS uses normal certificate verification; cross-host redirects are forbidden. There are no automatic request retries.

## Workflow

Commands assume these tools are in the current directory:

```sh
python3 admin-pages.py --snapshot national-admin.snapshot.json
python3 prepare-updates.py --snapshot national-admin.snapshot.json --output operations.json
python3 admin-pages.py --plan operations.json --report preflight.json
```

The first command saves ALL pages, including unpublished ones, using Admin data. The compiler may leave legal/accessibility pages blocked until confirmed facts are provided through its existing `--facts` file. Review the resulting operation bodies and their statuses. Public rendered HTML is not an Admin concurrency token. Regenerate the plan with the actual Israel publication date when applying date-bearing content; do not reuse a previous day's provisional publication date.

Default behavior is read-only. `--plan` checks the entire executable plan against a new Admin snapshot and reports what could run. With no mode specified, the tool only reads and reports the page count.

Only an explicit command writes remotely:

```sh
python3 admin-pages.py --apply operations.json --backup national-admin.before.json --report apply-report.json
```

The backup must be a NEW local filename. If omitted, a unique timestamped backup beside the script is used. A fresh, complete actual Admin snapshot is saved BEFORE the first mutation. Snapshots, backups and reports use file permissions `0600`. Keep unpublished content backups private; exclude them from Git. Reports contain no authentication headers.

## Restrictions and outcomes

Only `ready_to_update` and `ready_to_create` execute. Unknown statuses, duplicate/tampered handles, payload handle/ID mismatches, arbitrary new handles, unexpected fields and unresolved placeholders stop validation. Allowed updates are the six fixed audited National page IDs (`about`, `shipping`, `terms`, `returns`, `privacy`, `accessibility`) and change ONLY the page body. Titles, handles, publication state, templates and metafields are never part of update input. Theme-owned FAQ/contact work is skipped.

The only creation is `joy-fix`, published with template `joy-fix`. Existing matching content/title/template/publication state is an idempotent no-op. A conflicting existing handle aborts the WHOLE initial preflight. A stale body or wrong page identity in any executable operation also aborts that initial preflight before any remote write.

Each operation is read again immediately before mutation. Shopify page mutations offer no atomic body compare-and-swap: a merchant edit in the small interval between the read and mutation cannot be ruled out. Avoid editing these pages concurrently while applying. The tool stops on a later conflict and reports earlier completed operations; it does not try to roll back merchant content.

If a mutation times out or has an uncertain response, the tool attempts a fresh Admin read to establish whether the requested state is already present, then STOPS. It never automatically resends a mutation. Review `apply-report.json`, obtain a fresh snapshot and dry run again. Rerunning the reviewed plan is safe for exact already-applied content; a changed page requires recompilation/review. An uncertain read leaves the outcome explicitly unknown.

Blocked operations are reported, not forced. An apply with no actual differences makes no backup and no mutations. `remote_writes` counts confirmed writes; `mutation_attempts` distinguishes attempts with an uncertain outcome. Exit code `2` means stopped/error; inspect the local report before continuing.

## Offline tests

```sh
python3 -m unittest discover -s . -p test_admin_pages.py -v
```

Tests use mock clients only. They cover missing token before any network setup, status/handle/ID/payload tampering, complete-plan stale preflight, duplicate Admin handles, update/create idempotence, body-only and fixed-create GraphQL input, dry-run/no-op behavior, actual private backups, immediate concurrency recheck, timeout reread without retry, and paginated unpublished pages. No live Admin API calls were made during implementation.
