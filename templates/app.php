<?php
/**
 * Notes app page. The app itself is built by assets/js/app.js.
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
<meta name="theme-color" content="#c8102e">
<meta name="mobile-web-app-capable" content="yes">
<title><?php echo esc_html( __( 'Notes', 'content-pipeline' ) . ' · ' . $data['site_name'] ); ?></title>
<link rel="manifest" href="<?php echo esc_url( $data['manifest_url'] ); ?>" crossorigin="use-credentials">
<link rel="icon" type="image/png" sizes="32x32" href="<?php echo esc_url( $data['icons_url'] . 'favicon-32.png' ); ?>">
<link rel="apple-touch-icon" href="<?php echo esc_url( $data['icons_url'] . 'apple-touch-icon.png' ); ?>">
<?php wp_print_styles( array( 'content-pipeline-app' ) ); ?>
</head>
<body class="cp-app">
<div id="cp-root" class="cp-root">
	<noscript><p class="cp-noscript"><?php esc_html_e( 'The notes app needs JavaScript. Please turn it on in your browser.', 'content-pipeline' ); ?></p></noscript>
	<p class="cp-loading"><?php esc_html_e( 'Loading your notes…', 'content-pipeline' ); ?></p>
</div>
<?php
wp_print_inline_script_tag(
	'window.CP_APP = ' . wp_json_encode( $data['config'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP ) . ';',
	array( 'id' => 'cp-app-config' )
);
wp_print_scripts( array( 'content-pipeline-app' ) );
?>
</body>
</html>
