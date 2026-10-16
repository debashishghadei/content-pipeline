#!/bin/bash
# Browser tests for the notes app.
#
# DISPOSABLE TEST SITES ONLY: deletes ALL notes, folders and note images on the test site
# first, then runs tests/app-tests.js (Playwright + Chromium) with two fake Ollama servers.
#
# Usage: CP_TEST_DISPOSABLE=1 tests/app-tests.sh
# Env:   BASE (default http://localhost:8080), PW (playwright package path), SHOTS (screenshot folder)
set -u
[ "${CP_TEST_DISPOSABLE:-}" = "1" ] || { echo "Refusing to run: set CP_TEST_DISPOSABLE=1 (disposable test site only)."; exit 2; }
DIR=$(cd "$(dirname "$0")" && pwd)
export BASE="${BASE:-http://localhost:8080}"
export OLLAMA_PORT="${OLLAMA_PORT:-11435}"
export OLLAMA_BLOCKED_PORT="${OLLAMA_BLOCKED_PORT:-11436}"

echo "== Reset notes on the test site"
wp eval '
foreach ( get_posts( array( "post_type" => "cp_note", "post_status" => "any,trash", "posts_per_page" => -1, "fields" => "ids" ) ) as $id ) { wp_delete_post( $id, true ); }
foreach ( get_terms( array( "taxonomy" => "cp_folder", "hide_empty" => false, "fields" => "ids" ) ) as $t ) { wp_delete_term( $t, "cp_folder" ); }
delete_option( "content_pipeline_inbox" ); delete_option( "content_pipeline_seeded" );
ContentPipeline\Notes::maybe_seed();
echo count( ContentPipeline\Notes::folders() ), " folders\n";
'

node "$DIR/fake-ollama.js" "$OLLAMA_PORT" "$BASE" & O1=$!
node "$DIR/fake-ollama.js" "$OLLAMA_BLOCKED_PORT" "https://not-this-site.example" & O2=$!
trap 'kill $O1 $O2 2>/dev/null' EXIT
sleep 1

node "$DIR/app-tests.js"
