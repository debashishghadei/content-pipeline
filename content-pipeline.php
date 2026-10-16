<?php
/**
 * Plugin Name:       Content Pipeline Hub
 * Description:       Private content hub: capture ideas and turn them into articles for your sites. This site is locked to logged-in users.
 * Version:           0.1.2
 * Requires at least: 6.8
 * Requires PHP:      8.1
 * Author:            Debashish Ghadei
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       content-pipeline
 * Update URI:        false
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

define( 'CONTENT_PIPELINE_VERSION', '0.1.2' );
define( 'CONTENT_PIPELINE_FILE', __FILE__ );
define( 'CONTENT_PIPELINE_DIR', plugin_dir_path( __FILE__ ) );
define( 'CONTENT_PIPELINE_URL', plugin_dir_url( __FILE__ ) );

require_once CONTENT_PIPELINE_DIR . 'includes/class-plugin.php';
require_once CONTENT_PIPELINE_DIR . 'includes/class-lockdown.php';
require_once CONTENT_PIPELINE_DIR . 'includes/class-app.php';
require_once CONTENT_PIPELINE_DIR . 'includes/class-admin.php';
require_once CONTENT_PIPELINE_DIR . 'includes/class-self-test.php';

register_activation_hook( __FILE__, array( Plugin::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( Plugin::class, 'deactivate' ) );

Plugin::init();
