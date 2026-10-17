<?php
/**
 * REST API for articles and website settings (routes are registered in Api::routes()).
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Article and settings endpoints.
 */
final class Article_Api {

	/**
	 * Create an article for a note. Safe to retry (client_id).
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function create( \WP_REST_Request $request ) {
		$client_id = (string) $request->get_param( 'client_id' );
		if ( '' !== $client_id && ! preg_match( '/^[A-Za-z0-9_-]{8,64}$/', $client_id ) ) {
			return new \WP_Error( 'cp_client_id', __( 'Invalid id from the app.', 'content-pipeline' ), array( 'status' => 400 ) );
		}
		$existing = Articles::find_by_client_id( $client_id );
		if ( $existing ) {
			return Api::no_cache(
				array(
					'article' => Articles::full( $existing ),
					'created' => false,
				)
			);
		}

		$note_id = (int) $request->get_param( 'note' );
		$note    = $note_id ? Notes::get( $note_id ) : null;
		if ( ! $note || 'trash' === $note->post_status ) {
			return new \WP_Error( 'cp_note_missing', __( 'That note no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
		}
		$site = self::site_or_zero( (int) $request->get_param( 'site' ) );

		$post = Articles::create( $note_id, $site, $client_id );
		if ( is_wp_error( $post ) ) {
			return new \WP_Error( 'cp_article_create', $post->get_error_message(), array( 'status' => 500 ) );
		}
		$response = Api::no_cache(
			array(
				'article' => Articles::full( $post ),
				'created' => true,
			)
		);
		$response->set_status( 201 );
		return $response;
	}

	/**
	 * Read an article with all its steps.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function read( \WP_REST_Request $request ) {
		$post = Articles::get( (int) $request['id'] );
		if ( ! $post ) {
			return self::missing();
		}
		return Api::no_cache( array( 'article' => Articles::full( $post ) ) );
	}

	/**
	 * Save one field: { field, value, base_rev, snapshot } or { site }.
	 *
	 * Runs under the article's lock, so the revision check and the write cannot interleave
	 * with another save (same rule as notes, D25).
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function save( \WP_REST_Request $request ) {
		$id = (int) $request['id'];
		if ( ! Articles::get( $id ) ) {
			return self::missing();
		}
		if ( ! Notes::lock( $id ) ) {
			return new \WP_Error( 'cp_note_busy', __( 'This article is being saved from somewhere else. Trying again shortly.', 'content-pipeline' ), array( 'status' => 503 ) );
		}
		try {
			$post = Articles::fresh( $id );
			if ( ! $post ) {
				return self::missing();
			}
			if ( 'trash' === $post->post_status ) {
				return new \WP_Error( 'cp_article_trashed', __( 'This article is in the trash. Restore it first.', 'content-pipeline' ), array( 'status' => 409 ) );
			}

			$params = $request->get_json_params();
			$params = is_array( $params ) ? $params : $request->get_body_params();

			if ( array_key_exists( 'site', $params ) ) {
				Articles::set_site( $id, self::site_or_zero( (int) $params['site'] ) );
				return Api::no_cache(
					array(
						'article'  => Articles::full( Articles::fresh( $id ) ),
						'conflict' => false,
					)
				);
			}

			$field = (string) ( $params['field'] ?? '' );
			$value = Articles::clean_field( $field, $params['value'] ?? null, Articles::data( $post ) );
			if ( is_wp_error( $value ) ) {
				return $value;
			}
			$result = Articles::save_field( $post, $field, $value, (int) ( $params['base_rev'] ?? 0 ), ! empty( $params['snapshot'] ) );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			return Api::no_cache(
				array(
					'article'  => Articles::full( Articles::fresh( $id ) ),
					'conflict' => $result['conflict'],
				)
			);
		} finally {
			Notes::unlock( $id );
		}
	}

	/**
	 * Move to trash, or delete for good when already trashed and force=1.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function delete( \WP_REST_Request $request ) {
		$post = Articles::get( (int) $request['id'] );
		if ( ! $post ) {
			return self::missing();
		}
		if ( 'trash' === $post->post_status ) {
			if ( ! $request->get_param( 'force' ) ) {
				return new \WP_Error( 'cp_article_trashed', __( 'This article is already in the trash.', 'content-pipeline' ), array( 'status' => 409 ) );
			}
			wp_delete_post( $post->ID, true );
			return Api::no_cache(
				array(
					'deleted' => true,
					'id'      => $post->ID,
				)
			);
		}
		wp_trash_post( $post->ID );
		return Api::no_cache( array( 'article' => Articles::summary( get_post( $post->ID ) ) ) );
	}

	/**
	 * Restore from the trash.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function restore( \WP_REST_Request $request ) {
		$post = Articles::get( (int) $request['id'] );
		if ( ! $post ) {
			return self::missing();
		}
		if ( 'trash' === $post->post_status ) {
			wp_untrash_post( $post->ID );
		}
		return Api::no_cache( array( 'article' => Articles::summary( Articles::fresh( $post->ID ) ) ) );
	}

	/**
	 * Settings of a website folder (0 = defaults), plus the built-in prompts.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function get_settings( \WP_REST_Request $request ) {
		$folder = (int) $request['id'];
		if ( ! Sites::valid( $folder ) ) {
			return new \WP_Error( 'cp_folder_missing', __( 'That folder no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
		}
		return Api::no_cache( self::settings_payload( $folder ) );
	}

	/**
	 * Save settings: { settings: {...}, base_rev }.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function save_settings( \WP_REST_Request $request ) {
		$folder = (int) $request['id'];
		if ( ! Sites::valid( $folder ) ) {
			return new \WP_Error( 'cp_folder_missing', __( 'That folder no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
		}
		$params = $request->get_json_params();
		$params = is_array( $params ) ? $params : array();
		$input  = isset( $params['settings'] ) && is_array( $params['settings'] ) ? $params['settings'] : array();

		$lock = 1000000000 + $folder; // Lock row for settings, never a post id in practice.
		if ( ! Notes::lock( $lock ) ) {
			return new \WP_Error( 'cp_note_busy', __( 'These settings are being saved from somewhere else. Try again.', 'content-pipeline' ), array( 'status' => 503 ) );
		}
		try {
			$saved = Sites::save( $folder, $input, (int) ( $params['base_rev'] ?? -1 ) );
		} finally {
			Notes::unlock( $lock );
		}
		if ( is_wp_error( $saved ) ) {
			return $saved;
		}
		return Api::no_cache( self::settings_payload( $folder ) );
	}

	/**
	 * Settings plus everything the settings screen needs.
	 *
	 * @param int $folder Folder id.
	 * @return array<string, mixed>
	 */
	private static function settings_payload( int $folder ): array {
		$settings            = Sites::get( $folder );
		$settings['prompts'] = (object) $settings['prompts']; // Always a JSON object, also when empty.
		return array(
			'folder'          => $folder,
			'settings'        => $settings,
			'default_prompts' => Prompts::defaults(),
			'steps'           => Prompts::steps(),
			'boxes'           => Prompts::boxes(),
		);
	}

	/**
	 * A folder that exists, or 0.
	 *
	 * @param int $site Folder id.
	 */
	private static function site_or_zero( int $site ): int {
		return ( $site && term_exists( $site, Notes::FOLDER ) ) ? $site : 0;
	}

	/**
	 * "Article not found" error.
	 *
	 * @return \WP_Error
	 */
	private static function missing() {
		return new \WP_Error( 'cp_article_missing', __( 'That article no longer exists.', 'content-pipeline' ), array( 'status' => 404 ) );
	}
}
