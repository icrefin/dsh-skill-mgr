#!/bin/sh
# Install this plugin into a dsh profile.
#
# The desktop profile is owned by the Electron application: `dsh --profile
# desktop` refuses to compose it, but `dsh plugin` is a plain pnpm passthrough
# into the profile directory and works, which is also what the Plugins page
# does. `pnpm add` writes the dependency *and* the `dsh.profile.bundles` row,
# so a restart is all that is left afterwards.
#
# Usage: sh tools/install-into-profile.sh [profile] [extra pnpm args]
#   sh tools/install-into-profile.sh desktop
set -eu

PROFILE=${1:-desktop}
PACKAGE_DIR=$(cd "$(dirname "$0")/.." && pwd)
DSH_CLI=${DSH_CLI:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}

cd "$PACKAGE_DIR"
pnpm run build
TARBALL=$(pnpm pack --pack-destination dist | tail -1)
echo "packed $TARBALL"

# A local install pins the tarball's path, so it must outlive this run.
"$DSH_CLI" plugin --profile "$PROFILE" add "$TARBALL"

echo
echo "Installed. Restart DeepSeek Harness to mount the new bundle row;"
echo "the sidebar entry appears directly under Plugins."
