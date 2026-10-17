<?php
/**
 * Articles: the workspace that turns a note into an article.
 *
 * An article is a private post of type cp_article, linked to its note (meta cp_note_id)
 * and to a website folder (meta cp_site, 0 = no website). All step data lives as JSON in
 * post_content:
 *
 *   { "v": 1, "fields": { "<field>": { "value": …, "rev": 3, "at": "…", "snap": 1700000000,
 *                                     "versions": [ { "value": …, "at": "…", "why": "…" } ] } } }
 *
 * Fields: title, cleanup, outline_text, outline (sections), approved, section:<id>, polish,
 * seo, ready, published. Every field has its own revision number, so two devices editing
 * different steps never clash, and a stale save of the same step is kept as an earlier
 * version instead of overwriting (see save_field()).
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Article storage.
 */
final class Articles {

	public const POST_TYPE = 'cp_article';

	/**
	 * Earlier versions kept per field.
	 */
	public const VERSIONS_KEEP = 10;

	/**
	 * While typing, at most one earlier version per field in this many seconds.
	 */
	public const VERSION_GAP = 600;

	/**
	 * Largest text per field (characters).
	 */
	public const TEXT_MAX = 300000;

	/**
	 * Stages, in order. The note's status follows the article (forward only).
	 */
	public const STAGES = array( 'idea', 'outline_ready', 'draft_ready', 'ready', 'published' );

