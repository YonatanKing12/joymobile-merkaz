Restricted catalog, footer menu and physical-branch Admin applier

admin-catalog.py is independent of admin-pages.py. No live requests or mutations were performed during implementation. Verification used only an injected in-memory Admin client.

Secure environment required:

    SHOPIFY_NATIONAL_ADMIN_TOKEN
    SHOPIFY_EILAT_ADMIN_TOKEN

Targets are fixed to k8qhkp-gn.myshopify.com and x511g0-rj.myshopify.com, Admin API 2026-07. Tokens are never written into snapshots or displayed in errors. HTTPS uses the normal system trust store, certificate verification and no redirects. Admin reads require read_products, read_content, read_online_store_navigation, read_metaobjects and read_metaobject_definitions. Apply additionally requires write_products, write_online_store_navigation and write_metaobjects. No write_metaobject_definitions, order, customer or inventory scope is used.

Default: read and prepare a reviewable plan, with no mutations.

    python3 admin-catalog.py

This writes mode-0600 admin-catalog-snapshot.json and admin-catalog-plan.json in the remediation directory. Product/collection targets are read by fixed IDs. Menu/page/metaobject connections are paginated; only the intended five physical branches, footer-1 and joy-fix are retained. Review statuses and proposed payloads before execution. Blocked targets remain skipped, so readiness is not a claim every audited issue is resolved.

Explicit apply of that saved plan:

    python3 admin-catalog.py --apply admin-catalog-plan.json

Apply validates fixed store/resource allowlists, reviewed description files, strict payload keys, baseline fingerprints, definitions and Eilat source fields. Every ready target is re-read before the first write, then immediately before its own mutation. A conflict stops remaining operations. Description payloads can contain only id + descriptionHtml. Metaobjects can update only existing name/text/address/map_query fields; creating an object, changing its handle/type/capabilities, or changing publication is refused. Collection membership/sort order, product title/options/variants/prices/inventory and unrelated metadata are never written.

Menu append additionally requires an existing published National joy-fix Page and public HTTPS GET returning HTTP 200. Complete existing recursive menu items are retained with IDs, resource references, tags, URLs, nesting and order. A matching nested link yields no change. Incomplete/deep/unknown item shapes are refused rather than truncated. The applier never creates or publishes a page/menu/metaobject. Missing branch objects are reported as blocked instead of being invented.

Snapshots are review evidence and local backups, not server locks. Shopify does not provide an atomic compare-and-swap for these mutations; a small interval remains between the final read and write. On any failure, the report records prior successful operations and stops. An uncertain response triggers a read to observe whether the requested result exists, then stops without retrying or rolling back unrelated work. Rebuild a dry-run from fresh state before retrying.

The resulting admin-catalog-apply-report.json records completed/skipped operations and stopped/uncertain outcomes without tokens. Do not report all changes live based on a successful local dry-run.

Offline verification:

    python3 test_admin_catalog.py

22 tests cover successful restricted payloads, exact preservation of nested menu items, already-applied descriptions/menu links, stale targets before any writes and between preflight/write, unpublished/public-404 JOY FIX, absent metaobjects, changed source metadata/definitions, unknown fields, refusal of price/inventory/title/variant/publication/creation changes, partial/uncertain outcomes without retries, foreign-site links, capacity option drift and pagination cursor failures.

Shopify Admin GraphQL 2026-07 schema was checked against downloaded public documentation in MenuItem-docs.html, MenuItemUpdateInput-docs.html, metaobjectDefinitionByType-docs.html and collectionUpdate-docs.html. Existing menu items round-trip only fields supported by MenuItemUpdateInput: id, title, type, url, resourceId, tags and nested items. The implementation uses productUpdate(product: ProductUpdateInput), collectionUpdate(collection: CollectionUpdateInput), menuUpdate(id, title, items) and metaobjectUpdate(id, metaobject). The older deprecated collectionUpdate(input: CollectionInput) form is not used.
