<?php
/**
 * Notes app page (version 0.1: private shell, notes arrive in 0.2).
 *
 * @package ContentPipeline
 *
 * @var array $data Prepared in App::render().
 */

defined( 'ABSPATH' ) || exit;
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php echo esc_attr( get_option( 'blog_charset' ) ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#111418">
<title><?php echo esc_html( __( 'Notes', 'content-pipeline' ) . ' · ' . $data['site_name'] ); ?></title>
<?php wp_print_styles( array( 'content-pipeline-app' ) ); ?>
</head>
<body class="cp-app">
<header class="cp-bar">
	<div class="cp-bar__title">
		<span class="cp-bar__name"><?php esc_html_e( 'Notes', 'content-pipeline' ); ?></span>
		<span class="cp-bar__site"><?php echo esc_html( $data['site_name'] ); ?></span>
	</div>
	<nav class="cp-bar__links" aria-label="<?php esc_attr_e( 'Hub menu', 'content-pipeline' ); ?>">
		<a href="<?php echo esc_url( $data['admin_url'] ); ?>"><?php esc_html_e( 'Dashboard', 'content-pipeline' ); ?></a>
		<a href="<?php echo esc_url( $data['logout_url'] ); ?>"><?php esc_html_e( 'Log out', 'content-pipeline' ); ?></a>
	</nav>
</header>

<main class="cp-main">
	<section class="cp-card">
		<p class="cp-card__eyebrow"><?php esc_html_e( 'Private hub', 'content-pipeline' ); ?></p>
		<h1 class="cp-card__title">
			<?php
			/* translators: %s: user's display name. */
			echo esc_html( sprintf( __( 'Hi %s, your hub is locked and ready.', 'content-pipeline' ), $data['user_name'] ) );
			?>
		</h1>
		<p><?php esc_html_e( 'Only logged-in users can see this site. Visitors get the login screen, and search engines are told not to index anything.', 'content-pipeline' ); ?></p>
		<p class="cp-card__muted"><?php esc_html_e( 'Notes arrive in the next version (0.2).', 'content-pipeline' ); ?></p>
	</section>
</main>

<footer class="cp-foot">
	<?php
	/* translators: %s: plugin version. */
	echo esc_html( sprintf( __( 'Content Pipeline Hub %s', 'content-pipeline' ), $data['version'] ) );
	?>
</footer>
</body>
</html>
