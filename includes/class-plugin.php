<?php
/**
 * Plugin bootstrap: shared helpers, capability, activation.
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Plugin bootstrap.
 */
final class Plugin {

	/**
	 * Capability needed to use the hub.
	 */
	public const CAP = 'cp_use_hub';

	/**
	 * Option that stores the plugin version the rewrite rules were built for.
	 */
	public const RULES_OPTION = 'content_pipeline_rules_version';

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		add_filter( 'user_has_cap', array( __CLASS__, 'grant_cap' ), 10, 1 );
		add_action( 'init', array( __CLASS__, 'maybe_flush_rules' ), 99 );

		Lockdown::init();
		App::init();
		Admin::init();
	}

	/**
	 * Administrators (manage_options) may use the hub. Nothing is stored in the database.
	 *
	 * @param array $allcaps All capabilities of the user.
	 * @return array
	 */
	public static function grant_cap( $allcaps ) {
		if ( ! empty( $allcaps['manage_options'] ) ) {
			$allcaps[ self::CAP ] = true;
		}
		return $allcaps;
	}

	/**
	 * Whether the current visitor may use the hub.
	 */
	public static function current_user_can_use(): bool {
		return is_user_logged_in() && current_user_can( self::CAP );
	}

	/**
	 * Rebuild rewrite rules once after install or after a manual zip update
	 * ("Replace current with uploaded" does not run the activation hook).
	 */
	public static function maybe_flush_rules(): void {
		if ( get_option( self::RULES_OPTION ) !== CONTENT_PIPELINE_VERSION ) {
			flush_rewrite_rules( false );
			update_option( self::RULES_OPTION, CONTENT_PIPELINE_VERSION, false );
		}
	}

	/**
	 * Activation.
	 */
	public static function activate(): void {
		App::add_rewrite_rules();
		flush_rewrite_rules( false );
		update_option( self::RULES_OPTION, CONTENT_PIPELINE_VERSION, false );
	}

	/**
	 * Deactivation: let WordPress rebuild its rules without ours.
	 */
	public static function deactivate(): void {
		delete_option( 'rewrite_rules' );
		delete_option( self::RULES_OPTION );
	}
}
