<?php
/**
 * The notes app page (/notes/). The home page sends you here.
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Notes app routing and rendering.
 */
final class App {

	/**
	 * Query variable that marks an app request.
	 */
	public const QUERY_VAR = 'cp_app';

	/**
	 * URL path of the app (pretty permalinks).
	 */
	public const SLUG = 'notes';

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'add_rewrite_rules' ) );
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		// Runs after the lockdown gate (-100), so only allowed users get here.
		add_action( 'template_redirect', array( __CLASS__, 'route' ), 1 );
	}

	/**
	 * /notes/ → index.php?cp_app=1
	 */
	public static function add_rewrite_rules(): void {
		add_rewrite_rule( '^' . self::SLUG . '/?$', 'index.php?' . self::QUERY_VAR . '=1', 'top' );
	}

	/**
	 * Register the query variable.
	 *
	 * @param string[] $vars Public query variables.
	 * @return string[]
	 */
	public static function query_vars( $vars ) {
		$vars[] = self::QUERY_VAR;
		return $vars;
	}

	/**
	 * Address of the notes app. Works with "Plain" permalinks too.
	 */
	public static function url(): string {
		if ( get_option( 'permalink_structure' ) ) {
			return home_url( '/' . self::SLUG . '/' );
		}
		return add_query_arg( self::QUERY_VAR, '1', home_url( '/' ) );
	}

	/**
	 * Show the app, or send the home page to it.
	 */
	public static function route(): void {
		if ( ! Plugin::current_user_can_use() ) {
			return;
		}

		if ( get_query_var( self::QUERY_VAR ) ) {
			self::render();
			exit;
		}

		if ( is_front_page() && ! is_paged() ) {
			wp_safe_redirect( self::url() );
			exit;
		}
	}

	/**
	 * Output the app page. It does not use the theme.
	 */
	private static function render(): void {
		nocache_headers();
		status_header( 200 );
		header( 'Content-Type: text/html; charset=' . get_option( 'blog_charset' ) );

		$data = array(
			'site_name'  => get_bloginfo( 'name' ),
			'user_name'  => wp_get_current_user()->display_name,
			'admin_url'  => admin_url(),
			'logout_url' => wp_logout_url( self::url() ),
			'version'    => CONTENT_PIPELINE_VERSION,
		);

		wp_register_style( 'content-pipeline-app', CONTENT_PIPELINE_URL . 'assets/css/app.css', array(), CONTENT_PIPELINE_VERSION );

		require CONTENT_PIPELINE_DIR . 'templates/app.php';
	}
}
