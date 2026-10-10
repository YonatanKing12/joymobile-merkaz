# Storefront content corrections

Theme code and Shopify-managed content deploy separately. These reviewed corrections cover the National About and five policies, the missing JOY FIX page, both iPhone 17 Pro storage descriptions, the National smartphones introduction, and the National service menu/physical branch presentation.

`national-facts.json` contains the operator and accessibility contact supplied by the owner for public publication. It contains no authentication credentials. The National legal address is הארבעה 30, תל אביב יפו; the physical flagship address shown in branch/contact/footer components is separate.

## Before updating Shopify content

Provide Admin tokens through secure environment settings:

- `SHOPIFY_NATIONAL_ADMIN_TOKEN`: `k8qhkp-gn.myshopify.com`.
- `SHOPIFY_EILAT_ADMIN_TOKEN`: `x511g0-rj.myshopify.com`.

The relevant app scopes are:

```text
read_content,write_content,read_products,write_products,read_online_store_navigation,write_online_store_navigation,read_metaobjects,write_metaobjects,read_metaobject_definitions
```

Use Python 3.9+ with the standard library. The commands below run from this directory. Actual snapshots and reports belong outside the repository; they can include unpublished Shopify content. Never put tokens in command arguments or files in Git.

## National pages

```sh
python3 admin-pages.py --snapshot /tmp/national-pages.snapshot.json
python3 prepare-updates.py --facts national-facts.json --snapshot /tmp/national-pages.snapshot.json --output /tmp/national-pages.plan.json
python3 admin-pages.py --plan /tmp/national-pages.plan.json --report /tmp/national-pages.preflight.json
```

Read the plan before applying. HTML serialization differences are accepted only when the original text, tags and attributes still match the reviewed baseline. A content change stops preparation; refresh the reviewed proposal instead of overwriting a merchant edit. Regenerate date-bearing content on the actual publication day.

```sh
python3 admin-pages.py --apply /tmp/national-pages.plan.json --backup /tmp/national-pages.before.json --report /tmp/national-pages.applied.json
```

The updater changes bodies on the six audited existing pages. It creates `joy-fix` only when that handle is absent, with the existing `joy-fix` theme template. It leaves FAQ and Contact page bodies alone: their corrected content lives in theme template settings.

See [page updater details](admin-pages.README.md) for exact restrictions, concurrency and uncertain-response handling.

## Catalog and navigation

`catalog-navigation-manifest.json` records precise description corrections and the append-only service link. `admin-catalog.py` prepares a new plan from fresh Admin data and applies it only with its explicit apply option. Run `python3 admin-catalog.py --help` for commands, and read the generated plan before applying.

- Product corrections change only `descriptionHtml`, preserving the long technical description and replacing capacity-specific model wording with family wording and the actual storage choices.
- The National collection correction adds appropriate delivery copy. Eilat's existing collection text remains.
- The National `footer-1` menu gets one JOY FIX link after that page exists, is published and returns HTTP 200. All existing menu items, hierarchy and IDs remain.
- Existing National branch metaobjects can receive the same verified names and descriptive text as their Eilat counterparts. Missing objects are not created. Both themes already include matching verified template fallback names/descriptions, so the branch directory remains useful without metaobjects.

## Checks and publication

```sh
python3 -m unittest discover -s . -p 'test_admin_*.py' -v
shopify theme check --path ../..
```

Offline tests use mock Admin clients. They do not establish that tokens/scopes work in the live shops. Theme Check, Liquid brace checks, JS syntax and JSON validity also run in each repository's GitHub workflow.

Both theme repositories describe GitHub integration with `main`; verify the resulting storefront after merging rather than treating a merge as proof of deployment. Shopify data updates require their separate Admin operation. After publication, check the two shops at mobile and desktop widths: campaign links/order, guide photos/order, featured product order, footer navigation, delivery FAQ/contact copy, JOY FIX, About/policies/accessibility, and the iPhone 17 Pro storage description.
