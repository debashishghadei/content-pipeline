<?php
/**
 * Uninstall: remove small plugin settings only.
 *
 * Notes, folders and note images are deliberately KEPT, so deleting the plugin by mistake
 * never deletes your notes. Reinstalling the plugin shows them again.
 *
 * @package ContentPipeline
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'content_pipeline_rules_version' );
delete_option( 'content_pipeline_self_test' );
delete_option( 'rewrite_rules' );
