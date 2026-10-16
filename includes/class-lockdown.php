<?php
/**
 * Lockdown.
 *
 * "Private site" ON (default, for the hub): the whole site is private; logged-out visitors
 * only get the login screen.
 * "Private site" OFF (for trying the plugin on a normal site): the website works as usual;
 * only the notes (app page, manifest, images, notes API) stay private.
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Privacy rules for the hub.
 */
final class Lockdown {

	/**
	 * How long "Remember me" keeps you logged in.
	 */
	public const REMEMBER_DAYS = 30;

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		// Front end: the whole site (private mode) or only the notes pages (normal mode).
		add_action( 'template_redirect', array( __CLASS__, 'front_gate' ), -100 );

		if ( ! Plugin::is_private() ) {
			// Normal site: nothing else changes. The notes API checks permission per route.
			return;
		}

		// Every response: tell search engines not to index anything.
		add_action( 'init', array( __CLASS__, 'send_noindex_header' ), 0 );

		// Direct PHP entry points that skip the normal page flow.
		add_action( 'init', array( __CLASS__, 'block_side_doors' ), 1 );

		// REST API (wp-json and ?rest_route=): runs after core's cookie/nonce check (priority 100).
		add_filter( 'rest_authentication_errors', array( __CLASS__, 'rest_gate' ), 101 );

		// Settings that must stay off on a private site, whatever is saved in the database.
		add_filter( 'pre_option_blog_public', array( __CLASS__, 'return_zero' ) );
		add_filter( 'pre_option_users_can_register', array( __CLASS__, 'return_zero' ) );
		add_filter( 'pre_option_default_comment_status', array( __CLASS__, 'return_closed' ) );
		add_filter( 'pre_option_default_ping_status', array( __CLASS__, 'return_closed' ) );
		add_filter( 'comments_open', '__return_false', 99 );
		add_filter( 'pings_open', '__return_false', 99 );
		add_filter( 'wp_sitemaps_enabled', '__return_false', 99 );
		add_filter( 'xmlrpc_enabled', '__return_false', 99 );
		add_filter( 'xmlrpc_methods', '__return_empty_array', 99 );
		add_filter( 'robots_txt', array( __CLASS__, 'robots_txt' ), 99 );

