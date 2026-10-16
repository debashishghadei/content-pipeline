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
	 * Option for the "Private site" switch ('1' = on, '0' = off). Missing = on.
	 */
	public const PRIVATE_OPTION = 'content_pipeline_private';

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
		Notes::init();
		Api::init();
		Files::init();
		App::init();
		Admin::init();
		Self_Test::init();
		Ollama::init();
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
			// Notes have their own capabilities, so Editors (who can edit posts) cannot see them.
			foreach ( array( 'edit', 'edit_others', 'edit_private', 'edit_published', 'publish', 'read_private', 'delete', 'delete_others', 'delete_private', 'delete_published' ) as $cap ) {
				$allcaps[ $cap . '_cp_notes' ] = true;
			}
		}
		return $allcaps;
	}

	/**
	 * Is the whole site private? On unless switched off on the status page.
	 * The constant CONTENT_PIPELINE_PRIVATE (true/false in wp-config.php) overrides the switch.
	 */
	public static function is_private(): bool {
		if ( self::private_is_fixed() ) {
			return (bool) CONTENT_PIPELINE_PRIVATE;
		}
		return '0' !== (string) get_option( self::PRIVATE_OPTION, '1' );
	}

	/**
	 * Is the switch fixed in wp-config.php?
	 */
	public static function private_is_fixed(): bool {
		return defined( 'CONTENT_PIPELINE_PRIVATE' );
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
		Notes::register();
		Notes::maybe_seed();
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
