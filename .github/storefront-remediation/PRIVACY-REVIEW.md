# Privacy review, 10 October 2026

The reviewed HTML in `privacy-reviewed-20261010.html` is the proposed common body for
the storefront privacy Page and Shopify's native PRIVACY_POLICY. It preserves this
shop's existing legal entity and verified contact details. Native checkout policy
and regional privacy settings are separate Shopify resources; merging theme code
cannot update them.

## Remaining Shopify configuration

Updating the native checkout privacy policy requires these currently absent scopes:

```text
read_legal_policies,write_legal_policies
```

After these scopes are granted, snapshot and conditionally replace only
`ShopPolicyType.PRIVACY_POLICY` with the reviewed body using `shopPolicyUpdate`.
Preserve shipping, refund, and terms policies. Re-read the result and check both
`/pages/privacy` and `/policies/privacy-policy`.

Both shops currently return `consentRequired: false` for Israel. This setting is
an observed technical fact, not proof of a violation of Israeli law. A granular
cookie preference panel is not being proposed as a blanket Israeli requirement.
The consolidated Privacy Protection Law published by Nevo, current to 8 October
2026, defines consent as informed, express or implied (section 3) and requires
collection notices (section 11). It does not establish a blanket requirement for a
granular cookie settings panel. This is not a certification of every tracking use.

Decision: publish a concise disclosure with accept/essential-only choices and a
persistent way to revise them. Keep Shopify's current regional defaults, without
assuming Israel legally requires global opt-in settings. Reviewing the suppliers'
actual processing and contracts remains a business/legal task.

Source: https://www.nevo.co.il/law_html/law01/087_001.htm
Privacy Protection Authority and Knesset pages could not be read due to their
responses; no claim is made that those sources were reviewed.

If the final policy promises that optional tracking starts only after acceptance,
configure Shopify's regional settings to match that promise using Customer privacy
settings or `consentPolicyUpdate`, preserving data-sale opt-out requirements.
That optional future change requires `write_privacy_settings`; reading banner
configuration requires `read_privacy_settings`.
If using a disclosure-based approach, ensure the notice accurately explains the
actual processing and determine whether sufficient lawful consent exists for
that processing. The banner UI alone does not configure regional defaults.

Propel Replays is temporarily disabled in theme app embeds. Re-enable only after
verifying its analytics-consent requirement, revocation handling, and masking of
personal/payment input fields. An installed script alone does not prove recording
occurred; its shop configuration could not be read in this audit.

The launch registration receiver is an external Google Apps Script with a fixed
legacy source/policy URL contract. Its consent checkbox is now initially unchecked
and the store privacy policy is also linked; the receiver keeps its existing policy
URL until its source can be updated and verified together with the storefront.
Verify a real approved registration and retention/deletion behavior in that service.

Policy text and storefront behavior do not establish that staff access, data
retention/deletion, supplier agreements, or every legal duty are satisfied.
