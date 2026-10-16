<?php
/**
 * Admin: status page, menu links.
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Admin screens.
 */
final class Admin {

	/**
	 * Admin page slug.
	 */
	public const PAGE = 'content-pipeline';

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_bar_menu', array( __CLASS__, 'admin_bar' ), 35 );
		add_filter( 'plugin_action_links_' . plugin_basename( CONTENT_PIPELINE_FILE ), array( __CLASS__, 'action_links' ) );
	}

	/**
	 * "Content Pipeline" menu with the status page.
	 */
	public static function menu(): void {
		add_menu_page(
			__( 'Content Pipeline', 'content-pipeline' ),
			__( 'Content Pipeline', 'content-pipeline' ),
			Plugin::CAP,
			self::PAGE,
			array( __CLASS__, 'render_status' ),
			'dashicons-lightbulb',
			3
		);
	}

	/**
	 * "Notes" link in the top admin bar.
	 *
	 * @param \WP_Admin_Bar $bar Admin bar.
	 */
	public static function admin_bar( $bar ): void {
		if ( ! current_user_can( Plugin::CAP ) ) {
			return;
		}
		$bar->add_node(
			array(
				'id'    => 'content-pipeline-notes',
				'title' => __( 'Notes', 'content-pipeline' ),
				'href'  => App::url(),
			)
		);
	}

	/**
	 * "Open notes" and "Status" on the Plugins screen.
	 *
	 * @param string[] $links Existing links.
	 * @return string[]
	 */
	public static function action_links( $links ) {
		array_unshift(
			$links,
			sprintf( '<a href="%s">%s</a>', esc_url( App::url() ), esc_html__( 'Open notes', 'content-pipeline' ) ),
			sprintf( '<a href="%s">%s</a>', esc_url( admin_url( 'admin.php?page=' . self::PAGE ) ), esc_html__( 'Status', 'content-pipeline' ) )
		);
		return $links;
	}

	/**
	 * Rules this plugin switches on. These are settings, not test results.
	 *
	 * @return array<int, array{label: string, text: string}>
	 */
	public static function protections(): array {
		return array(
			array(
				'label' => __( 'Private site', 'content-pipeline' ),
				'text'  => __( 'Logged-out visitors are sent to the login screen. REST API, feeds, sitemaps, author pages, comments, sign-ups and XML-RPC are blocked.', 'content-pipeline' ),
			),
			array(
				'label' => __( 'Hub permission', 'content-pipeline' ),
				'text'  => __( 'Only administrators can use the hub. Other logged-in accounts (Editor, Subscriber…) get "This site is private" everywhere, including the dashboard.', 'content-pipeline' ),
			),
			array(
				'label' => __( 'Search engines', 'content-pipeline' ),
				'text'  => __( 'Told not to index anything (forced, whatever Settings → Reading says).', 'content-pipeline' ),
			),
			array(
				'label' => __( 'Registration', 'content-pipeline' ),
				'text'  => __( 'New user sign-ups are switched off.', 'content-pipeline' ),
			),
			array(
				'label' => __( 'Remember me', 'content-pipeline' ),
				/* translators: %d: number of days. */
				'text'  => sprintf( __( 'Ticked by default on the login screen; keeps you logged in for %d days.', 'content-pipeline' ), Lockdown::REMEMBER_DAYS ),
			),
		);
	}

	/**
	 * Things that need your attention.
	 *
	 * @return array<int, array{state: string, label: string, text: string}>
	 */
	public static function setup_checks(): array {
		$checks = array();

		if ( get_option( 'permalink_structure' ) ) {
			$checks[] = array(
				'state' => 'ok',
				'label' => __( 'Notes address', 'content-pipeline' ),
				'text'  => App::url(),
			);
		} else {
			$checks[] = array(
				'state' => 'warn',
				'label' => __( 'Notes address', 'content-pipeline' ),
				/* translators: %s: notes app URL. */
				'text'  => sprintf( __( '%s — set Settings → Permalinks to "Post name" for the cleaner /notes/ address.', 'content-pipeline' ), App::url() ),
			);
		}

		if ( 'https' === wp_parse_url( home_url(), PHP_URL_SCHEME ) ) {
			$checks[] = array(
				'state' => 'ok',
				'label' => __( 'HTTPS', 'content-pipeline' ),
				'text'  => __( 'The site address uses HTTPS, so your login is encrypted.', 'content-pipeline' ),
			);
		} else {
			$checks[] = array(
				'state' => 'warn',
				'label' => __( 'HTTPS', 'content-pipeline' ),
				'text'  => __( 'The site address is not HTTPS. Add the free SSL certificate in Cloudways and update the site address, so your password is never sent unencrypted.', 'content-pipeline' ),
			);
		}

		if ( Files::is_outside_public() ) {
			$checks[] = array(
				'state' => 'ok',
				'label' => __( 'Note images', 'content-pipeline' ),
				/* translators: %s: folder path on the server. */
				'text'  => sprintf( __( 'Stored outside the public web folder (%s) and shown only after login.', 'content-pipeline' ), Files::dir() ),
			);
		} else {
			$checks[] = array(
				'state' => 'warn',
				'label' => __( 'Note images', 'content-pipeline' ),
				/* translators: %s: folder path on the server. */
				'text'  => sprintf( __( 'No private folder next to the site was found, so images are kept in %s with random 32-character names and a "deny" rule. That rule only works on Apache; on Nginx a file whose exact name is known could be opened. On Cloudways this is normally the private_html folder; check it exists and is writable.', 'content-pipeline' ), Files::dir() ),
			);
		}

		$checks[] = array(
			'state' => 'warn',
			'label' => __( 'Media Library', 'content-pipeline' ),
			'text'  => __( 'Files uploaded to the WordPress Media Library are NOT protected (anyone with the direct link can open them). Add private images inside notes instead.', 'content-pipeline' ),
		);

		return $checks;
	}

	/**
	 * Status page.
	 */
	public static function render_status(): void {
		if ( ! current_user_can( Plugin::CAP ) ) {
			return;
		}
		$last = Self_Test::last();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Content Pipeline Hub', 'content-pipeline' ); ?></h1>
			<p>
				<a class="button button-primary" href="<?php echo esc_url( App::url() ); ?>"><?php esc_html_e( 'Open notes', 'content-pipeline' ); ?></a>
			</p>

			<h2><?php esc_html_e( 'Live check', 'content-pipeline' ); ?></h2>
			<p><?php esc_html_e( 'The server opens this site like a logged-out visitor and shows what really came back. Run it after installing, after changing caching, and after moving the site.', 'content-pipeline' ); ?></p>
			<?php if ( null === $last ) : ?>
				<?php
				self::render_rows(
					array(
						array(
							'state' => 'pending',
							'label' => __( 'Not checked yet', 'content-pipeline' ),
							'text'  => __( 'The protections below are switched on, but nothing has been verified on this server yet.', 'content-pipeline' ),
						),
					)
				);
				?>
			<?php else : ?>
				<p class="description">
					<?php
					/* translators: %s: time since the last check, e.g. "5 mins". */
					echo esc_html( sprintf( __( 'Last checked %s ago.', 'content-pipeline' ), human_time_diff( (int) $last['time'] ) ) );
					?>
				</p>
				<?php self::render_rows( $last['results'] ); ?>
			<?php endif; ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:12px">
				<input type="hidden" name="action" value="<?php echo esc_attr( Self_Test::ACTION ); ?>">
				<?php wp_nonce_field( Self_Test::ACTION ); ?>
				<?php submit_button( null === $last ? __( 'Run check now', 'content-pipeline' ) : __( 'Run check again', 'content-pipeline' ), 'secondary', 'submit', false ); ?>
			</form>

			<h2><?php esc_html_e( 'Protection enabled', 'content-pipeline' ); ?></h2>
			<?php
			$rows = array();
			foreach ( self::protections() as $protection ) {
				$rows[] = array(
					'state' => 'on',
					'label' => $protection['label'],
					'text'  => $protection['text'],
				);
			}
			self::render_rows( $rows );
			?>

			<h2><?php esc_html_e( 'Setup', 'content-pipeline' ); ?></h2>
			<?php self::render_rows( self::setup_checks() ); ?>

			<p class="description">
				<?php
				/* translators: %s: plugin version. */
				echo esc_html( sprintf( __( 'Version %s', 'content-pipeline' ), CONTENT_PIPELINE_VERSION ) );
				?>
			</p>
		</div>
		<?php
	}

	/**
	 * Print a table of status rows.
	 *
	 * @param array<int, array{state: string, label: string, text: string}> $rows Rows.
	 */
	private static function render_rows( array $rows ): void {
		$icons = array(
			'ok'      => array( 'dashicons-yes-alt', '#008a20', __( 'Passed', 'content-pipeline' ) ),
			'on'      => array( 'dashicons-shield', '#2271b1', __( 'Enabled', 'content-pipeline' ) ),
			'warn'    => array( 'dashicons-warning', '#b26200', __( 'Needs attention', 'content-pipeline' ) ),
			'fail'    => array( 'dashicons-dismiss', '#d63638', __( 'Failed', 'content-pipeline' ) ),
			'pending' => array( 'dashicons-clock', '#646970', __( 'Pending', 'content-pipeline' ) ),
		);
		?>
		<table class="widefat striped" style="max-width:900px">
			<tbody>
			<?php foreach ( $rows as $row ) : ?>
				<?php $icon = $icons[ $row['state'] ] ?? $icons['pending']; ?>
				<tr>
					<td style="width:28px">
						<span class="dashicons <?php echo esc_attr( $icon[0] ); ?>" style="color:<?php echo esc_attr( $icon[1] ); ?>" title="<?php echo esc_attr( $icon[2] ); ?>"></span>
						<span class="screen-reader-text"><?php echo esc_html( $icon[2] ); ?></span>
					</td>
					<th scope="row" style="width:180px"><?php echo esc_html( $row['label'] ); ?></th>
					<td><?php echo esc_html( $row['text'] ); ?></td>
				</tr>
			<?php endforeach; ?>
			</tbody>
		</table>
		<?php
	}
}