		// Login comfort on the phone.
		add_filter( 'auth_cookie_expiration', array( __CLASS__, 'remember_me_length' ), 10, 3 );
		add_action( 'login_footer', array( __CLASS__, 'tick_remember_me' ) );
		add_filter( 'login_redirect', array( __CLASS__, 'after_login' ), 10, 3 );
	}

	/**
	 * Send "noindex, nofollow" on every response.
	 */
	public static function send_noindex_header(): void {
		if ( ! headers_sent() ) {
			header( 'X-Robots-Tag: noindex, nofollow', true );
		}
	}

	/**
	 * Block PHP entry points that do not pass through template_redirect.
	 *
	 * XML-RPC is always blocked. The others are blocked for anyone who may not use the hub.
	 */
	public static function block_side_doors(): void {
		if ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) {
			// wp_die() in XML-RPC answers "200" with an empty body; send a clear 403 instead.
			nocache_headers();
			status_header( 403 );
			header( 'Content-Type: text/plain; charset=utf-8' );
			echo 'XML-RPC is disabled on this site.';
			exit;
		}

		if ( Plugin::current_user_can_use() ) {
			return;
		}

		// Logged in but without hub permission: no wp-admin screens, no admin-ajax, no admin-post.
		// Logged-out wp-admin requests are sent to the login screen by WordPress itself.
		if ( is_user_logged_in() && ( is_admin() || wp_doing_ajax() ) ) {
			self::deny();
		}

		global $pagenow;

		/**
		 * PHP files that logged-out visitors may not reach.
		 *
		 * @param string[] $scripts File names, e.g. 'wp-comments-post.php'.
		 */
		$blocked = (array) apply_filters(
			'content_pipeline_blocked_scripts',
			array(
				'xmlrpc.php',
				'wp-comments-post.php',
				'wp-trackback.php',
				'wp-links-opml.php',
				'wp-mail.php',
				'wp-signup.php',
				'wp-activate.php',
				'admin-post.php',
			)
		);

		$is_blocked_script = is_string( $pagenow ) && in_array( $pagenow, $blocked, true );

		// Logged-out admin-ajax.php ("nopriv" actions).
		if ( $is_blocked_script || wp_doing_ajax() ) {
			self::deny();
		}
	}

	/**
	 * Front-end gate.
	 */
	public static function front_gate(): void {
		// robots.txt says "Disallow: /" because blog_public is forced off. Favicon is harmless.
		if ( is_robots() || is_favicon() ) {
			return;
		}

		if ( ! Plugin::is_private() ) {
			if ( ! self::is_notes_request() ) {
				return; // Normal site: every other page is public as usual.
			}
			// The notes pages stay private and out of search engines and page caches.
			if ( ! headers_sent() ) {
				header( 'X-Robots-Tag: noindex, nofollow', true );
			}
			self::no_page_cache();
		}

		if ( ! is_user_logged_in() ) {
			nocache_headers();
			auth_redirect(); // Sends the visitor to the login screen and exits.
			exit;
		}

		if ( ! current_user_can( Plugin::CAP ) ) {
			self::deny();
		}
	}

	/**
	 * Is this a request for the notes app, its manifest or a note image?
	 */
	public static function is_notes_request(): bool {
		return (bool) ( get_query_var( App::QUERY_VAR ) || get_query_var( App::MANIFEST_VAR ) || get_query_var( Files::QUERY_VAR ) );
	}

	/**
	 * Ask page-cache plugins not to store this response.
	 */
	public static function no_page_cache(): void {
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound -- standard constant read by cache plugins.
		}
	}

	/**
	 * REST gate: login + hub permission for every route, including the index.
	 *
	 * @param \WP_Error|null|true $result Earlier authentication result.
	 * @return \WP_Error|null|true
	 */
	public static function rest_gate( $result ) {
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		if ( ! is_user_logged_in() ) {
			return new \WP_Error(
				'cp_login_required',
				__( 'This site is private. Please log in.', 'content-pipeline' ),
				array( 'status' => 401 )
			);
		}

		if ( ! current_user_can( Plugin::CAP ) ) {
			return new \WP_Error(
				'cp_forbidden',
				__( 'You do not have access to this hub.', 'content-pipeline' ),
				array( 'status' => 403 )
			);
		}

		return $result;
	}

	/**
	 * Stop the request with "403 Forbidden".
	 */
	private static function deny(): void {
		nocache_headers();

		$args = array( 'response' => 403 );

		// Logged in without hub permission: offer a way out to log in as someone else.
		if ( is_user_logged_in() ) {
			$args['link_url']  = wp_logout_url( add_query_arg( 'loggedout', 'true', wp_login_url() ) );
			$args['link_text'] = esc_html__( 'Log out', 'content-pipeline' ); // Not escaped by wp_die().
		}

		wp_die(
			esc_html__( 'This site is private.', 'content-pipeline' ),
			esc_html__( 'Private', 'content-pipeline' ),
			$args // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- link_text escaped above; wp_die() escapes link_url.
		);
	}

	/**
	 * The robots.txt file: ask all crawlers to stay out (WordPress no longer does this for hidden sites).
	 *
	 * @return string
	 */
	public static function robots_txt() {
		return "User-agent: *\nDisallow: /\n";
	}

	/**
	 * Option value "0".
	 *
	 * @return string
	 */
	public static function return_zero() {
		return '0';
	}

	/**
	 * Option value "closed".
	 *
	 * @return string
	 */
	public static function return_closed() {
		return 'closed';
	}

	/**
	 * With "Remember me" ticked, stay logged in for 30 days (WordPress default is 14).
	 *
	 * @param int  $length   Cookie lifetime in seconds.
	 * @param int  $user_id  User ID.
	 * @param bool $remember Whether "Remember me" was ticked.
	 * @return int
	 */
	public static function remember_me_length( $length, $user_id, $remember ) {
		unset( $user_id );
		return $remember ? self::REMEMBER_DAYS * DAY_IN_SECONDS : $length;
	}

	/**
	 * Tick "Remember me" on the login form by default.
	 */
	public static function tick_remember_me(): void {
		wp_print_inline_script_tag( "(function(){var b=document.getElementById('rememberme');if(b){b.checked=true;}})();" );
	}

	/**
	 * After login, go to the notes app unless a specific page was requested.
	 *
	 * @param string             $redirect_to           Where WordPress wants to go.
	 * @param string             $requested_redirect_to What the login form asked for.
	 * @param \WP_User|\WP_Error $user                  The user.
	 * @return string
	 */
	public static function after_login( $redirect_to, $requested_redirect_to, $user ) {
		if ( ! $user instanceof \WP_User || ! user_can( $user, Plugin::CAP ) ) {
			return $redirect_to;
		}

		$requested = untrailingslashit( (string) $requested_redirect_to );
		$defaults  = array( '', untrailingslashit( admin_url() ), untrailingslashit( home_url() ) );

		if ( in_array( $requested, $defaults, true ) ) {
			return App::url();
		}

		return $redirect_to;
	}
}
