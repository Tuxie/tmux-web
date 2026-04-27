# =============================================================================
# BOOTSTRAP TEMPLATE — NOT CONSUMED BY THE RELEASE PIPELINE
# =============================================================================
#
# This file is retained as a starter template only. It is NOT updated by
# releases and is NOT the formula `brew install` resolves against.
#
# The live formula lives in the separate `Tuxie/homebrew-tap` repo and is
# rewritten on every release by `.github/workflows/bump-homebrew-tap.yml`.
# That workflow generates the URLs and SHA-256 values from the just-built
# release artifacts and commits the result to the tap repo — none of it
# touches this file.
#
# Why the placeholder SHAs and frozen version (1.4.1) are intentional:
#   - The placeholders (`PASTE_..._HERE`) are deliberate. Editing them here
#     would have no effect on shipped releases; the values are computed at
#     release time and written into the tap repo.
#   - The version is pinned to 1.4.1 — the tag at which this template was
#     last hand-curated — and is not bumped on each release for the same
#     reason: this is a snapshot, not a live artifact. Treat the version
#     here as "schema example", not "current release".
#
# Use this file as the seed when standing up a fresh tap repo from scratch:
#
#   1. Create a new GitHub repo named `homebrew-<something>`
#      (e.g. `homebrew-tuxie`).
#   2. Drop this file in at `Formula/tmux-web.rb`.
#   3. Replace the four `sha256 "PASTE_..._HERE"` placeholders with the
#      values from the v<version> release page, and bump `version` to match.
#   4. Commit and push.
#
# After bootstrap, ongoing maintenance is automated — let
# `bump-homebrew-tap.yml` handle subsequent version + sha256 bumps in the
# tap repo. Do NOT bump this file in lockstep; keeping it pinned makes its
# template-only status obvious.
#
# Users then:
#
#   brew tap Tuxie/<something>
#   brew install tmux-web
# =============================================================================
class TmuxWeb < Formula
  desc "Browser-based tmux frontend"
  homepage "https://github.com/Tuxie/tmux-web"
  version "1.4.1"
  license "MIT"

  depends_on "tmux"

  on_macos do
    on_arm do
      url "https://github.com/Tuxie/tmux-web/releases/download/v#{version}/tmux-web-v#{version}-darwin-arm64.tar.xz"
      sha256 "PASTE_DARWIN_ARM64_SHA256_HERE"
    end
    on_intel do
      url "https://github.com/Tuxie/tmux-web/releases/download/v#{version}/tmux-web-v#{version}-darwin-x64.tar.xz"
      sha256 "PASTE_DARWIN_X64_SHA256_HERE"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/Tuxie/tmux-web/releases/download/v#{version}/tmux-web-v#{version}-linux-arm64.tar.xz"
      sha256 "PASTE_LINUX_ARM64_SHA256_HERE"
    end
    on_intel do
      url "https://github.com/Tuxie/tmux-web/releases/download/v#{version}/tmux-web-v#{version}-linux-x64.tar.xz"
      sha256 "PASTE_LINUX_X64_SHA256_HERE"
    end
  end

  def install
    bin.install "tmux-web"
    doc.install "README.md", "LICENSE"
    # tmux-web.service is a systemd user unit — only meaningful on Linux,
    # and macOS release tarballs intentionally do not include it.
    (prefix/"lib/systemd/user").install "tmux-web.service" if OS.linux?
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/tmux-web --version")
  end
end
