# Homebrew formula for tmux-web.
#
# To ship it: create a new GitHub repo named `homebrew-<something>`
# (e.g. `homebrew-tuxie`), drop this file in at `Formula/tmux-web.rb`,
# paste the four SHA-256 values from the v<version> release page into
# the `sha256 "..."` lines below, and commit. Users then:
#
#   brew tap Tuxie/<something>
#   brew install tmux-web
#
# Bump recipe:
#   1. edit `version` to the new tag (without the `v`)
#   2. update the four URLs and sha256 values
#   3. commit + push the tap repo
#   (or automate with `brew bump-formula-pr` / a GH Action).
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
    # harmless to install on macOS as a reference file.
    (prefix/"lib/systemd/user").install "tmux-web.service"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/tmux-web --version")
  end
end
