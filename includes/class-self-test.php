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
	 * Visitor pages are requested twice as an ordinary visitor (no cache-bypass headers,
	 * so a cache can answer, as it would for a real visitor) and once with "no-cache"
	 * for comparison. Passing is a spot check of these requests, not a guarantee.
	 *
	 * @return array{time: int, results: array<int, array{state: string, label: string, text: string}>}
	 */
	public static function run(): array {
		$results  = array();
		$seen     = array();
		$differed = false;

		$pages = array(
			array( __( 'Home page', 'content-pipeline' ), home_url( '/' ) ),
			array( __( 'Notes app', 'content-pipeline' ), App::url() ),
			array( __( 'Feed', 'content-pipeline' ), home_url( '/?feed=rss2' ) ),
		);
		foreach ( $pages as $page ) {
			$plain     = array( self::request( $page[1] ), self::request( $page[1] ) );
			$fresh     = self::request( $page[1], 'GET', '', true );
			$seen      = array_merge( $seen, $plain );
			$row       = self::expect_login( $page[0], $plain, $fresh );
			$differed  = $differed || ! empty( $row['cache'] );
			$results[] = array_intersect_key( $row, array_flip( array( 'state', 'label', 'text' ) ) );
		}

		$rest      = array( self::request( rest_url( 'wp/v2/users' ) ), self::request( rest_url( 'wp/v2/users' ) ) );
		$seen      = array_merge( $seen, $rest );
		$results[] = self::expect_code( __( 'REST API (users list)', 'content-pipeline' ), $rest, 401 );

		$xmlrpc    = self::request(
			site_url( 'xmlrpc.php' ),
			'POST',
			'<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName></methodCall>'
		);
		$results[] = self::expect_code( __( 'XML-RPC', 'content-pipeline' ), array( $xmlrpc ), 403 );

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

		$home = $seen[0];
		if ( ! is_wp_error( $home ) ) {
			$noindex   = false !== stripos( (string) wp_remote_retrieve_header( $home, 'x-robots-tag' ), 'noindex' );
			$results[] = array(
				'state' => $noindex ? 'ok' : 'fail',
				'label' => __( 'Noindex header', 'content-pipeline' ),
				'text'  => $noindex ? __( 'Search engines are told not to index.', 'content-pipeline' ) : __( 'The X-Robots-Tag header is missing. A cache or proxy may be removing it.', 'content-pipeline' ),
			);
		}

		$signals = array();
		foreach ( $seen as $response ) {
			if ( ! is_wp_error( $response ) ) {
				$signals = array_merge( $signals, self::cache_signal( $response ) );
			}
		}
		$signals = array_unique( $signals );

		if ( $differed ) {
			$state = 'fail';
			$text  = __( 'A cache gave normal visitors a different answer than a fresh request (see the rows above). Turn Varnish off for this app (Cloudways → Application Settings), purge all caches, then run the check again.', 'content-pipeline' );
		} elseif ( $signals ) {
			$state = 'warn';
			/* translators: %s: cache response headers. */
			$text = sprintf( __( 'A cache answered some requests (%s). The answers were still correct, but turn Varnish off for this app and purge all caches to be safe.', 'content-pipeline' ), implode( ', ', $signals ) );
		} else {
			$state = 'ok';
			$text  = __( 'No sign of a cache in these test requests (each page asked twice like a normal visitor, then compared with a fresh request). This is a spot check, not a guarantee: after changing any caching, check again.', 'content-pipeline' );
		}
		$results[] = array(
			'state' => $state,
			'label' => __( 'Page cache', 'content-pipeline' ),
			'text'  => $text,
		);

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
	 * @param bool   $fresh  Ask caches for a fresh answer (comparison only).
	 * @return array|\WP_Error
	 */
	private static function request( string $url, string $method = 'GET', string $body = '', bool $fresh = false ) {
		$args = array(
			'method'      => $method,
			'timeout'     => 15,
			'redirection' => 0,
			'headers'     => array(),
		);
		if ( $fresh ) {
			$args['headers']['Cache-Control'] = 'no-cache';
			$args['headers']['Pragma']        = 'no-cache';
		}
		if ( 'POST' === $method ) {
			$args['body']                    = $body;
			$args['headers']['Content-Type'] = 'text/xml';
		}
		return wp_remote_request( $url, $args );
	}

	/**
	 * Whether a response sends the visitor to the login screen.
	 *
	 * @param array $response Response.
	 */
	private static function is_login_redirect( $response ): bool {
		$code     = (int) wp_remote_retrieve_response_code( $response );
		$location = (string) wp_remote_retrieve_header( $response, 'location' );
		return in_array( $code, array( 301, 302, 303, 307 ), true ) && false !== strpos( $location, 'wp-login.php' );
	}

	/**
	 * Expect every ordinary request to redirect to the login screen.
	 *
	 * @param string                 $label Row label.
	 * @param array<array|\WP_Error> $plain Ordinary visitor responses.
	 * @param array|\WP_Error        $fresh Response to a "no-cache" request, for comparison.
	 * @return array{state: string, label: string, text: string, cache?: bool}
	 */
	private static function expect_login( string $label, array $plain, $fresh ): array {
		foreach ( $plain as $response ) {
			if ( is_wp_error( $response ) ) {
				return self::unreachable( $label, $response );
			}
			if ( self::is_login_redirect( $response ) ) {
				continue;
			}

			$code = (int) wp_remote_retrieve_response_code( $response );

			if ( ! is_wp_error( $fresh ) && self::is_login_redirect( $fresh ) ) {
				return array(
					'state' => 'fail',
					'label' => $label,
					/* translators: %d: HTTP status code. */
					'text'  => sprintf( __( 'A normal visitor got a stored copy (answer %d) instead of the login screen; only a fresh request was sent to login. A cache is serving private pages: turn Varnish off for this app, purge all caches, then check again.', 'content-pipeline' ), $code ),
					'cache' => true,
				);
			}

			return array(
				'state' => 'fail',
				'label' => $label,
				/* translators: %d: HTTP status code. */
				'text'  => sprintf( __( 'Visitors got answer %d instead of the login screen. If a cache is on (Varnish, Breeze, Cloudflare), turn it off for this app and purge it.', 'content-pipeline' ), $code ),
			);
		}

		return array(
			'state' => 'ok',
			'label' => $label,
			'text'  => __( 'Visitors are sent to the login screen.', 'content-pipeline' ),
		);
	}

	/**
	 * Expect a specific HTTP status code on every request.
	 *
	 * @param string                 $label     Row label.
	 * @param array<array|\WP_Error> $responses Responses.
	 * @param int                    $expected  Expected code.
	 * @return array{state: string, label: string, text: string}
	 */
	private static function expect_code( string $label, array $responses, int $expected ): array {
		foreach ( $responses as $response ) {
			if ( is_wp_error( $response ) ) {
				return self::unreachable( $label, $response );
			}
			$code = (int) wp_remote_retrieve_response_code( $response );
			if ( $expected !== $code ) {
				return array(
					'state' => 'fail',
					'label' => $label,
					/* translators: 1: expected HTTP status code, 2: received HTTP status code. */
					'text'  => sprintf( __( 'Expected answer %1$d, got %2$d.', 'content-pipeline' ), $expected, $code ),
				);
			}
		}

		return array(
			'state' => 'ok',
			'label' => $label,
			/* translators: %d: HTTP status code. */
			'text'  => sprintf( __( 'Blocked for visitors (answer %d).', 'content-pipeline' ), $expected ),
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
	 * @return string[] Empty when nothing points to a cache.
	 */
	private static function cache_signal( $response ): array {
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

		return $found;
	}
}
