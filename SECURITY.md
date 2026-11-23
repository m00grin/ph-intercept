# Security Policy

## Supported Versions

Only the latest release receives security updates.

## Reporting a Vulnerability

Please report vulnerabilities privately via GitHub:
https://github.com/m00grin/ph-intercept/security/advisories/new

I'll acknowledge within a few days, and aim to fix or mitigate confirmed
issues within two weeks.

## Verifying a Release

Every release tag is signed. The [README](README.md#build-from-source) shows how to check the signature and build the image yourself.

Release images also carry BuildKit provenance attestations, a record of the commit and the GitHub Actions run that built them:

```bash
docker buildx imagetools inspect ghcr.io/m00grin/ph-intercept:latest --format '{{json .Provenance}}'
```

The output names the Actions run (`runDetails.builder.id`) and the commit it built from (the `org.opencontainers.image.revision` label). That commit should match the one the signed tag points to, which ties the image to the source I signed.

Releases after 1.5.8 also include an SBOM, a list of the packages inside each image: the Python packages and the Python runtime. Alpine's own system libraries aren't listed yet; that's planned for the next release.

```bash
docker buildx imagetools inspect ghcr.io/m00grin/ph-intercept:latest --format '{{json .SBOM}}'
```

## Build and Release Infrastructure

Release images are built by GitHub Actions on a self-hosted runner, a persistent machine at my home that I operate and maintain. I use it for a few reasons:

- **Speed:** a persistent build cache keeps a seven-platform release build to a couple of minutes.
- **Control:** the builds run in an environment I manage, not a shared runner image.
- **Cost:** no CI minutes to spend on the multi-architecture builds.
- **Learning:** it's part of my home lab, and running my own CI is a good way to learn and tinker.

The guardrails:

- **Who can run code on it:** only workflows triggered by my pushes to `develop` and `main`, release tags, schedules, and manual runs. Pull requests from forks never run on it. The one workflow that also runs for pull requests only does so for branches in this repository, and the repository requires approval for all outside contributors' workflows.
- **Credentials:** Docker Hub and GitHub tokens used by the release workflows. Workflows default to no permissions (or read-only repository contents), and each job asks only for what it needs.
- **Supply chain:** every action is pinned to a full commit SHA.
