<?php
/**
 * REST API for the notes app (namespace cp/v1). Every route needs the hub permission.
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Notes app API.
 */
final class Api {

	public const NS = 'cp/v1';

	/**
	 * True while the app is saving (so the wp-admin save hook stays out of the way).
	 *
	 * @var bool
	 */
	private static $saving = false;

	/**
	 * Whether the HTML filter was active before begin_save().
	 *
	 * @var bool
	 */
	private static $kses = false;

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
		add_filter( 'wp_untrash_post_status', array( __CLASS__, 'untrash_status' ), 10, 3 );
	}

	/**
	 * Is the app saving right now?
	 */
	public static function is_saving(): bool {
		return self::$saving;
	}

	/**
	 * Restored notes come back as private notes (WordPress would make them drafts).
	 *
	 * @param string $new_status      Status WordPress picked.
	 * @param int    $post_id         Post id.
	 * @param string $previous_status Status before trashing.
	 * @return string
	 */
	public static function untrash_status( $new_status, $post_id, $previous_status ) {
		unset( $previous_status );
		return Notes::POST_TYPE === get_post_type( $post_id ) ? 'private' : $new_status;
	}

	/**
	 * Register routes.
	 */
	public static function routes(): void {
		$can = array( Plugin::class, 'current_user_can_use' );
		$id  = '(?P<id>\d+)';

		$routes = array(
			array( '/state', 'GET', 'get_state' ),
			array( '/notes', 'POST', 'create_note' ),
			array( '/notes/' . $id, 'POST', 'update_note' ),
			array( '/notes/' . $id, 'DELETE', 'delete_note' ),
			array( '/notes/' . $id . '/restore', 'POST', 'restore_note' ),
			array( '/notes/' . $id . '/history', 'GET', 'get_history' ),
			array( '/notes/' . $id . '/history/(?P<rev>\d+)/restore', 'POST', 'restore_version' ),
			array( '/notes/' . $id . '/files', 'POST', 'add_file' ),
			array( '/notes/' . $id . '/files/(?P<file>[a-f0-9]{32})', 'DELETE', 'remove_file' ),
			array( '/trash', 'GET', 'get_trash' ),
			array( '/trash/empty', 'POST', 'empty_trash' ),
			array( '/folders', 'POST', 'create_folder' ),
			array( '/folders/' . $id, 'POST', 'update_folder' ),
			array( '/folders/' . $id, 'DELETE', 'delete_folder' ),
		);

		foreach ( $routes as $route ) {
			register_rest_route(
				self::NS,
				$route[0],
				array(
					'methods'             => $route[1],
					'callback'            => array( __CLASS__, $route[2] ),
					'permission_callback' => $can,
				)
			);
		}
	}

	/**
	 * Everything the app needs at start: folders and notes.
	 *
	 * @return \WP_REST_Response
	 */
	public static function get_state() {
		return self::no_cache(
			array(
				'folders'  => Notes::folders(),
				'notes'    => Notes::all(),
				'inbox'    => Notes::inbox_id(),
				'statuses' => Notes::statuses(),
				'time'     => gmdate( 'c' ),
			)
		);
	}

	/**
	 * Create a note. Safe to retry: the app sends its own id (client_id).
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function create_note( \WP_REST_Request $request ) {
		$client_id = (string) $request->get_param( 'client_id' );
		if ( '' !== $client_id && ! preg_match( '/^[A-Za-z0-9_-]{8,64}$/', $client_id ) ) {
			return new \WP_Error( 'cp_client_id', __( 'Invalid note id from the app.', 'content-pipeline' ), array( 'status' => 400 ) );
		}

		$existing = Notes::find_by_client_id( $client_id );
		if ( $existing ) {
			return self::no_cache(
				array(
					'note'    => Notes::to_array( $existing ),
					'created' => false,
				)
			);
		}

		$folder = self::folder_or_inbox( (int) $request->get_param( 'folder' ) );

		self::begin_save();
		$note_id = wp_insert_post(
			wp_slash(
				array(
					'post_type'    => Notes::POST_TYPE,
					'post_status'  => 'private',
					'post_title'   => Notes::clean_title( $request->get_param( 'title' ) ),
					'post_content' => Notes::clean_text( $request->get_param( 'body' ) ),
					'post_excerpt' => self::checklist_json( $request->get_param( 'checklist' ) ),
				)
			),
			true
		);
		self::end_save();

		if ( is_wp_error( $note_id ) ) {
			return new \WP_Error( 'cp_note_create', $note_id->get_error_message(), array( 'status' => 500 ) );
		}

		update_post_meta( $note_id, 'cp_version', 1 );
		if ( '' !== $client_id ) {
			update_post_meta( $note_id, 'cp_client_id', $client_id );
		}
		update_post_meta( $note_id, 'cp_status', self::status_or_default( $request->get_param( 'status' ) ) );
		if ( $request->get_param( 'pinned' ) ) {
			update_post_meta( $note_id, 'cp_pinned', 1 );
		}
		if ( $folder ) {
			wp_set_object_terms( $note_id, array( $folder ), Notes::FOLDER );
		}

		$response = self::no_cache(
			array(
				'note'    => Notes::to_array( get_post( $note_id ) ),
				'created' => true,
			)
		);
		$response->set_status( 201 );
		return $response;
	}

	/**
	 * Update a note.
	 *
	 * Text changes (title, body, checklist) must say which version they were made on
	 * (base_version). If the note changed elsewhere in the meantime, nothing is overwritten:
	 * the incoming text is saved as a separate "conflict copy" note.
	 * Pin, status and folder changes always apply.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function update_note( \WP_REST_Request $request ) {
		$post = Notes::get( (int) $request['id'] );
		if ( ! $post ) {
			return self::missing();
		}
		if ( 'trash' === $post->post_status ) {
			return new \WP_Error( 'cp_note_trashed', __( 'This note is in the trash. Restore it first.', 'content-pipeline' ), array( 'status' => 409 ) );
		}

		$params      = $request->get_json_params();
		$params      = is_array( $params ) ? $params : $request->get_body_params();
		$has_text    = array_key_exists( 'title', $params ) || array_key_exists( 'body', $params ) || array_key_exists( 'checklist', $params );
		$conflict    = null;
		$current_ver = max( 1, (int) get_post_meta( $post->ID, 'cp_version', true ) );

		if ( $has_text ) {
			$title     = array_key_exists( 'title', $params ) ? Notes::clean_title( $params['title'] ) : $post->post_title;
			$body      = array_key_exists( 'body', $params ) ? Notes::clean_text( $params['body'] ) : $post->post_content;
			$checklist = array_key_exists( 'checklist', $params ) ? self::checklist_json( $params['checklist'] ) : $post->post_excerpt;
			$changed   = $title !== $post->post_title || $body !== $post->post_content || $checklist !== $post->post_excerpt;

			if ( ! isset( $params['base_version'] ) ) {
				return new \WP_Error( 'cp_base_version', __( 'Missing base_version.', 'content-pipeline' ), array( 'status' => 400 ) );
			}

			if ( $changed && (int) $params['base_version'] !== $current_ver ) {
				$conflict = self::conflict_copy( $post, $title, $body, $checklist );
			} elseif ( $changed ) {
				self::begin_save();
				$result = wp_update_post(
					wp_slash(
						array(
							'ID'           => $post->ID,
							'post_title'   => $title,
							'post_content' => $body,
							'post_excerpt' => $checklist,
						)
					),
					true
				);
				self::end_save();
				if ( is_wp_error( $result ) ) {
					return new \WP_Error( 'cp_note_update', $result->get_error_message(), array( 'status' => 500 ) );
				}
				update_post_meta( $post->ID, 'cp_version', $current_ver + 1 );
			}
		}

		$touched = false;
		if ( array_key_exists( 'pinned', $params ) ) {
			if ( $params['pinned'] ) {
				update_post_meta( $post->ID, 'cp_pinned', 1 );
			} else {
				delete_post_meta( $post->ID, 'cp_pinned' );
			}
		}
		if ( array_key_exists( 'status', $params ) ) {
			update_post_meta( $post->ID, 'cp_status', self::status_or_default( $params['status'] ) );
			$touched = true;
		}
		if ( array_key_exists( 'folder', $params ) ) {
			$folder = (int) $params['folder'];
			if ( ! $folder || ! term_exists( $folder, Notes::FOLDER ) ) {
				return new \WP_Error( 'cp_folder_missing', __( 'That folder no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
			}
			wp_set_object_terms( $post->ID, array( $folder ), Notes::FOLDER );
			$touched = true;
		}
		if ( $touched && ! $has_text ) {
			self::touch( $post->ID );
		}

		clean_post_cache( $post->ID );
		$data = array( 'note' => Notes::to_array( get_post( $post->ID ) ) );
		if ( $conflict ) {
			$data['conflict'] = true;
			$data['copy']     = Notes::to_array( $conflict );
		}
		return self::no_cache( $data );
	}

	/**
	 * Move to trash, or delete for good when it is already in the trash and force=1.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function delete_note( \WP_REST_Request $request ) {
		$post = Notes::get( (int) $request['id'] );
		if ( ! $post ) {
			return self::missing();
		}
		if ( 'trash' === $post->post_status ) {
			if ( ! $request->get_param( 'force' ) ) {
				return new \WP_Error( 'cp_note_trashed', __( 'This note is already in the trash.', 'content-pipeline' ), array( 'status' => 409 ) );
			}
			wp_delete_post( $post->ID, true );
			return self::no_cache(
				array(
					'deleted' => true,
					'id'      => $post->ID,
				)
			);
		}
		wp_trash_post( $post->ID );
		return self::no_cache( array( 'note' => Notes::to_array( get_post( $post->ID ) ) ) );
	}

	/**
	 * Restore from the trash (into its folder, or the Inbox if that folder is gone).
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function restore_note( \WP_REST_Request $request ) {
		$post = Notes::get( (int) $request['id'] );
		if ( ! $post ) {
			return self::missing();
		}
		if ( 'trash' === $post->post_status ) {
			wp_untrash_post( $post->ID );
		}
		$folder = Notes::folder_of( $post->ID );
		if ( ! $folder || ! term_exists( $folder, Notes::FOLDER ) ) {
			wp_set_object_terms( $post->ID, array( Notes::inbox_id() ), Notes::FOLDER );
		}
		clean_post_cache( $post->ID );
		return self::no_cache( array( 'note' => Notes::to_array( get_post( $post->ID ) ) ) );
	}

	/**
	 * Notes in the trash, newest first, with the day they will be deleted.
	 *
	 * @return \WP_REST_Response
	 */
	public static function get_trash() {
		$notes = Notes::all( 'trash' );
		$days  = defined( 'EMPTY_TRASH_DAYS' ) ? (int) EMPTY_TRASH_DAYS : 30;
		foreach ( $notes as &$note ) {
			$trashed_at          = (int) get_post_meta( $note['id'], '_wp_trash_meta_time', true );
			$note['trashed_at']  = $trashed_at ? gmdate( 'c', $trashed_at ) : null;
			$note['deletes_at']  = $trashed_at ? gmdate( 'c', $trashed_at + $days * DAY_IN_SECONDS ) : null;
			$note['folder_path'] = self::folder_path( (int) $note['folder'] );
		}
		unset( $note );
		usort(
			$notes,
			static function ( $a, $b ) {
				return strcmp( (string) $b['trashed_at'], (string) $a['trashed_at'] );
			}
		);
		return self::no_cache(
			array(
				'notes' => $notes,
				'days'  => $days,
			)
		);
	}

	/**
	 * Delete everything in the trash for good.
	 *
	 * @return \WP_REST_Response
	 */
	public static function empty_trash() {
		$ids = get_posts(
			array(
				'post_type'      => Notes::POST_TYPE,
				'post_status'    => 'trash',
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);
		foreach ( $ids as $note_id ) {
			wp_delete_post( $note_id, true );
		}
		return self::no_cache( array( 'deleted' => count( $ids ) ) );
	}

	/**
	 * Earlier versions of a note (at most one per 10 minutes, newest first).
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function get_history( \WP_REST_Request $request ) {
		$post = Notes::get( (int) $request['id'] );
		if ( ! $post ) {
			return self::missing();
		}
		$versions = array();
		foreach ( wp_get_post_revisions( $post->ID, array( 'check_enabled' => false ) ) as $revision ) {
			if ( wp_is_post_autosave( $revision ) ) {
				continue;
			}
			$items      = json_decode( $revision->post_excerpt, true );
			$versions[] = array(
				'id'        => (int) $revision->ID,
				'date'      => get_post_time( 'c', true, $revision ),
				'title'     => $revision->post_title,
				'body'      => $revision->post_content,
				'checklist' => Notes::clean_checklist( is_array( $items ) ? $items : array() ),
			);
		}
		return self::no_cache( array( 'versions' => $versions ) );
	}

	/**
	 * Bring back an earlier version. The current text is saved to history first.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function restore_version( \WP_REST_Request $request ) {
		$post     = Notes::get( (int) $request['id'] );
		$revision = wp_get_post_revision( (int) $request['rev'] );
		if ( ! $post || ! $revision || (int) $revision->post_parent !== $post->ID ) {
			return self::missing();
		}
		if ( 'trash' === $post->post_status ) {
			return new \WP_Error( 'cp_note_trashed', __( 'This note is in the trash. Restore it first.', 'content-pipeline' ), array( 'status' => 409 ) );
		}

		Notes::snapshot( $post->ID );

		self::begin_save();
		wp_update_post(
			wp_slash(
				array(
					'ID'           => $post->ID,
					'post_title'   => $revision->post_title,
					'post_content' => $revision->post_content,
					'post_excerpt' => $revision->post_excerpt,
				)
			)
		);
		self::end_save();
		update_post_meta( $post->ID, 'cp_version', max( 1, (int) get_post_meta( $post->ID, 'cp_version', true ) ) + 1 );

		clean_post_cache( $post->ID );
		return self::no_cache( array( 'note' => Notes::to_array( get_post( $post->ID ) ) ) );
	}

	/**
	 * Attach an image (field name "file").
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function add_file( \WP_REST_Request $request ) {
		$post = Notes::get( (int) $request['id'] );
		if ( ! $post || 'trash' === $post->post_status ) {
			return self::missing();
		}
		$files = $request->get_file_params();
		if ( empty( $files['file'] ) || ! is_array( $files['file'] ) ) {
			return new \WP_Error( 'cp_file_upload', __( 'No image was sent.', 'content-pipeline' ), array( 'status' => 400 ) );
		}
		$entry = Files::add( $post->ID, $files['file'] );
		if ( is_wp_error( $entry ) ) {
			return $entry;
		}
		self::touch( $post->ID );
		$response = self::no_cache(
			array(
				'file' => $entry,
				'note' => Notes::to_array( get_post( $post->ID ) ),
			)
		);
		$response->set_status( 201 );
		return $response;
	}

	/**
	 * Remove an image.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function remove_file( \WP_REST_Request $request ) {
		$post = Notes::get( (int) $request['id'] );
		if ( ! $post ) {
			return self::missing();
		}
		if ( ! Files::remove( $post->ID, (string) $request['file'] ) ) {
			return new \WP_Error( 'cp_file_missing', __( 'That image is already gone.', 'content-pipeline' ), array( 'status' => 404 ) );
		}
		self::touch( $post->ID );
		return self::no_cache( array( 'note' => Notes::to_array( get_post( $post->ID ) ) ) );
	}

	/**
	 * Create a folder.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function create_folder( \WP_REST_Request $request ) {
		$id = Notes::create_folder( (string) $request->get_param( 'name' ), (int) $request->get_param( 'parent' ) );
		if ( is_wp_error( $id ) ) {
			return $id;
		}
		$response = self::no_cache(
			array(
				'id'      => $id,
				'folders' => Notes::folders(),
			)
		);
		$response->set_status( 201 );
		return $response;
	}

	/**
	 * Rename, move or flag a folder.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function update_folder( \WP_REST_Request $request ) {
		$params  = $request->get_json_params();
		$params  = is_array( $params ) ? $params : $request->get_body_params();
		$changes = array_intersect_key( $params, array_flip( array( 'name', 'parent', 'is_site' ) ) );
		$result  = Notes::update_folder( (int) $request['id'], $changes );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return self::no_cache( array( 'folders' => Notes::folders() ) );
	}

	/**
	 * Delete a folder, its subfolders, and move their notes to the trash.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function delete_folder( \WP_REST_Request $request ) {
		$result = Notes::delete_folder( (int) $request['id'] );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return self::no_cache(
			array(
				'trashed' => $result['trashed'],
				'folders' => Notes::folders(),
				'notes'   => Notes::all(),
			)
		);
	}

	/**
	 * Save the incoming text as a new note next to the original.
	 *
	 * @param \WP_Post $post      Original note.
	 * @param string   $title     Incoming title.
	 * @param string   $body      Incoming text.
	 * @param string   $checklist Incoming checklist JSON.
	 * @return \WP_Post|null
	 */
	private static function conflict_copy( \WP_Post $post, string $title, string $body, string $checklist ): ?\WP_Post {
		/* translators: %s: note title. */
		$copy_title = sprintf( __( '%s (conflict copy)', 'content-pipeline' ), '' !== $title ? $title : __( 'Untitled', 'content-pipeline' ) );

		self::begin_save();
		$copy_id = wp_insert_post(
			wp_slash(
				array(
					'post_type'    => Notes::POST_TYPE,
					'post_status'  => 'private',
					'post_title'   => mb_substr( $copy_title, 0, 300 ),
					'post_content' => $body,
					'post_excerpt' => $checklist,
				)
			),
			true
		);
		self::end_save();

		if ( is_wp_error( $copy_id ) ) {
			return null;
		}
		update_post_meta( $copy_id, 'cp_version', 1 );
		update_post_meta( $copy_id, 'cp_status', (string) get_post_meta( $post->ID, 'cp_status', true ) ? (string) get_post_meta( $post->ID, 'cp_status', true ) : 'idea' );
		$folder = Notes::folder_of( $post->ID );
		wp_set_object_terms( $copy_id, array( $folder ? $folder : Notes::inbox_id() ), Notes::FOLDER );
		return get_post( $copy_id );
	}

	/**
	 * Start an app save. Notes are plain text and always shown escaped, so they are
	 * stored exactly as typed: the HTML filter (kses) is paused, which matters on sites
	 * where even administrators are filtered (DISALLOW_UNFILTERED_HTML).
	 */
	private static function begin_save(): void {
		self::$saving = true;
		self::$kses   = (bool) has_filter( 'content_save_pre', 'wp_filter_post_kses' );
		if ( self::$kses ) {
			kses_remove_filters();
		}
	}

	/**
	 * End an app save.
	 */
	private static function end_save(): void {
		if ( self::$kses ) {
			kses_init_filters();
		}
		self::$kses   = false;
		self::$saving = false;
	}

	/**
	 * Mark a note as modified now (pin changes do not count).
	 *
	 * @param int $note_id Note id.
	 */
	private static function touch( int $note_id ): void {
		self::begin_save();
		remove_action( 'post_updated', 'wp_save_post_revision', 10 );
		wp_update_post( array( 'ID' => $note_id ) );
		add_action( 'post_updated', 'wp_save_post_revision', 10, 1 );
		self::end_save();
	}

	/**
	 * Folder path like "Madhu Infotech › Interview tips".
	 *
	 * @param int $folder Folder id.
	 */
	private static function folder_path( int $folder ): string {
		if ( ! $folder || ! term_exists( $folder, Notes::FOLDER ) ) {
			return '';
		}
		$ids   = array_reverse( get_ancestors( $folder, Notes::FOLDER, 'taxonomy' ) );
		$ids[] = $folder;
		$names = array();
		foreach ( $ids as $id ) {
			$term = get_term( $id, Notes::FOLDER );
			if ( $term instanceof \WP_Term ) {
				$names[] = html_entity_decode( $term->name, ENT_QUOTES, 'UTF-8' );
			}
		}
		return implode( ' › ', $names );
	}

	/**
	 * A folder that exists, or the Inbox.
	 *
	 * @param int $folder Folder id.
	 */
	private static function folder_or_inbox( int $folder ): int {
		return ( $folder && term_exists( $folder, Notes::FOLDER ) ) ? $folder : Notes::inbox_id();
	}

	/**
	 * A known status, or "idea".
	 *
	 * @param mixed $status Raw status.
	 */
	private static function status_or_default( $status ): string {
		$status = is_string( $status ) ? $status : '';
		return isset( Notes::statuses()[ $status ] ) ? $status : 'idea';
	}

	/**
	 * Checklist as stored JSON ('' when empty).
	 *
	 * @param mixed $items Raw checklist.
	 */
	private static function checklist_json( $items ): string {
		$items = Notes::clean_checklist( $items );
		return $items ? (string) wp_json_encode( $items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) : '';
	}

	/**
	 * "Note not found" error.
	 *
	 * @return \WP_Error
	 */
	private static function missing() {
		return new \WP_Error( 'cp_note_missing', __( 'That note no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
	}

	/**
	 * JSON response that no cache may keep.
	 *
	 * @param array $data Data.
	 * @return \WP_REST_Response
	 */
	private static function no_cache( array $data ) {
		$response = new \WP_REST_Response( $data );
		$response->header( 'Cache-Control', 'no-store, private' );
		return $response;
	}
}
