# Contributing to ph-intercept

Thanks for wanting to help. Bug reports, ideas, and pull requests are all welcome. Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Open an issue first** for anything beyond a typo or a one-line fix. A quick "would you take this?" saves both of us time if the idea doesn't fit or someone is already on it.
- **Questions and half-formed ideas** go in [Discussions](https://github.com/m00grin/ph-intercept/discussions).
- **Security issues** go to the private advisory form, never a public issue. See [SECURITY.md](SECURITY.md).

## Pull requests

- Branch from `develop` and open the PR against `develop`. `main` only receives releases.
- One change per PR. Several small PRs are easier to review than one big one.
- New options default to today's behavior, so nobody's setup changes on upgrade.
- Keep the existing style: Python with Starlette and httpx on the server, plain JavaScript in `static/js/` with no build step, and no new dependencies unless we've agreed on them in the issue.
- Comment only what the code can't say for itself, like a quirk of a DNS server's API. Put the reasoning for a change in the commit message and the PR description.
- Please don't change the `Dockerfile` or anything under `.github/`. Dependabot keeps the base image and actions current, and PRs that touch the build or CI will be closed unless we've discussed it first. If your change needs one, say so in the issue and I'll handle it.

### If you add or change an environment variable

Each provider has its own README and compose file. In all three, update the configuration table, the example compose in the README, and the `compose.yaml` it copies:

- [README.md](README.md) and [compose.yaml](compose.yaml) (Pi-hole)
- [adguard/README.md](adguard/README.md) and [adguard/compose.yaml](adguard/compose.yaml)
- [technitium/README.md](technitium/README.md) and [technitium/compose.yaml](technitium/compose.yaml)

Don't edit [CHANGELOG.md](CHANGELOG.md). I write it when cutting a release, and contributors are credited there. Just describe the user-facing change in the PR description.

## Running it locally

You need Python 3 (the Docker image uses 3.15) and a Pi-hole, AdGuard Home, or Technitium server to point it at.

```bash
pip install -r requirements.txt
```

Set the same environment variables you would use in Docker (see the README for your provider), then start the dev server:

```bash
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000.

## Review and CI

- Workflows in this repo don't run on pull requests, and runs from outside contributors need approval, which isn't given. Your PR won't show any checks; that's expected.
- I review every PR myself and run the full test suite locally before merging. CI runs after the merge, on `develop`.
- I'm the only person who merges. I may push small fixups to your branch or ask for changes; either way you keep the credit.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), the same as the rest of the project.
