# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub's **Report a vulnerability** button on the
repository's Security tab (or contact the maintainer directly if you cannot use it). Please do
not open a public issue for security reports.

Include: affected version (`manta-show --version`), platform, reproduction steps, and impact.
You can expect an initial response within a week; we'll keep you informed on fixes and credit
reporters by default (opt out anytime).

## Scope and design caveats

manta-show is a local development / documentation tool whose **stated purpose includes executing
code**:

- `terminal_open` starts arbitrary local processes (optionally inside a throwaway container via
  `isolation: 'container'`)
- `browser_evaluate` executes arbitrary JavaScript in a page context
- `electron_launch` starts local Electron applications

These are features, not vulnerabilities, and are documented in the README. Vulnerabilities we
care about are things *beyond* that design intent, for example:

- path traversal or unintended writes outside `~/.manta-show` and user-specified outputs
- the container-isolation mode escaping to the host beyond the documented mounts
- command injection into the docker/podman invocation from tool arguments
- supply-chain issues in the redistributed binaries (ffmpeg platform packages are sha256-pinned
  in `scripts/ffmpeg-sha256.json` and verified at download and publish time)

## Hardening tips for users

- Prefer `isolation: 'container'` when recording untrusted CLIs
- Point recordings at fixture pages/apps rather than production systems
- The MCP host's permission prompts remain your primary gate — review them before allowing
