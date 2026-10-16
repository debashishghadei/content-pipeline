<?php
/**
 * Notes data: private note type, folders, versions and history.
 *
 * A note is a private post of type cp_note:
 * - post_title   = title
 * - post_content = text
 * - post_excerpt = checklist as JSON (so revisions keep it too)
 * - meta cp_version   = text version (only title/text/checklist changes count)
 * - meta cp_status    = pipeline status
 * - meta cp_pinned    = 1 when pinned
 * - meta cp_client_id = id from the app, makes "create" safe to retry
 * - meta cp_files     = attached images (see Files)
 * Each note sits in exactly one folder (taxonomy cp_folder).
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Note and folder storage.
 */
final class Notes {

	public const POST_TYPE = 'cp_note';
	public const FOLDER    = 'cp_folder';

	public const INBOX_OPTION  = 'content_pipeline_inbox';
	public const SEEDED_OPTION = 'content_pipeline_seeded';

	/**
	 * History keeps at most one snapshot per note in this many seconds.
	 */
	public const HISTORY_GAP = 600;

	/**
	 * Snapshots kept per note.
	 */
	public const HISTORY_KEEP = 50;

	/**
	 * A note lock older than this (seconds) is treated as left behind by a crashed request.
	 */
	public const LOCK_SECONDS = 30;

	/**
	 * How long a save waits for another save of the same note to finish (seconds).
	 */
	public const LOCK_WAIT = 10;

	/**
	 * Lock tokens held by this request, by note id.
	 *
	 * @var array<int, string>
	 */
	private static $locks = array();