	/**
	 * Hook everything up.
	 */
	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'register' ), 5 );
		add_filter( 'wp_untrash_post_status', array( __CLASS__, 'untrash_status' ), 10, 2 );
	}

	/**
	 * Register the private post type (same permissions as notes: administrators only).
	 */
	public static function register(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'          => __( 'Articles', 'content-pipeline' ),
					'singular_name' => __( 'Article', 'content-pipeline' ),
				),
				'public'              => false,
				'publicly_queryable'  => false,
				'exclude_from_search' => true,
				'show_ui'             => false,
				'show_in_rest'        => false,
				'has_archive'         => false,
				'rewrite'             => false,
				'query_var'           => false,
				'can_export'          => true,
				'delete_with_user'    => false,
				'supports'            => array( 'title' ),
				'capability_type'     => array( 'cp_note', 'cp_notes' ),
				'map_meta_cap'        => true,
			)
		);
	}

	/**
	 * Restored articles come back private.
	 *
	 * @param string $new_status Status WordPress picked.
	 * @param int    $post_id    Post id.
	 * @return string
	 */
	public static function untrash_status( $new_status, $post_id ) {
		return self::POST_TYPE === get_post_type( $post_id ) ? 'private' : $new_status;
	}

	/**
	 * Get an article (private or trashed) or null.
	 *
	 * @param int $id Article id.
	 */
	public static function get( int $id ): ?\WP_Post {
		$post = get_post( $id );
		if ( $post instanceof \WP_Post && self::POST_TYPE === $post->post_type && in_array( $post->post_status, array( 'private', 'trash' ), true ) ) {
			return $post;
		}
		return null;
	}

	/**
	 * Read an article fresh from the database (e.g. right after taking its lock).
	 *
	 * @param int $id Article id.
	 */
	public static function fresh( int $id ): ?\WP_Post {
		clean_post_cache( $id );
		wp_cache_delete( $id, 'post_meta' );
		return self::get( $id );
	}

	/**
	 * Find an article by the id the app gave it (makes "create" safe to retry).
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
	 * Create an article for a note.
	 *
	 * @param int    $note_id   Note id.
	 * @param int    $site      Website folder id (0 = none).
	 * @param string $client_id App id.
	 * @return \WP_Post|\WP_Error
	 */
	public static function create( int $note_id, int $site, string $client_id ) {
		$note  = Notes::get( $note_id );
		$title = $note ? $note->post_title : '';

		$data = array(
			'v'      => 1,
			'fields' => array(
				'title' => self::new_field( $title ),
			),
		);

		$id = wp_insert_post(
			wp_slash(
				array(
					'post_type'    => self::POST_TYPE,
					'post_status'  => 'private',
					'post_title'   => $title,
					'post_content' => self::encode( $data ),
				)
			),
			true
		);
		if ( is_wp_error( $id ) ) {
			return $id;
		}
		update_post_meta( $id, 'cp_note_id', $note_id );
		update_post_meta( $id, 'cp_site', $site );
		update_post_meta( $id, 'cp_stage', 'idea' );
		if ( '' !== $client_id ) {
			update_post_meta( $id, 'cp_client_id', $client_id );
		}
		return get_post( $id );
	}

	/**
	 * A field as stored when it is first set.
	 *
	 * @param mixed $value Value.
	 * @return array<string, mixed>
	 */
	private static function new_field( $value ): array {
		return array(
			'value'    => $value,
			'rev'      => 1,
			'at'       => gmdate( 'c' ),
			'snap'     => 0,
			'versions' => array(),
		);
	}

	/**
	 * Decode the step data.
	 *
	 * @param \WP_Post $post Article.
	 * @return array<string, mixed>
	 */
	public static function data( \WP_Post $post ): array {
		$data = json_decode( $post->post_content, true );
		if ( ! is_array( $data ) || ! isset( $data['fields'] ) || ! is_array( $data['fields'] ) ) {
			$data = array(
				'v'      => 1,
				'fields' => array(),
			);
		}
		return $data;
	}

	/**
	 * Encode step data for storage.
	 *
	 * @param array $data Step data.
	 */
	private static function encode( array $data ): string {
		return (string) wp_json_encode( $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
	}

	/**
	 * Current value of a field.
	 *
	 * @param array  $data  Step data.
	 * @param string $field Field name.
	 * @return mixed
	 */
	private static function value( array $data, string $field ) {
		return $data['fields'][ $field ]['value'] ?? null;
	}

	/**
	 * Stage reached by an article.
	 *
	 * @param array $data Step data.
	 */
	public static function stage( array $data ): string {
		if ( self::value( $data, 'published' ) ) {
			return 'published';
		}
		if ( self::value( $data, 'ready' ) ) {
			return 'ready';
		}
		$approved = self::value( $data, 'approved' );
		if ( ! is_array( $approved ) || empty( $approved['ids'] ) ) {
			return 'idea';
		}
		foreach ( $approved['ids'] as $sid ) {
			$text = self::value( $data, 'section:' . $sid );
			if ( ! is_string( $text ) || '' === trim( $text ) ) {
				return 'outline_ready';
			}
		}
		return 'draft_ready';
	}

	/**
	 * Clean a field value. Returns WP_Error for unknown fields or bad values.
	 *
	 * @param string $field Field name.
	 * @param mixed  $value Raw value.
	 * @param array  $data  Current step data (for checks that need the outline).
	 * @return mixed|\WP_Error
	 */
	public static function clean_field( string $field, $value, array $data ) {
		switch ( $field ) {
			case 'title':
				return Notes::clean_title( $value );

			case 'cleanup':
			case 'outline_text':
			case 'polish':
				return mb_substr( Notes::clean_text( $value ), 0, self::TEXT_MAX );

			case 'outline':
				$sections = array();
				$seen     = array();
				foreach ( array_slice( is_array( $value ) ? $value : array(), 0, 40 ) as $section ) {
					if ( ! is_array( $section ) ) {
						continue;
					}
					$sid = (string) ( $section['id'] ?? '' );
					if ( ! preg_match( '/^[a-z0-9]{4,16}$/', $sid ) || isset( $seen[ $sid ] ) ) {
						return new \WP_Error( 'cp_bad_value', __( 'The outline has an invalid section id.', 'content-pipeline' ), array( 'status' => 400 ) );
					}
					$seen[ $sid ] = true;
					$sections[]   = array(
						'id'      => $sid,
						'heading' => mb_substr( Notes::clean_title( $section['heading'] ?? '' ), 0, 300 ),
						'brief'   => mb_substr( str_replace( "\n", ' ', Notes::clean_text( $section['brief'] ?? '' ) ), 0, 2000 ),
						'words'   => max( 0, min( 5000, (int) ( $section['words'] ?? 0 ) ) ),
					);
				}
				return $sections;

			case 'approved':
				if ( ! $value ) {
					return null;
				}
				// Approving freezes the current outline's section ids.
				$outline = self::value( $data, 'outline' );
				$ids     = array();
				foreach ( is_array( $outline ) ? $outline : array() as $section ) {
					$ids[] = $section['id'];
				}
				if ( ! $ids ) {
					return new \WP_Error( 'cp_bad_value', __( 'The outline is empty, so it cannot be approved.', 'content-pipeline' ), array( 'status' => 400 ) );
				}
				return array(
					'at'  => gmdate( 'c' ),
					'ids' => $ids,
				);

			case 'seo':
				$value = is_array( $value ) ? $value : array();
				return array(
					'title'       => mb_substr( Notes::clean_title( $value['title'] ?? '' ), 0, 200 ),
					'description' => mb_substr( Notes::clean_title( $value['description'] ?? '' ), 0, 400 ),
					'slug'        => mb_substr( sanitize_title( (string) ( $value['slug'] ?? '' ) ), 0, 120 ),
					'keyword'     => mb_substr( Notes::clean_title( $value['keyword'] ?? '' ), 0, 120 ),
					'excerpt'     => mb_substr( Notes::clean_text( $value['excerpt'] ?? '' ), 0, 1000 ),
				);

			case 'ready':
			case 'published':
				return (bool) $value;
		}

		if ( preg_match( '/^section:([a-z0-9]{4,16})$/', $field ) ) {
			return mb_substr( Notes::clean_text( $value ), 0, self::TEXT_MAX );
		}

		return new \WP_Error( 'cp_bad_field', __( 'Unknown article field.', 'content-pipeline' ), array( 'status' => 400 ) );
	}

	/**
	 * Save one field. Call only while holding the article's lock (see Api).
	 *
	 * - $base_rev must be the field's revision the change was made on. If the field changed
	 *   elsewhere since, nothing is overwritten: the incoming value is kept as an earlier
	 *   version marked "from another device" and $result['conflict'] is true.
	 * - The previous value goes into the field's versions when $snapshot is true (a pasted
	 *   result, a restored version) or the last version is older than VERSION_GAP.
	 *
	 * @param \WP_Post $post     Article (fresh).
	 * @param string   $field    Field name.
	 * @param mixed    $value    Cleaned value.
	 * @param int      $base_rev Field revision the change was made on (0 = new field).
	 * @param bool     $snapshot Keep the previous value as an earlier version.
	 * @return array{conflict: bool}|\WP_Error
	 */
	public static function save_field( \WP_Post $post, string $field, $value, int $base_rev, bool $snapshot ) {
		$data    = self::data( $post );
		$current = $data['fields'][ $field ] ?? null;
		$cur_rev = $current ? (int) $current['rev'] : 0;

		if ( $current && $base_rev !== $cur_rev ) {
			if ( $value !== $current['value'] && ! self::is_empty( $value ) ) {
				self::push_version( $data['fields'][ $field ], $value, 'conflict' );
				self::write( $post, $data );
			}
			return array( 'conflict' => true );
		}

		if ( ! $current ) {
			$data['fields'][ $field ] = self::new_field( $value );
		} elseif ( $value !== $current['value'] ) {
			$entry = $current;
			if ( ! self::is_empty( $current['value'] ) && ( $snapshot || time() - (int) $current['snap'] >= self::VERSION_GAP ) ) {
				self::push_version( $entry, $current['value'], $snapshot ? 'replaced' : 'autosave' );
				$entry['snap'] = time();
			}
			$entry['value']           = $value;
			$entry['rev']             = $cur_rev + 1;
			$entry['at']              = gmdate( 'c' );
			$data['fields'][ $field ] = $entry;
		} else {
			return array( 'conflict' => false );
		}

		self::write( $post, $data );
		return array( 'conflict' => false );
	}

	/**
	 * Add an earlier version to a field (newest first, at most VERSIONS_KEEP).
	 *
	 * @param array  $entry Field entry (changed in place).
	 * @param mixed  $value Value to keep.
	 * @param string $why   'autosave', 'replaced' or 'conflict'.
	 */
	private static function push_version( array &$entry, $value, string $why ): void {
		$versions = isset( $entry['versions'] ) && is_array( $entry['versions'] ) ? $entry['versions'] : array();
		array_unshift(
			$versions,
			array(
				'value' => $value,
				'at'    => gmdate( 'c' ),
				'why'   => $why,
			)
		);
		$entry['versions'] = array_slice( $versions, 0, self::VERSIONS_KEEP );
	}

	/**
	 * Empty string, empty array or null.
	 *
	 * @param mixed $value Value.
	 */
	private static function is_empty( $value ): bool {
		return null === $value || '' === $value || array() === $value || ( is_string( $value ) && '' === trim( $value ) );
	}

	/**
	 * Store step data, title, stage, and move the note's status forward.
	 *
	 * @param \WP_Post $post Article.
	 * @param array    $data Step data.
	 */
	private static function write( \WP_Post $post, array $data ): void {
		$title = (string) ( self::value( $data, 'title' ) ?? '' );
		Api::save_quietly(
			array(
				'ID'           => $post->ID,
				'post_title'   => $title,
				'post_content' => self::encode( $data ),
			)
		);
		$stage = self::stage( $data );
		update_post_meta( $post->ID, 'cp_stage', $stage );

		$note_id = (int) get_post_meta( $post->ID, 'cp_note_id', true );
		$note    = $note_id ? Notes::get( $note_id ) : null;
		if ( $note && 'private' === $note->post_status ) {
			$now = array_search( (string) get_post_meta( $note_id, 'cp_status', true ), self::STAGES, true );
			$new = array_search( $stage, self::STAGES, true );
			if ( false !== $new && ( false === $now || $new > $now ) ) {
				update_post_meta( $note_id, 'cp_status', $stage );
			}
		}
	}

	/**
	 * Change the website of an article.
	 *
	 * @param int $id   Article id.
	 * @param int $site Website folder id (0 = none).
	 */
	public static function set_site( int $id, int $site ): void {
		update_post_meta( $id, 'cp_site', $site );
		Api::save_quietly( array( 'ID' => $id ) );
	}

	/**
	 * Short summary for lists.
	 *
	 * @param \WP_Post $post Article.
	 * @return array<string, mixed>
	 */
	public static function summary( \WP_Post $post ): array {
		$stage = (string) get_post_meta( $post->ID, 'cp_stage', true );
		return array(
			'id'       => (int) $post->ID,
			'note'     => (int) get_post_meta( $post->ID, 'cp_note_id', true ),
			'site'     => (int) get_post_meta( $post->ID, 'cp_site', true ),
			'title'    => $post->post_title,
			'stage'    => in_array( $stage, self::STAGES, true ) ? $stage : 'idea',
			'created'  => get_post_time( 'c', true, $post ),
			'modified' => get_post_modified_time( 'c', true, $post ),
			'trashed'  => 'trash' === $post->post_status,
		);
	}

	/**
	 * Everything the workspace needs.
	 *
	 * @param \WP_Post $post Article.
	 * @return array<string, mixed>
	 */
	public static function full( \WP_Post $post ): array {
		$data    = self::data( $post );
		$note_id = (int) get_post_meta( $post->ID, 'cp_note_id', true );
		$note    = $note_id ? Notes::get( $note_id ) : null;

		$fields = array();
		foreach ( $data['fields'] as $name => $entry ) {
			$fields[ $name ] = array(
				'value'    => $entry['value'] ?? null,
				'rev'      => (int) ( $entry['rev'] ?? 0 ),
				'at'       => $entry['at'] ?? null,
				'versions' => array_values( (array) ( $entry['versions'] ?? array() ) ),
			);
		}

		return array_merge(
			self::summary( $post ),
			array(
				'fields'    => (object) $fields,
				'note_text' => $note ? Notes::to_array( $note ) : null,
			)
		);
	}

	/**
	 * Summaries of all articles with a status.
	 *
	 * @param string $status 'private' or 'trash'.
	 * @return array<int, array<string, mixed>>
	 */
	public static function all( string $status = 'private' ): array {
		$posts = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => $status,
				'posts_per_page' => -1,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'no_found_rows'  => true,
			)
		);
		return array_map( array( __CLASS__, 'summary' ), $posts );
	}
}
