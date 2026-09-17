# ADR 0008 — Cross-distro packaging strategy

**Status:** Accepted
**Date:** 2026-09-17

## Context

Wisp targets Linux desktops via Wails (Go + native WebKit/GTK webview). The binary depends on distro-provided `libwebkit2gtk-4.1`, `libgtk-3`, `libcairo`, `libgdk-pixbuf`, and `libglib2` at runtime — Wails links against them dynamically; it does not bundle them. The project's primary author is on Arch, the wider open-source audience skews Debian/Ubuntu. As of `v0.1.0-beta.9`, two package formats are produced:

- `packaging/deb/build.sh` → `.deb` for Debian 12+ / Ubuntu 22.04+
- `packaging/arch/PKGBUILD` → `.pkg.tar.zst` for Arch

Users and contributors periodically ask: "why not RPM (Fedora/RHEL/openSUSE)?", "any chance of an AppImage?", and "can I just download a tarball?". This ADR records the answer to each so future asks can point to one place instead of re-litigating the trade-off.

## Decision

Keep two production formats today (`.deb` + Arch PKG), and **map** the alternatives below with the conditions under which they would be added. No RPM, AppImage, or Flatpak build is implemented in this ADR — only the decision of *when* and *how* each would be added.

### Why no static `.tar.gz`

`CGO_ENABLED=0` produces a static Go binary, but it does nothing for the Wails frontend: the binary still loads `libwebkit2gtk-4.1`, `libgtk-3`, `libcairo`, etc. from the system at runtime. Tarball distribution would mean every user has to verify their distro has the right ABI versions of these libs — every distro ships slightly different patch versions, so silent ABI mismatches are the rule. This is the same class of bug that motivated `.deb` + Arch PKG in the first place (a tested, well-known dependency set pulled from the distro's own package manager).

**Tarball is not a viable distribution format for this project.** Keep rejecting it.

### RPM — when to add

Add `packaging/rpm/wisp.spec` + a Fedora runner in `.github/workflows/release.yml` when an actual user asks for it (Fedora/RHEL/openSUSE). Conditions:

- Same `webkit2gtk4.1` runtime dependency (Fedora names it differently from Arch; check `dnf provides webkit2gtk4.1` on the target Fedora version before pinning).
- Spec file is small (`%build`, `%install`, `%files`, `%post`/`%postun` for the icon cache); not zero work, but not open-ended either.
- Adding it triples the packaging-surface maintenance (Debian + Arch + RPM), so the trigger is "real user asks" — not "we should also support Fedora someday".

### AppImage — when to add

Closest path to "runs on every modern Linux distro". Approach: `linuxdeploy` + `linuxdeploy-plugin-gtk` invoked after `wails build`, producing a single `wisp-x86_64.AppImage` (~150 MB, mostly bundled GTK/WebKit libs). Trade-offs:

- **Pro**: single artifact, runs on most distros without a package manager.
- **Con**: Wails has no first-class AppImage target — wiring it into a release workflow is manual (one-off `linuxdeploy` invocation + CI integration), and the artifact is large because it bundles most of GTK.
- **Con**: Updates still go through GitHub Releases (no AppImageUpdate integration without extra plumbing), and the bundled libs lag behind the distro's, which can hide distro-specific bugs.

Add when: cross-distro feedback grows beyond the two supported package families (e.g. someone on Fedora, openSUSE Tumbleweed, or NixOS asks "is there an easy way to run it"). Not before.

### Flatpak — when to add

Similar trade-off to AppImage with stricter sandboxing (flatpak-builder + GNOME SDK manifest, ~150 MB artifact). More upfront work (manifest + CI integration + portal permissions for filesystem access to user databases); longer-term better isolation story.

Add when: same trigger as AppImage (real cross-distro demand), or when the security/sandbox angle becomes a stated user requirement. The Wisp UI already runs in a sandboxed webview (Wails's), so the marginal benefit of an extra Flatpak sandbox layer is small for an interactive tool that explicitly needs to open local files (`.db`) and connect to remote hosts.

## Alternatives considered

- **Static Go binary + GTK loadable modules (GModule)**: technically possible — load GTK/WebKit at runtime via `dlopen` from a known path. The cost is a custom build pipeline and a fragile user-experience ("install these libs to /opt/wisp first, then run"). Rejected: defeats the purpose of going through the distro's package manager, and the failure modes are much worse than a missing `.deb` dependency.
- **Containerized launcher (e.g. `toolbx`/`distrobox`)**: requires the user to already have Podman/Docker installed, and pulls in the same distro-package deps inside the container. Not a "just download and run" experience. Mentioned for completeness; not on the roadmap.
- **One Wails build, multiple AppImage targets**: same as "AppImage" above — listed separately only to note that no AppImage = no per-distro AppImage. Bundled libs are unavoidable either way.

## Consequences

- README and ROADMAP call out the two supported formats explicitly so users don't waste time looking for an `.rpm` or AppImage that won't appear unless there's demand.
- "Why not a tarball" is answered in the README's build instructions — anyone asking can be pointed at this ADR for the full rationale.
- Adding any of the mapped formats is a normal project task once triggered; this ADR is the entry point for the decision, not a blocker.
- The actual implementation of RPM / AppImage / Flatpak (when triggered) should land as a follow-up ADR with concrete `.spec` / `linuxdeploy` invocation / Flatpak manifest — not retrofitted silently.
