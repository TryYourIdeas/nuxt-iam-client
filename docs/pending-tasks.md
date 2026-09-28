# Pending tasks / phases

Tracks work identified or discussed for `nuxt-iam-client` but not yet built, so it isn't lost between sessions. Each item links to the doc with the actual detail where one exists — this file is an index, not a spec.

## Adopt `iam`'s newer OIDC capabilities

`iam` (the SSO provider this module is a client for) has, since this module was last updated, added several capabilities the module doesn't use yet. None of these are required for the module to keep working — it never verified signatures or called any of these endpoints, so nothing regressed — but leaving them unadopted means the module is trusting unverified token claims and missing centralized checks `iam` now offers:

- **JWT signature verification.** `iam` switched from HS256 to RS256 and publishes a JWKS at `/.well-known/jwks.json`. `decodeJwtPayload()` (`src/runtime/server/utils/auth.ts`) only base64url-decodes the JWT payload — it never fetched or checked a signature under HS256 either, so this isn't a regression, but it means every claim (`sub`, `aud`, `exp`, `nonce`, `email`) is trusted without cryptographic verification. Fix: fetch the JWKS, select the JWK by the JWT header's `kid`, and verify the signature before trusting any claim, per `web/iam/docs/user-guides/IAM_CLIENT_IMPLEMENTATION.md` §2.
- **Token introspection.** `iam` now exposes `POST /introspect` for checking a token's validity centrally (revocation, not just expiry) — not called anywhere in this module today.
- **Userinfo endpoint.** `iam` now exposes `GET /userinfo` — not called anywhere in this module today. The module currently reads email from the `/token` response's top-level `user_email` field instead, which still works, but doesn't go through the scope-gated userinfo response.
- **Back-channel logout receiver.** `iam`'s `POST /api/logout` now revokes every refresh token for the user and POSTs a `logout_token` to each registered app's `backchannel_logout_url` on logout. This module registers no such endpoint and has no handler for it, so a consuming app (e.g. `home`) never finds out when the user's `iam`-level session ends elsewhere — its own local session just keeps working until the access token naturally expires or a refresh fails.

Full protocol reference: `web/iam/docs/user-guides/IAM_CLIENT_IMPLEMENTATION.md` (framework-agnostic) and `web/iam/docs/user-guides/NUXT_IAM_CLIENT_IMPLEMENTATION.md` (this module's own known-gaps section).
