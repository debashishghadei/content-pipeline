<?php
/**
 * Protected images in notes.
 *
 * Files are stored OUTSIDE the public web folder (Cloudways: the app's private_html folder
 * next to public_html, or the folder in CONTENT_PIPELINE_FILES_DIR), so the web server can
 * never hand them out directly. They are only sent through PHP after the login check
 * (/?cp_file=ID). If no such folder is available, adding images is switched off: a folder
 * inside the website is never used, because Nginx can serve files there directly.
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Image storage and delivery.
 */
final class Files {

	/**
	 * Query variable for viewing a file.
	 */
	public const QUERY_VAR = 'cp_file';

	/**
	 * Largest accepted image in bytes (the app shrinks photos before upload).
	 */
	public const MAX_BYTES = 15728640;

	/**
	 * Allowed image types and their file extensions.
	 */
	private const TYPES = array(
		'image/jpeg' => 'jpg',
		'image/png'  => 'png',
		'image/gif'  => 'gif',
		'image/webp' => 'webp',
	);

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		// After the lockdown gate (-100) and before the app's home redirect (1).
		add_action( 'template_redirect', array( __CLASS__, 'serve' ), 0 );
	}

	/**
	 * Register the query variable.
	 *
	 * @param string[] $vars Query variables.
	 * @return string[]
	 */
	public static function query_vars( $vars ) {
		$vars[] = self::QUERY_VAR;
		return $vars;
	}

	/**
	 * Folder where files are kept.
	 */
	public static function dir(): string {
		if ( defined( 'CONTENT_PIPELINE_FILES_DIR' ) && is_string( CONTENT_PIPELINE_FILES_DIR ) && '' !== CONTENT_PIPELINE_FILES_DIR ) {
			return untrailingslashit( CONTENT_PIPELINE_FILES_DIR );
		}
		$private = self::private_root();
		if ( '' !== $private ) {
			return $private . '/content-pipeline-files';
		}
		$uploads = wp_get_upload_dir();
		return untrailingslashit( $uploads['basedir'] ) . '/content-pipeline-private';
	}

	/**
	 * Folder used by 0.2.0–0.3.0 when no private folder existed (inside the website).
	 */
	public static function legacy_dir(): string {
		$uploads = wp_get_upload_dir();
		return untrailingslashit( $uploads['basedir'] ) . '/content-pipeline-private';
	}

	/**
	 * Images still in the old public folder.
	 *
	 * @return string[] Full paths.
	 */
	public static function legacy_files(): array {
		$dir = self::legacy_dir();
		if ( ! is_dir( $dir ) ) {
			return array();
		}
		$files = array();
		foreach ( (array) glob( $dir . '/*' ) as $path ) {
			$base = basename( (string) $path );
			$ext  = pathinfo( $base, PATHINFO_EXTENSION );
			if ( in_array( $ext, self::TYPES, true ) && self::valid_id( pathinfo( $base, PATHINFO_FILENAME ) ) ) {
				$files[] = (string) $path;
			}
		}
		return $files;
	}

	/**
	 * Move images from the old public folder into the private folder, then remove the old folder.
	 *
	 * @return array{moved: int, failed: int}|\WP_Error
	 */
	public static function move_legacy() {
		if ( ! self::enabled() ) {
			return new \WP_Error( 'cp_file_storage', __( 'There is no private folder outside the website yet, so the images cannot be moved.', 'content-pipeline' ) );
		}
		if ( ! self::ensure_dir() ) {
			return new \WP_Error( 'cp_file_dir', __( 'The server could not create the private folder for images. Check folder permissions.', 'content-pipeline' ) );
		}
		$moved  = 0;
		$failed = 0;
		foreach ( self::legacy_files() as $path ) {
			$target = self::dir() . '/' . basename( $path );
			// Move a private file between two server folders; the result is checked.
			$ok = file_exists( $target ) || @rename( $path, $target ) || ( @copy( $path, $target ) && filesize( $target ) === filesize( $path ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.rename_rename
			if ( $ok ) {
				wp_delete_file( $path );
				++$moved;
			} else {
				++$failed;
			}
		}
		if ( ! $failed ) {
			$dir = self::legacy_dir();
			foreach ( array( '.htaccess', 'index.php' ) as $guard ) {
				if ( file_exists( $dir . '/' . $guard ) ) {
					wp_delete_file( $dir . '/' . $guard );
				}
			}
			if ( is_dir( $dir ) && 2 === count( (array) scandir( $dir ) ) ) {
				// Remove the now empty old folder (best effort).
				@rmdir( $dir ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
			}
		}
		return array(
			'moved'  => $moved,
			'failed' => $failed,
		);
	}

	/**
	 * Can images be added? Only when the storage folder is outside the public web folder.
	 */
	public static function enabled(): bool {
		return self::is_outside_public();
	}

	/**
	 * Is the folder outside the public web folder?
	 */
	public static function is_outside_public(): bool {
		$dir = wp_normalize_path( self::dir() );
		$pub = wp_normalize_path( untrailingslashit( ABSPATH ) );
		return 0 !== strpos( $dir . '/', $pub . '/' );
	}

	/**
	 * Cloudways-style private_html next to the WordPress folder, if usable.
	 */
	private static function private_root(): string {
		$candidate = dirname( untrailingslashit( ABSPATH ) ) . '/private_html';
		return ( is_dir( $candidate ) && wp_is_writable( $candidate ) ) ? $candidate : '';
	}

	/**
	 * Make sure the folder exists and is closed to the web.
	 */
	public static function ensure_dir(): bool {
		$dir = self::dir();
		if ( ! is_dir( $dir ) && ! wp_mkdir_p( $dir ) ) {
			return false;
		}
		if ( ! file_exists( $dir . '/index.php' ) ) {
			file_put_contents( $dir . '/index.php', "<?php\n// Silence is golden.\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- tiny guard file.
		}
		if ( ! file_exists( $dir . '/.htaccess' ) ) {
			file_put_contents( $dir . '/.htaccess', "Require all denied\nDeny from all\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- tiny guard file.
		}
		return wp_is_writable( $dir );
	}

	/**
	 * Address for viewing a file (login required).
	 *
	 * @param string $id File id.
	 */
	public static function url( string $id ): string {
		return add_query_arg( self::QUERY_VAR, $id, home_url( '/' ) );
	}

	/**
	 * Files attached to a note.
	 *
	 * @param int $note_id Note id.
	 * @return array<int, array{id: string, name: string, mime: string, size: int, w: int, h: int, url: string}>
	 */
	public static function list_for( int $note_id ): array {
		$files = get_post_meta( $note_id, 'cp_files', true );
		if ( ! is_array( $files ) ) {
			return array();
		}
		$out = array();
		foreach ( $files as $file ) {
			if ( ! is_array( $file ) || empty( $file['id'] ) || ! self::valid_id( (string) $file['id'] ) ) {
				continue;
			}
			$out[] = array(
				'id'   => (string) $file['id'],
				'name' => (string) ( $file['name'] ?? '' ),
				'mime' => (string) ( $file['mime'] ?? '' ),
				'size' => (int) ( $file['size'] ?? 0 ),
				'w'    => (int) ( $file['w'] ?? 0 ),
				'h'    => (int) ( $file['h'] ?? 0 ),
				'url'  => self::url( (string) $file['id'] ),
			);
		}
		return $out;
	}

	/**
	 * Store an uploaded image for a note.
	 *
	 * @param int   $note_id Note id.
	 * @param array $upload  One entry of $_FILES.
	 * @return array|\WP_Error The new file entry.
	 */
	public static function add( int $note_id, array $upload ) {
		if ( ! self::enabled() ) {
			return new \WP_Error( 'cp_file_storage', __( 'Images are switched off: there is no private folder outside the website to keep them in. See Content Pipeline → Status & privacy.', 'content-pipeline' ), array( 'status' => 409 ) );
		}

		$tmp  = (string) ( $upload['tmp_name'] ?? '' );
		$size = (int) ( $upload['size'] ?? 0 );

		if ( ! empty( $upload['error'] ) || '' === $tmp || ! is_uploaded_file( $tmp ) ) {
			return new \WP_Error( 'cp_file_upload', __( 'The image did not arrive. Please try again.', 'content-pipeline' ), array( 'status' => 400 ) );
		}
		if ( $size <= 0 || $size > self::MAX_BYTES ) {
			return new \WP_Error( 'cp_file_size', __( 'Images can be up to 15 MB.', 'content-pipeline' ), array( 'status' => 400 ) );
		}

		$mime = (string) wp_get_image_mime( $tmp );
		if ( ! isset( self::TYPES[ $mime ] ) ) {
			return new \WP_Error( 'cp_file_type', __( 'Only JPG, PNG, GIF and WebP images can be added.', 'content-pipeline' ), array( 'status' => 400 ) );
		}
		$dims = @getimagesize( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- broken images are rejected below.
		if ( ! $dims ) {
			return new \WP_Error( 'cp_file_type', __( 'That file is not a readable image.', 'content-pipeline' ), array( 'status' => 400 ) );
		}

		if ( ! self::ensure_dir() ) {
			return new \WP_Error( 'cp_file_dir', __( 'The server could not create the folder for images. Check folder permissions.', 'content-pipeline' ), array( 'status' => 500 ) );
		}

		$id   = bin2hex( random_bytes( 16 ) );
		$path = self::dir() . '/' . $id . '.' . self::TYPES[ $mime ];

		if ( ! @move_uploaded_file( $tmp, $path ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- error reported below.
			return new \WP_Error( 'cp_file_save', __( 'The image could not be saved on the server.', 'content-pipeline' ), array( 'status' => 500 ) );
		}

		$entry = array(
			'id'   => $id,
			'name' => mb_substr( sanitize_file_name( (string) ( $upload['name'] ?? 'image' ) ), 0, 120 ),
			'mime' => $mime,
			'size' => $size,
			'w'    => (int) $dims[0],
			'h'    => (int) $dims[1],
		);

		$files   = get_post_meta( $note_id, 'cp_files', true );
		$files   = is_array( $files ) ? $files : array();
		$files[] = $entry;
		update_post_meta( $note_id, 'cp_files', $files );

		$entry['url'] = self::url( $id );
		return $entry;
	}

	/**
	 * Remove one image from a note and delete the file.
	 *
	 * @param int    $note_id Note id.
	 * @param string $file_id File id.
	 */
	public static function remove( int $note_id, string $file_id ): bool {
		$files = get_post_meta( $note_id, 'cp_files', true );
		if ( ! is_array( $files ) ) {
			return false;
		}
		$kept  = array();
		$found = false;
		foreach ( $files as $file ) {
			if ( is_array( $file ) && ( $file['id'] ?? '' ) === $file_id ) {
				$found = true;
				self::unlink( $file_id );
				continue;
			}
			$kept[] = $file;
		}
		if ( $found ) {
			update_post_meta( $note_id, 'cp_files', $kept );
		}
		return $found;
	}

	/**
	 * Delete every file of a note (note deleted for good).
	 *
	 * @param int $note_id Note id.
	 */
	public static function delete_all_for( int $note_id ): void {
		foreach ( self::list_for( $note_id ) as $file ) {
			self::unlink( $file['id'] );
		}
	}

	/**
	 * Send a file to a logged-in hub user.
	 */
	public static function serve(): void {
		$id = get_query_var( self::QUERY_VAR );
		if ( '' === $id || null === $id ) {
			return;
		}
		if ( ! Plugin::current_user_can_use() ) {
			return; // The lockdown gate already answered.
		}

		$id   = (string) $id;
		$path = self::valid_id( $id ) ? self::path_for( $id ) : '';
		if ( '' === $path ) {
			status_header( 404 );
			nocache_headers();
			header( 'Content-Type: text/plain; charset=utf-8' );
			echo 'Not found.';
			exit;
		}

		Lockdown::no_page_cache();
		$ext  = pathinfo( $path, PATHINFO_EXTENSION );
		$mime = (string) array_search( $ext, self::TYPES, true );

		status_header( 200 );
		header( 'Content-Type: ' . $mime );
		header( 'Content-Length: ' . (string) filesize( $path ) );
		header( 'Cache-Control: private, max-age=31536000, immutable' );
		header( 'X-Content-Type-Options: nosniff' );
		header( 'X-Robots-Tag: noindex, nofollow', true );
		header( "Content-Security-Policy: default-src 'none'; sandbox" );
		header( 'Content-Disposition: inline; filename="' . $id . '.' . $ext . '"' );
		readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- streams a private image.
		exit;
	}

	/**
	 * Check a file id: 32 lowercase hex characters.
	 *
	 * @param string $id File id.
	 */
	public static function valid_id( string $id ): bool {
		return 1 === preg_match( '/^[a-f0-9]{32}$/', $id );
	}

	/**
	 * Path of a stored file, or '' when missing.
	 *
	 * @param string $id File id.
	 */
	private static function path_for( string $id ): string {
		// The old public folder is only read, so images from 0.2.0–0.3.0 keep showing until moved.
		foreach ( array( self::dir(), self::legacy_dir() ) as $dir ) {
			foreach ( self::TYPES as $ext ) {
				$path = $dir . '/' . $id . '.' . $ext;
				if ( is_file( $path ) ) {
					return $path;
				}
			}
		}
		return '';
	}

	/**
	 * Delete a stored file.
	 *
	 * @param string $id File id.
	 */
	private static function unlink( string $id ): void {
		$path = self::valid_id( $id ) ? self::path_for( $id ) : '';
		if ( '' !== $path ) {
			wp_delete_file( $path );
		}
	}
}
