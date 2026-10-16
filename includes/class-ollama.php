<?php
/**
 * Ollama connection test (Content Pipeline → Ollama test).
 *
 * Runs in the browser on the user's PC: the page talks to Ollama on that PC directly
 * (http://localhost:11434). The hub server never connects to Ollama.
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Ollama test page.
 */
final class Ollama {

	/**
	 * Admin page slug.
	 */
	public const PAGE = 'content-pipeline-ollama';

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ), 20 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
	}

	/**
	 * Submenu entry.
	 */
	public static function menu(): void {
		add_submenu_page(
			Admin::PAGE,
			__( 'Ollama test', 'content-pipeline' ),
			__( 'Ollama test', 'content-pipeline' ),
			Plugin::CAP,
			self::PAGE,
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * The hub's address as Ollama must allow it (scheme + host + port).
	 */
	public static function origin(): string {
		$parts  = wp_parse_url( home_url() );
		$origin = ( $parts['scheme'] ?? 'https' ) . '://' . ( $parts['host'] ?? '' );
		if ( ! empty( $parts['port'] ) ) {
			$origin .= ':' . $parts['port'];
		}
		return $origin;
	}

	/**
	 * Load the page script.
	 *
	 * @param string $hook Admin page hook.
	 */
	public static function assets( $hook ): void {
		if ( false === strpos( (string) $hook, self::PAGE ) ) {
			return;
		}
		wp_enqueue_script( 'content-pipeline-ollama', CONTENT_PIPELINE_URL . 'assets/js/ollama.js', array(), CONTENT_PIPELINE_VERSION, true );
		wp_localize_script(
			'content-pipeline-ollama',
			'CP_OLLAMA',
			array(
				'origin' => self::origin(),
			)
		);
	}

	/**
	 * Page.
	 */
	public static function render(): void {
		if ( ! current_user_can( Plugin::CAP ) ) {
			return;
		}
		$origin = self::origin();
		?>
		<div class="wrap" id="cp-ollama">
			<h1><?php esc_html_e( 'Ollama test', 'content-pipeline' ); ?></h1>
			<p style="max-width:760px"><?php esc_html_e( 'Open this page on the PC where Ollama runs. Your browser talks to Ollama on this PC directly; nothing is sent through the hub server. (On your phone this test cannot work, because "localhost" there means the phone.)', 'content-pipeline' ); ?></p>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="cp-ollama-url"><?php esc_html_e( 'Ollama address', 'content-pipeline' ); ?></label></th>
					<td>
						<input type="url" id="cp-ollama-url" class="regular-text" value="http://localhost:11434">
						<button type="button" class="button button-primary" id="cp-ollama-check"><?php esc_html_e( 'Check connection', 'content-pipeline' ); ?></button>
						<p class="description"><?php esc_html_e( 'Normally http://localhost:11434. Remembered in this browser.', 'content-pipeline' ); ?></p>
					</td>
				</tr>
			</table>

			<div id="cp-ollama-result" role="status" aria-live="polite"></div>

			<div id="cp-ollama-try" hidden>
				<h2><?php esc_html_e( 'Try a model', 'content-pipeline' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="cp-ollama-model"><?php esc_html_e( 'Model', 'content-pipeline' ); ?></label></th>
						<td><select id="cp-ollama-model"></select></td>
					</tr>
					<tr>
						<th scope="row"><label for="cp-ollama-prompt"><?php esc_html_e( 'Prompt', 'content-pipeline' ); ?></label></th>
						<td><textarea id="cp-ollama-prompt" class="large-text" rows="3"><?php esc_html_e( 'Write one short, friendly sentence about why job seekers should update their resume.', 'content-pipeline' ); ?></textarea></td>
					</tr>
				</table>
				<p><button type="button" class="button button-primary" id="cp-ollama-run"><?php esc_html_e( 'Run test prompt', 'content-pipeline' ); ?></button></p>
				<div id="cp-ollama-output" role="status" aria-live="polite"></div>
			</div>

			<h2><?php esc_html_e( 'If the check fails', 'content-pipeline' ); ?></h2>
			<ol style="max-width:760px">
				<li><?php esc_html_e( 'Make sure Ollama is running on this PC (its icon is in the taskbar tray).', 'content-pipeline' ); ?></li>
				<li>
					<?php esc_html_e( 'Allow this hub to talk to Ollama. On Windows: Start → search "environment variables" → "Edit environment variables for your account" → New. Name:', 'content-pipeline' ); ?>
					<code>OLLAMA_ORIGINS</code>
					<?php esc_html_e( 'Value:', 'content-pipeline' ); ?>
					<code id="cp-ollama-origin"><?php echo esc_html( $origin ); ?></code>
					<button type="button" class="button button-small" id="cp-ollama-copy"><?php esc_html_e( 'Copy', 'content-pipeline' ); ?></button>
				</li>
				<li><?php esc_html_e( 'Quit Ollama completely (right-click the tray icon → Quit Ollama) and start it again, so it reads the new setting.', 'content-pipeline' ); ?></li>
				<li><?php esc_html_e( 'If Chrome asks to allow this site to access devices on your local network, choose Allow. If you blocked it before: click the icon left of the address bar → Site settings → Local network access → Allow.', 'content-pipeline' ); ?></li>
				<li><?php esc_html_e( 'If no models are listed, download one in a terminal with: ollama pull MODEL-NAME (pick a model at ollama.com/library).', 'content-pipeline' ); ?></li>
			</ol>
		</div>
		<?php
	}
}
