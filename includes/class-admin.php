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
	 * Privacy status checks shown on the admin page.
	 *
	 * @return array<int, array{state: string, label: string, text: string}>
	 */
	public static function checks(): array {
		$checks = array();

		$checks[] = array(
			'state' => 'ok',
			'label' => __( 'Private site', 'content-pipeline' ),
			'text'  => __( 'Logged-out visitors only see the login screen. REST API, feeds, sitemaps, author pages, comments and XML-RPC are blocked.', 'content-pipeline' ),
		);

		$checks[] = array(
			'state' => 'ok',
			'label' => __( 'Search engines', 'content-pipeline' ),
			'text'  => __( 'Told not to index anything (forced by this plugin, whatever Settings → Reading says).', 'content-pipeline' ),
		);

		$checks[] = array(
			'state' => 'ok',
			'label' => __( 'Registration', 'content-pipeline' ),
			'text'  => __( 'New user sign-ups are switched off.', 'content-pipeline' ),
		);

		$checks[] = array(
			'state' => 'ok',
			'label' => __( 'Remember me', 'content-pipeline' ),
			/* translators: %d: number of days. */
			'text'  => sprintf( __( 'Ticked by default on the login screen; keeps you logged in for %d days.', 'content-pipeline' ), Lockdown::REMEMBER_DAYS ),
		);

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
				'text'  => __( 'The site uses HTTPS, so your login is encrypted.', 'content-pipeline' ),
			);
		} else {
			$checks[] = array(
				'state' => 'warn',
				'label' => __( 'HTTPS', 'content-pipeline' ),
				'text'  => __( 'The site address is not HTTPS. Add the free SSL certificate in Cloudways and update the site address, so your password is never sent unencrypted.', 'content-pipeline' ),
			);
		}

		$checks[] = array(
			'state' => 'warn',
			'label' => __( 'Uploaded files', 'content-pipeline' ),
			'text'  => __( 'Files in the Media Library can still be opened by anyone who has the direct link. Do not upload private files until version 0.5 (protected attachments).', 'content-pipeline' ),
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
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Content Pipeline Hub', 'content-pipeline' ); ?></h1>
			<p>
				<a class="button button-primary" href="<?php echo esc_url( App::url() ); ?>"><?php esc_html_e( 'Open notes', 'content-pipeline' ); ?></a>
			</p>
			<h2><?php esc_html_e( 'Privacy status', 'content-pipeline' ); ?></h2>
			<table class="widefat striped" style="max-width:900px">
				<tbody>
				<?php foreach ( self::checks() as $check ) : ?>
					<tr>
						<td style="width:28px">
							<span class="dashicons <?php echo esc_attr( 'ok' === $check['state'] ? 'dashicons-yes-alt' : 'dashicons-warning' ); ?>" style="color:<?php echo esc_attr( 'ok' === $check['state'] ? '#008a20' : '#b26200' ); ?>"></span>
						</td>
						<th scope="row" style="width:160px"><?php echo esc_html( $check['label'] ); ?></th>
						<td><?php echo esc_html( $check['text'] ); ?></td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
			<p class="description">
				<?php
				/* translators: %s: plugin version. */
				echo esc_html( sprintf( __( 'Version %s', 'content-pipeline' ), CONTENT_PIPELINE_VERSION ) );
				?>
			</p>
		</div>
		<?php
	}
}
