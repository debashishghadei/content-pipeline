<?php
/**
 * Uninstall: remove plugin options. (Version 0.1 stores no notes yet.)
 *
 * @package ContentPipeline
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'content_pipeline_rules_version' );
delete_option( 'rewrite_rules' );
