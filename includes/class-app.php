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
	 * Query variable for the web app manifest ("Add to home screen").
	 */
	public const MANIFEST_VAR = 'cp_manifest';

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
	 * Register the query variables.
	 *
	 * @param string[] $vars Public query variables.
	 * @return string[]
	 */
	public static function query_vars( $vars ) {
		$vars[] = self::QUERY_VAR;
		$vars[] = self::MANIFEST_VAR;
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
	 * Show the app or the manifest, or send the home page to the app.
	 */
	public static function route(): void {
		if ( ! Plugin::current_user_can_use() ) {
			return;
		}

		if ( get_query_var( self::MANIFEST_VAR ) ) {
			self::manifest();
			exit;
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
	 * Web app manifest, so Chrome on Android can install the app on the home screen.
	 * The page links it with crossorigin="use-credentials", so the login cookie is sent.
	 */
	private static function manifest(): void {
		$icons = CONTENT_PIPELINE_URL . 'assets/icons/';
		$data  = array(
			'name'             => sprintf( '%s · %s', __( 'Notes', 'content-pipeline' ), get_bloginfo( 'name' ) ),
			'short_name'       => __( 'Notes', 'content-pipeline' ),
			'id'               => self::url(),
			'start_url'        => self::url(),
			'scope'            => home_url( '/' ),
			'display'          => 'standalone',
			'background_color' => '#f5f6f8',
			'theme_color'      => '#c8102e',
			'icons'            => array(
				array(
					'src'   => $icons . 'icon-192.png',
					'sizes' => '192x192',
					'type'  => 'image/png',
				),
				array(
					'src'   => $icons . 'icon-512.png',
					'sizes' => '512x512',
					'type'  => 'image/png',
				),
				array(
					'src'     => $icons . 'icon-maskable-512.png',
					'sizes'   => '512x512',
					'type'    => 'image/png',
					'purpose' => 'maskable',
				),
			),
		);

		nocache_headers();
		status_header( 200 );
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		echo wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	}

	/**
	 * Address of the manifest.
	 */
	public static function manifest_url(): string {
		return add_query_arg( self::MANIFEST_VAR, '1', home_url( '/' ) );
	}

	/**
	 * Output the app page. It does not use the theme.
	 */
	private static function render(): void {
		nocache_headers();
		status_header( 200 );
		header( 'Content-Type: text/html; charset=' . get_option( 'blog_charset' ) );

		$user = wp_get_current_user();

		$config = array(
			'rest'        => esc_url_raw( rest_url( Api::NS . '/' ) ),
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'nonceUrl'    => admin_url( 'admin-ajax.php?action=rest-nonce' ),
			'loginUrl'    => wp_login_url( self::url() ),
			'adminUrl'    => admin_url(),
			'logoutUrl'   => wp_logout_url( self::url() ),
			'ollamaUrl'   => admin_url( 'admin.php?page=' . Ollama::PAGE ),
			'statusUrl'   => admin_url( 'admin.php?page=' . Admin::PAGE ),
			'siteName'    => get_bloginfo( 'name' ),
			'userName'    => $user->display_name,
			'storageKey'  => 'cp-pending-' . md5( home_url() . '|' . $user->ID ),
			'version'     => CONTENT_PIPELINE_VERSION,
			'maxUpload'   => min( Files::MAX_BYTES, (int) wp_max_upload_size() ),
			'filesPublic' => ! Files::is_outside_public(),
			'state'       => array(
				'folders'  => Notes::folders(),
				'notes'    => Notes::all(),
				'inbox'    => Notes::inbox_id(),
				'statuses' => Notes::statuses(),
			),
		);

		$data = array(
			'site_name'    => get_bloginfo( 'name' ),
			'config'       => $config,
			'manifest_url' => self::manifest_url(),
			'icons_url'    => CONTENT_PIPELINE_URL . 'assets/icons/',
		);

		wp_register_style( 'content-pipeline-app', CONTENT_PIPELINE_URL . 'assets/css/app.css', array(), CONTENT_PIPELINE_VERSION );
		wp_register_script( 'content-pipeline-app', CONTENT_PIPELINE_URL . 'assets/js/app.js', array(), CONTENT_PIPELINE_VERSION, true );

		require CONTENT_PIPELINE_DIR . 'templates/app.php';
	}
}