	/**
	 * When true, saving a note makes no history copy (the app makes its own, see snapshot_if_due()).
	 *
	 * @var bool
	 */
	private static $no_history = false;

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'register' ), 5 );
		add_action( 'init', array( __CLASS__, 'maybe_seed' ), 20 );
		add_filter( 'wp_revisions_to_keep', array( __CLASS__, 'revisions_to_keep' ), 10, 2 );
		add_action( 'save_post_' . self::POST_TYPE, array( __CLASS__, 'admin_screen_save' ), 10, 2 );
		add_action( 'before_delete_post', array( __CLASS__, 'before_delete' ), 10, 2 );
	}

	/**
	 * Pipeline statuses, in order.
	 *
	 * @return array<string, string>
	 */
	public static function statuses(): array {
		return array(
			'idea'          => __( 'Idea', 'content-pipeline' ),
			'outline_ready' => __( 'Outline ready', 'content-pipeline' ),
			'draft_ready'   => __( 'Draft ready', 'content-pipeline' ),
			'ready'         => __( 'Ready', 'content-pipeline' ),
			'published'     => __( 'Published', 'content-pipeline' ),
		);
	}

	/**
	 * Register the note type and the folder taxonomy. Both are private.
	 */
	public static function register(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'          => __( 'Notes', 'content-pipeline' ),
					'singular_name' => __( 'Note', 'content-pipeline' ),
					'all_items'     => __( 'All notes (backup view)', 'content-pipeline' ),
				),
				'public'              => false,
				'publicly_queryable'  => false,
				'exclude_from_search' => true,
				'show_ui'             => true,
				'show_in_menu'        => Admin::PAGE,
				'show_in_nav_menus'   => false,
				'show_in_admin_bar'   => false,
				'show_in_rest'        => false,
				'has_archive'         => false,
				'rewrite'             => false,
				'query_var'           => false,
				'can_export'          => true,
				'delete_with_user'    => false,
				'supports'            => array( 'title', 'editor', 'revisions' ),
				'capability_type'     => array( 'cp_note', 'cp_notes' ),
				'map_meta_cap'        => true,
			)
		);

		register_taxonomy(
			self::FOLDER,
			self::POST_TYPE,
			array(
				'labels'             => array(
					'name'          => __( 'Folders', 'content-pipeline' ),
					'singular_name' => __( 'Folder', 'content-pipeline' ),
				),
				'hierarchical'       => true,
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => false,
				'show_in_rest'       => false,
				'show_admin_column'  => true,
				'rewrite'            => false,
				'query_var'          => false,
				'capabilities'       => array(
					'manage_terms' => Plugin::CAP,
					'edit_terms'   => Plugin::CAP,
					'delete_terms' => Plugin::CAP,
					'assign_terms' => Plugin::CAP,
				),
			)
		);
	}

	/**
	 * First run (or first run after a manual update): create Inbox and the site folders.
	 */
	public static function maybe_seed(): void {
		if ( get_option( self::SEEDED_OPTION ) && self::inbox_id() ) {
			return;
		}

		if ( ! self::inbox_id() ) {
			$inbox = self::create_folder( __( 'Inbox', 'content-pipeline' ), 0 );
			if ( ! is_wp_error( $inbox ) ) {
				update_option( self::INBOX_OPTION, (int) $inbox, false );
			}
		}

		if ( ! get_option( self::SEEDED_OPTION ) ) {
			$sites = array( 'Madhu Infotech', 'happylife247', 'Personal brand', 'B2B tech' );
			foreach ( $sites as $site ) {
				$existing = term_exists( $site, self::FOLDER, 0 );
				$id       = $existing ? (int) $existing['term_id'] : self::create_folder( $site, 0 );
				if ( ! is_wp_error( $id ) ) {
					update_term_meta( (int) $id, 'cp_is_site', 1 );
				}
			}
			update_option( self::SEEDED_OPTION, 1, false );
		}
	}

	/**
	 * The Inbox folder id (0 if missing).
	 */
	public static function inbox_id(): int {
		$id = (int) get_option( self::INBOX_OPTION );
		if ( $id && term_exists( $id, self::FOLDER ) ) {
			return $id;
		}
		return 0;
	}

	/**
	 * Create a folder.
	 *
	 * @param string $name      Folder name.
	 * @param int    $parent_id Parent folder id, 0 for top level.
	 * @return int|\WP_Error
	 */
	public static function create_folder( string $name, int $parent_id ) {
		$parent = $parent_id;
		$name   = self::clean_name( $name );
		if ( '' === $name ) {
			return new \WP_Error( 'cp_folder_name', __( 'Please give the folder a name.', 'content-pipeline' ), array( 'status' => 400 ) );
		}
		if ( $parent && ! term_exists( $parent, self::FOLDER ) ) {
			return new \WP_Error( 'cp_folder_parent', __( 'That folder no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
		}
		if ( self::name_taken( $name, $parent, 0 ) ) {
			return new \WP_Error( 'cp_folder_exists', __( 'A folder with that name is already here.', 'content-pipeline' ), array( 'status' => 409 ) );
		}

		$result = wp_insert_term( $name, self::FOLDER, array( 'parent' => $parent ) );
		if ( is_wp_error( $result ) ) {
			return new \WP_Error( 'cp_folder_create', $result->get_error_message(), array( 'status' => 400 ) );
		}
		return (int) $result['term_id'];
	}

	/**
	 * Rename, move or flag a folder.
	 *
	 * @param int   $id      Folder id.
	 * @param array $changes Keys: name, parent, is_site.
	 * @return true|\WP_Error
	 */
	public static function update_folder( int $id, array $changes ) {
		$term = get_term( $id, self::FOLDER );
		if ( ! $term instanceof \WP_Term ) {
			return new \WP_Error( 'cp_folder_missing', __( 'That folder no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
		}

		$args = array();

		if ( array_key_exists( 'name', $changes ) ) {
			$name = self::clean_name( (string) $changes['name'] );
			if ( '' === $name ) {
				return new \WP_Error( 'cp_folder_name', __( 'Please give the folder a name.', 'content-pipeline' ), array( 'status' => 400 ) );
			}
			$args['name'] = $name;
		}

		$parent = (int) $term->parent;
		if ( array_key_exists( 'parent', $changes ) ) {
			$parent = (int) $changes['parent'];
			if ( self::inbox_id() === $id && 0 !== $parent ) {
				return new \WP_Error( 'cp_folder_inbox', __( 'The Inbox stays at the top level.', 'content-pipeline' ), array( 'status' => 400 ) );
			}
			if ( $parent && ! term_exists( $parent, self::FOLDER ) ) {
				return new \WP_Error( 'cp_folder_parent', __( 'That folder no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
			}
			if ( $parent === $id || in_array( $id, get_ancestors( $parent, self::FOLDER, 'taxonomy' ), true ) ) {
				return new \WP_Error( 'cp_folder_loop', __( 'A folder cannot be moved inside itself.', 'content-pipeline' ), array( 'status' => 400 ) );
			}
			$args['parent'] = $parent;
		}

		$check_name = $args['name'] ?? $term->name;
		if ( ( isset( $args['name'] ) || isset( $args['parent'] ) ) && self::name_taken( $check_name, $parent, $id ) ) {
			return new \WP_Error( 'cp_folder_exists', __( 'A folder with that name is already here.', 'content-pipeline' ), array( 'status' => 409 ) );
		}

		if ( $args ) {
			$result = wp_update_term( $id, self::FOLDER, $args );
			if ( is_wp_error( $result ) ) {
				return new \WP_Error( 'cp_folder_update', $result->get_error_message(), array( 'status' => 400 ) );
			}
		}

		if ( array_key_exists( 'is_site', $changes ) ) {
			if ( $changes['is_site'] ) {
				update_term_meta( $id, 'cp_is_site', 1 );
			} else {
				delete_term_meta( $id, 'cp_is_site' );
			}
		}

		return true;
	}

	/**
	 * Delete a folder and its subfolders. Their notes go to the trash (restorable).
	 *
	 * @param int $id Folder id.
	 * @return array{trashed: int}|\WP_Error
	 */
	public static function delete_folder( int $id ) {
		if ( ! term_exists( $id, self::FOLDER ) ) {
			return new \WP_Error( 'cp_folder_missing', __( 'That folder no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
		}
		if ( self::inbox_id() === $id ) {
			return new \WP_Error( 'cp_folder_inbox', __( 'The Inbox cannot be deleted.', 'content-pipeline' ), array( 'status' => 400 ) );
		}

		$ids = array_merge( array( $id ), array_map( 'intval', get_term_children( $id, self::FOLDER ) ) );
		if ( in_array( self::inbox_id(), $ids, true ) ) {
			return new \WP_Error( 'cp_folder_inbox', __( 'The Inbox cannot be deleted.', 'content-pipeline' ), array( 'status' => 400 ) );
		}

		$notes = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- small private site.
					array(
						'taxonomy'         => self::FOLDER,
						'terms'            => $ids,
						'include_children' => false,
					),
				),
			)
		);

		$trashed = 0;
		foreach ( $notes as $note_id ) {
			if ( 'trash' !== get_post_status( $note_id ) ) {
				wp_trash_post( $note_id );
				++$trashed;
			}
			// Trashed notes keep no folder; restoring puts them back in the Inbox.
			wp_set_object_terms( $note_id, array(), self::FOLDER );
		}

		// Deepest first, so no folder is left pointing at a deleted parent.
		foreach ( array_reverse( $ids ) as $folder_id ) {
			wp_delete_term( $folder_id, self::FOLDER );
		}

		return array( 'trashed' => $trashed );
	}

	/**
	 * All folders, flat (the app builds the tree).
	 *
	 * @return array<int, array{id: int, name: string, parent: int, is_site: bool}>
	 */
	public static function folders(): array {
		$terms = get_terms(
			array(
				'taxonomy'   => self::FOLDER,
				'hide_empty' => false,
				'orderby'    => 'name',
			)
		);
		if ( is_wp_error( $terms ) ) {
			return array();
		}

		$folders = array();
		foreach ( $terms as $term ) {
			$folders[] = array(
				'id'      => (int) $term->term_id,
				'name'    => html_entity_decode( $term->name, ENT_QUOTES, 'UTF-8' ),
				'parent'  => (int) $term->parent,
				'is_site' => (bool) get_term_meta( $term->term_id, 'cp_is_site', true ),
			);
		}
		return $folders;
	}

	/**
	 * Is a folder name already used by a sibling?
	 *
	 * @param string $name      Name.
	 * @param int    $parent_id Parent id.
	 * @param int    $exclude   Folder id to ignore (the one being renamed).
	 */
	private static function name_taken( string $name, int $parent_id, int $exclude ): bool {
		$parent   = $parent_id;
		$siblings = get_terms(
			array(
				'taxonomy'   => self::FOLDER,
				'hide_empty' => false,
				'parent'     => $parent,
				'fields'     => 'id=>name',
			)
		);
		if ( is_wp_error( $siblings ) ) {
			return false;
		}
		foreach ( $siblings as $sibling_id => $sibling_name ) {
			if ( (int) $sibling_id !== $exclude && 0 === strcasecmp( html_entity_decode( $sibling_name, ENT_QUOTES, 'UTF-8' ), $name ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Tidy a folder name.
	 *
	 * @param string $name Raw name.
	 */
	private static function clean_name( string $name ): string {
		$name = trim( preg_replace( '/\s+/u', ' ', sanitize_text_field( $name ) ) );
		return mb_substr( $name, 0, 100 );
	}

	/**
	 * Clean a checklist from the app.
	 *
	 * @param mixed $items Raw items.
	 * @return array<int, array{t: string, d: bool}>
	 */
	public static function clean_checklist( $items ): array {
		if ( ! is_array( $items ) ) {
			return array();
		}
		$clean = array();
		foreach ( array_slice( $items, 0, 500 ) as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			$clean[] = array(
				't' => mb_substr( str_replace( "\n", ' ', self::clean_text( $item['t'] ?? '' ) ), 0, 1000 ),
				'd' => ! empty( $item['d'] ),
			);
		}
		return $clean;
	}

	/**
	 * Clean note text. Notes are plain text: they are stored as typed (so "<b>", "%20"
	 * and backslashes survive) and always shown escaped by the app.
	 *
	 * @param mixed $text Raw text.
	 */
	public static function clean_text( $text ): string {
		$text = is_scalar( $text ) ? (string) $text : '';
		$text = wp_check_invalid_utf8( $text, true );
		$text = str_replace( array( "\r\n", "\r", "\0" ), array( "\n", "\n", '' ), $text );
		return mb_substr( $text, 0, 200000 );
	}

	/**
	 * Clean a note title (one line).
	 *
	 * @param mixed $title Raw title.
	 */
	public static function clean_title( $title ): string {
		return mb_substr( trim( str_replace( "\n", ' ', self::clean_text( $title ) ) ), 0, 300 );
	}

	/**
	 * Read a note's checklist.
	 *
	 * @param \WP_Post $post Note.
	 * @return array<int, array{t: string, d: bool}>
	 */
	public static function checklist( \WP_Post $post ): array {
		if ( '' === $post->post_excerpt ) {
			return array();
		}
		$items = json_decode( $post->post_excerpt, true );
		return self::clean_checklist( is_array( $items ) ? $items : array() );
	}

	/**
	 * The folder a note is in (0 when none, e.g. trashed).
	 *
	 * @param int $note_id Note id.
	 */
	public static function folder_of( int $note_id ): int {
		$terms = wp_get_object_terms( $note_id, self::FOLDER, array( 'fields' => 'ids' ) );
		return ( ! is_wp_error( $terms ) && $terms ) ? (int) $terms[0] : 0;
	}

	/**
	 * A note as the app sees it.
	 *
	 * @param \WP_Post $post Note.
	 * @return array<string, mixed>
	 */
	public static function to_array( \WP_Post $post ): array {
		$status = (string) get_post_meta( $post->ID, 'cp_status', true );
		return array(
			'id'        => (int) $post->ID,
			'title'     => $post->post_title,
			'body'      => $post->post_content,
			'checklist' => self::checklist( $post ),
			'folder'    => self::folder_of( $post->ID ),
			'status'    => isset( self::statuses()[ $status ] ) ? $status : 'idea',
			'pinned'    => (bool) get_post_meta( $post->ID, 'cp_pinned', true ),
			'version'   => max( 1, (int) get_post_meta( $post->ID, 'cp_version', true ) ),
			'created'   => get_post_time( 'c', true, $post ),
			'modified'  => get_post_modified_time( 'c', true, $post ),
			'trashed'   => 'trash' === $post->post_status,
			'files'     => Files::list_for( $post->ID ),
		);
	}

	/**
	 * All notes with a status (default: all notes that are not in the trash).
	 *
	 * @param string $status Post status: 'private' or 'trash'.
	 * @return array<int, array<string, mixed>>
	 */
	public static function all( string $status = 'private' ): array {
		$posts = get_posts(
			array(
				'post_type'              => self::POST_TYPE,
				'post_status'            => $status,
				'posts_per_page'         => -1,
				'orderby'                => 'modified',
				'order'                  => 'DESC',
				'no_found_rows'          => true,
				'update_post_term_cache' => true,
				'update_post_meta_cache' => true,
			)
		);
		return array_map( array( __CLASS__, 'to_array' ), $posts );
	}

	/**
	 * Find a note by the id the app gave it (makes "create" safe to retry).
	 *
	 * @param string $client_id App id.
	 */
	public static function find_by_client_id( string $client_id ): ?\WP_Post {
		if ( '' === $client_id ) {
			return null;
		}
		$found = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => array( 'private', 'trash' ),
				'posts_per_page' => 1,
				'meta_key'       => 'cp_client_id', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- small private site.
				'meta_value'     => $client_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- small private site.
			)
		);
		return $found ? $found[0] : null;
	}

	/**
	 * Get a note (private or trashed) or null.
	 *
	 * @param int $id Note id.
	 */
	public static function get( int $id ): ?\WP_Post {
		$post = get_post( $id );
		if ( $post instanceof \WP_Post && self::POST_TYPE === $post->post_type && in_array( $post->post_status, array( 'private', 'trash' ), true ) ) {
			return $post;
		}
		return null;
	}

	/**
	 * Take the note's lock, so only one request at a time can check the version and save
	 * (and restore history). Works on any database: the lock is a row in the options table
	 * that only one request can insert.
	 *
	 * @param int $note_id Note id.
	 * @return bool False when another save kept the note busy for LOCK_WAIT seconds.
	 */
	public static function lock( int $note_id ): bool {
		global $wpdb;

		$name     = 'cp_note_lock_' . $note_id;
		$token    = sprintf( '%010d-%s', time() + self::LOCK_SECONDS, wp_generate_password( 12, false ) );
		$deadline = microtime( true ) + self::LOCK_WAIT;

		do {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- an atomic insert is the lock; it must not be cached.
			$taken = $wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'off')", $name, $token ) );
			if ( 1 !== (int) $taken ) {
				// Take over a lock whose time ran out (its request crashed).
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- atomic compare-and-set.
				$taken = $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value < %s", $token, $name, sprintf( '%010d', time() ) ) );
			}
			if ( 1 === (int) $taken ) {
				self::$locks[ $note_id ] = $token;
				return true;
			}
			usleep( 100000 );
		} while ( microtime( true ) < $deadline );

		return false;
	}

	/**
	 * Release the note's lock (only if this request still holds it).
	 *
	 * @param int $note_id Note id.
	 */
	public static function unlock( int $note_id ): void {
		global $wpdb;
		if ( ! isset( self::$locks[ $note_id ] ) ) {
			return;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- releases the lock row.
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", 'cp_note_lock_' . $note_id, self::$locks[ $note_id ] ) );
		unset( self::$locks[ $note_id ] );
	}

	/**
	 * Read a note fresh from the database (no cached copy), e.g. right after taking its lock.
	 *
	 * @param int $note_id Note id.
	 */
	public static function fresh( int $note_id ): ?\WP_Post {
		clean_post_cache( $note_id );
		wp_cache_delete( $note_id, 'post_meta' );
		return self::get( $note_id );
	}

	/**
	 * Keep up to 50 earlier versions per note (none while the app saves; see without_history()).
	 *
	 * @param int      $num  Number to keep.
	 * @param \WP_Post $post Post.
	 * @return int
	 */
	public static function revisions_to_keep( $num, $post ) {
		if ( ! $post instanceof \WP_Post || self::POST_TYPE !== $post->post_type ) {
			return $num;
		}
		return self::$no_history ? 0 : self::HISTORY_KEEP;
	}

	/**
	 * Run a save without WordPress making a history copy of the new text.
	 *
	 * @param callable $save Save function.
	 * @return mixed What the save function returns.
	 */
	public static function without_history( callable $save ) {
		self::$no_history = true;
		try {
			return $save();
		} finally {
			self::$no_history = false;
		}
	}

	/**
	 * History keeps EARLIER text: before a change, copy the current text into history,
	 * unless the last copy is less than 10 minutes old (autosave runs every few seconds).
	 *
	 * @param int $note_id Note id.
	 */
	public static function snapshot_if_due( int $note_id ): void {
		$latest = null;
		foreach ( wp_get_post_revisions( $note_id, array( 'posts_per_page' => 5 ) ) as $revision ) {
			if ( ! wp_is_post_autosave( $revision ) ) {
				$latest = $revision;
				break;
			}
		}
		if ( $latest && time() - (int) get_post_time( 'U', true, $latest ) < self::HISTORY_GAP ) {
			return;
		}
		self::snapshot( $note_id );
	}

	/**
	 * Copy the current text into history now (skipped if identical to the last copy).
	 *
	 * @param int $note_id Note id.
	 */
	public static function snapshot( int $note_id ): void {
		wp_save_post_revision( $note_id );
	}

	/**
	 * Saved from the backup wp-admin screen: count it as a new version.
	 * (Saves from the app set the version themselves.)
	 *
	 * @param int      $post_id Note id.
	 * @param \WP_Post $post    Note.
	 */
	public static function admin_screen_save( $post_id, $post ): void {
		if ( Api::is_saving() || wp_is_post_revision( $post_id ) || 'auto-draft' === $post->post_status ) {
			return;
		}
		if ( 'publish' === $post->post_status || 'draft' === $post->post_status || 'pending' === $post->post_status || 'future' === $post->post_status ) {
			// Notes are always private.
			remove_action( 'save_post_' . self::POST_TYPE, array( __CLASS__, 'admin_screen_save' ), 10 );
			wp_update_post(
				array(
					'ID'          => $post_id,
					'post_status' => 'private',
				)
			);
			add_action( 'save_post_' . self::POST_TYPE, array( __CLASS__, 'admin_screen_save' ), 10, 2 );
		}
		update_post_meta( $post_id, 'cp_version', max( 1, (int) get_post_meta( $post_id, 'cp_version', true ) ) + 1 );
		if ( ! self::folder_of( $post_id ) && self::inbox_id() ) {
			wp_set_object_terms( $post_id, array( self::inbox_id() ), self::FOLDER );
		}
	}

	/**
	 * Deleting a note for good also deletes its images.
	 *
	 * @param int           $post_id Post id.
	 * @param \WP_Post|null $post    Post.
	 */
	public static function before_delete( $post_id, $post = null ): void {
		$post = $post instanceof \WP_Post ? $post : get_post( $post_id );
		if ( $post instanceof \WP_Post && self::POST_TYPE === $post->post_type ) {
			Files::delete_all_for( (int) $post_id );
		}
	}
}
