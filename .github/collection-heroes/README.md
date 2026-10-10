# Collection hero artwork

Both storefronts use the same original campaign artwork in midnight navy and mint. `snippets/collection-hero-map.liquid` maps exact collection handles to appropriate artwork families and verified manufacturer logos. `coverage.json` lists category coverage and logo source provenance. Broad categories do not display unrelated manufacturer logos. New collections fall back to the general showroom artwork.

`main-collection` defaults to **branded artwork**; the theme editor still offers no banner, native collection image and Shopify Files modes. The collection title stays in an accessible H1; breadcrumbs identify the category visually. Filters, sorting, stock queries, pagination and product grids retain their existing behavior.

Each family has 720, 1100 and 1536 pixel WebP variants. The first image loads eagerly with high priority, fixed frame dimensions prevent layout shift, and the whole artwork is contained so hardware, headset arches, vacuum tubes and drone propellers are not accidentally cropped on mobile or desktop. Only the current collection's image and logos load. Logo vector geometry comes from original brand assets (source links in coverage.json).

To add or replace artwork, supply all three responsive assets and update the exact handle mapping; preserve the original generated master separately. The collection image used elsewhere for collection cards is not overwritten.

Validation: Theme Check, Liquid brace guard, schema/JSON checks, functional Liquid rendering across all current collection handles and legacy modes, and browser checks at mobile and desktop widths, including availability filters and sorting.

Vendor pages also use an exact manufacturer lookup; spelling and capitalization are normalized without substring matching. Unverified manufacturer logos are omitted rather than approximated.
