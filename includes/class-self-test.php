<?php
/**
 * Live check: the server requests its own pages as a logged-out visitor
 * and records what really came back (catches caches such as Varnish).
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Live privacy check.
 */
final class Self_Test {

	/**
	 * Option holding the last result.
	 */
	public const OPTION = 'content_pipeline_self_test';

	/**
	 * The admin-post action and nonce name.
	 */
	public const ACTION = 'content_pipeline_self_test';

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		add_action( 'admin_post_' . self::ACTION, array( __CLASS__, 'handle' ) );
	}

	/**
	 * "Run check now" button.
	 */
	public static function handle(): void {
		if ( ! current_user_can( Plugin::CAP ) ) {
			wp_die( esc_html__( 'You do not have access to this hub.', 'content-pipeline' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION );

		update_option( self::OPTION, self::run(), false );

		wp_safe_redirect( admin_url( 'admin.php?page=' . Admin::PAGE ) );
		exit;
	}

	/**
	 * Last stored result, or null when the check never ran.
	 *
	 * @return array{time: int, results: array}|null
	 */
	public static function last(): ?array {
		$last = get_option( self::OPTION );
		return is_array( $last ) && isset( $last['time'], $last['results'] ) ? $last : null;
	}

	/**
	 * Run all checks. No cookies are sent, so the server is a logged-out visitor.
	 *
	 * @return array{time: int, results: array<int, array{state: string, label: string, text: string}>}
	 */
	public static function run(): array {
		$results = array();

		$home      = self::request( home_url( '/' ) );
		$results[] = self::expect_login( __( 'Home page', 'content-pipeline' ), $home );
		$results[] = self::expect_login( __( 'Notes app', 'content-pipeline' ), self::request( App::url() ) );
		$results[] = self::expect_login( __( 'Feed', 'content-pipeline' ), self::request( home_url( '/?feed=rss2' ) ) );

		$rest      = self::request( rest_url( 'wp/v2/users' ) );
		$results[] = self::expect_code( __( 'REST API (users list)', 'content-pipeline' ), $rest, 401 );

		$xmlrpc    = self::request(
			site_url( 'xmlrpc.php' ),
			'POST',
			'<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName></methodCall>'
		);
		$results[] = self::expect_code( __( 'XML-RPC', 'content-pipeline' ), $xmlrpc, 403 );

		$robots = self::request( home_url( '/robots.txt' ) );
		if ( is_wp_error( $robots ) ) {
			$results[] = self::unreachable( __( 'robots.txt', 'content-pipeline' ), $robots );
		} else {
			$ok        = 200 === wp_remote_retrieve_response_code( $robots ) && preg_match( '/^Disallow:\s*\/\s*$/m', wp_remote_retrieve_body( $robots ) );
			$results[] = array(
				'state' => $ok ? 'ok' : 'fail',
				'label' => __( 'robots.txt', 'content-pipeline' ),
				'text'  => $ok ? __( 'Asks all crawlers to stay out.', 'content-pipeline' ) : __( 'Does not say "Disallow: /". A real robots.txt file in the site folder may be overriding WordPress; delete it.', 'content-pipeline' ),
			);
		}

		if ( ! is_wp_error( $home ) ) {
			$noindex   = false !== stripos( (string) wp_remote_retrieve_header( $home, 'x-robots-tag' ), 'noindex' );
			$results[] = array(
				'state' => $noindex ? 'ok' : 'fail',
				'label' => __( 'Noindex header', 'content-pipeline' ),
				'text'  => $noindex ? __( 'Search engines are told not to index.', 'content-pipeline' ) : __( 'The X-Robots-Tag header is missing. A cache or proxy may be removing it.', 'content-pipeline' ),
			);

			$cache     = self::cache_signal( $home );
			$results[] = array(
				'state' => '' === $cache ? 'ok' : 'warn',
				'label' => __( 'Page cache', 'content-pipeline' ),
				/* translators: %s: cache response headers. */
				'text'  => '' === $cache ? __( 'No cached answer detected.', 'content-pipeline' ) : sprintf( __( 'A cache answered (%s). Turn Varnish off for this app (Cloudways → Application Settings) and purge all caches, then run the check again.', 'content-pipeline' ), $cache ),
			);
		}

		return array(
			'time'    => time(),
			'results' => $results,
		);
	}

	/**
	 * Request a URL like a logged-out visitor, without following redirects.
	 *
	 * @param string $url    URL.
	 * @param string $method GET or POST.
	 * @param string $body   POST body.
	 * @return array|\WP_Error
	 */
	private static function request( string $url, string $method = 'GET', string $body = '' ) {
		$args = array(
			'method'      => $method,
			'timeout'     => 15,
			'redirection' => 0,
			'headers'     => array( 'Cache-Control' => 'no-cache' ),
		);
		if ( 'POST' === $method ) {
			$args['body']                    = $body;
			$args['headers']['Content-Type'] = 'text/xml';
		}
		return wp_remote_request( $url, $args );
	}

	/**
	 * Expect a redirect to the login screen.
	 *
	 * @param string          $label    Row label.
	 * @param array|\WP_Error $response Response.
	 * @return array{state: string, label: string, text: string}
	 */
	private static function expect_login( string $label, $response ): array {
		if ( is_wp_error( $response ) ) {
			return self::unreachable( $label, $response );
		}

		$code     = (int) wp_remote_retrieve_response_code( $response );
		$location = (string) wp_remote_retrieve_header( $response, 'location' );

		if ( in_array( $code, array( 301, 302, 303, 307 ), true ) && false !== strpos( $location, 'wp-login.php' ) ) {
			return array(
				'state' => 'ok',
				'label' => $label,
				'text'  => __( 'Visitors are sent to the login screen.', 'content-pipeline' ),
			);
		}

		return array(
			'state' => 'fail',
			'label' => $label,
			/* translators: %d: HTTP status code. */
			'text'  => sprintf( __( 'Visitors got answer %d instead of the login screen. If a cache is on (Varnish, Breeze, Cloudflare), turn it off for this app and purge it.', 'content-pipeline' ), $code ),
		);
	}

	/**
	 * Expect a specific HTTP status code.
	 *
	 * @param string          $label    Row label.
	 * @param array|\WP_Error $response Response.
	 * @param int             $expected Expected code.
	 * @return array{state: string, label: string, text: string}
	 */
	private static function expect_code( string $label, $response, int $expected ): array {
		if ( is_wp_error( $response ) ) {
			return self::unreachable( $label, $response );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$ok   = $expected === $code;

		return array(
			'state' => $ok ? 'ok' : 'fail',
			'label' => $label,
			'text'  => $ok
				/* translators: %d: HTTP status code. */
				? sprintf( __( 'Blocked for visitors (answer %d).', 'content-pipeline' ), $code )
				/* translators: 1: expected HTTP status code, 2: received HTTP status code. */
				: sprintf( __( 'Expected answer %1$d, got %2$d.', 'content-pipeline' ), $expected, $code ),
		);
	}

	/**
	 * Row for a request that could not be made.
	 *
	 * @param string    $label Row label.
	 * @param \WP_Error $error Error.
	 * @return array{state: string, label: string, text: string}
	 */
	private static function unreachable( string $label, \WP_Error $error ): array {
		return array(
			'state' => 'warn',
			'label' => $label,
			/* translators: %s: error message. */
			'text'  => sprintf( __( 'The server could not reach its own address, so this was not checked (%s). Check by opening the site in a private browser window.', 'content-pipeline' ), $error->get_error_message() ),
		);
	}

	/**
	 * Headers that show a cache answered instead of WordPress.
	 *
	 * @param array $response Response.
	 * @return string Empty when nothing points to a cache.
	 */
	private static function cache_signal( $response ): string {
		$found = array();

		foreach ( array( 'x-cache', 'cf-cache-status', 'x-varnish-cache', 'x-proxy-cache' ) as $name ) {
			$value = (string) wp_remote_retrieve_header( $response, $name );
			if ( '' !== $value && false !== stripos( $value, 'hit' ) ) {
				$found[] = $name . ': ' . $value;
			}
		}

		$age = (int) wp_remote_retrieve_header( $response, 'age' );
		if ( $age > 0 ) {
			$found[] = 'age: ' . $age;
		}

		return implode( ', ', $found );
	}
}
