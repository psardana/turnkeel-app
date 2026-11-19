# Connectors

- `manual`: the install every project has, named `manual`, for the amounts agents post and people upload by hand.
- `app-store-connect`: the review status of a version and the state of a build, for gate checks.
- `webhook-publisher`: the outbound webhook, which hands approved posts, signed, to an `https` address. Only the publishing job calls its `send()`.

A connector folder is a workspace package:

- its name is `@turnkeel/connector-<name>`, its licence is MIT, and it has its own `LICENSE` file;
- it imports `@turnkeel/connector-sdk` and nothing else from this repository (the lint rule `turnkeel/boundaries` checks this);
- it has a `vitest.config.ts`, so the root test run picks it up;
- it ships fixtures and a `README.md` that says what it reads, which credentials it needs and whether it has been run against a live account;
- it is a development dependency of `@turnkeel/server`, which bundles it.
