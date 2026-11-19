# Licensing

Copyright (c) 2026 Piyush Sardana and Turnkeel contributors.

Turnkeel is under two licences. The folder a file is in decides which one applies.

| Folder                                                                                          | Package                   | Licence       |
| ----------------------------------------------------------------------------------------------- | ------------------------- | ------------- |
| `apps/server`                                                                                   | `@turnkeel/server`        | AGPL-3.0-only |
| `apps/web`                                                                                      | `@turnkeel/web`           | AGPL-3.0-only |
| `packages/core`                                                                                 | `@turnkeel/core`          | AGPL-3.0-only |
| `packages/db`                                                                                   | `@turnkeel/db`            | AGPL-3.0-only |
| `packages/markdown` (not built yet)                                                             | `@turnkeel/markdown`      | AGPL-3.0-only |
| `packages/protocol`                                                                             | `@turnkeel/protocol`      | MIT           |
| `packages/connector-sdk`                                                                        | `@turnkeel/connector-sdk` | MIT           |
| `packages/connectors/*`                                                                         | one package per connector | MIT           |
| `packages/mcp`                                                                                  | `@turnkeel/mcp`           | MIT           |
| `packages/cli`                                                                                  | `turnkeel`                | MIT           |
| Everything else: the root files, `docs/`, `tooling/`, `scripts/`, `e2e/`, `docker/`, `.github/` |                           | AGPL-3.0-only |

The text of the AGPL-3.0 is in [LICENSE](LICENSE). Each MIT package has the MIT text in its own `LICENSE` file, and the `license` field of every `package.json` names the licence of that package.

No MIT package imports an AGPL one. The lint rule `turnkeel/boundaries` reads each package's `license` field and checks this on every import.
