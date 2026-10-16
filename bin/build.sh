#!/bin/sh
# Build dist/content-pipeline-<version>.zip from the committed files (export-ignore respected).
set -e
cd "$(dirname "$0")/.."
VERSION=$(grep -m1 "Version:" content-pipeline.php | awk '{print $NF}')
mkdir -p dist
git archive --format=zip --prefix=content-pipeline/ -o "dist/content-pipeline-$VERSION.zip" HEAD
echo "dist/content-pipeline-$VERSION.zip"
