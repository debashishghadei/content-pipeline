<?php
/**
 * Website settings: one set per website folder (term meta), plus defaults for notes
 * that are not inside a website folder (option).
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Per-website writing settings.
 */
final class Sites {

	public const META            = 'cp_site_settings';
	public const DEFAULTS_OPTION = 'content_pipeline_site_defaults';

	/**
	 * Largest example article kept (characters).
	 */
	public const EXAMPLE_MAX = 60000;

	/**
	 * Built-in starting values.
	 *
	 * @return array<string, mixed>
	 */
	public static function defaults(): array {
		return array(
			'audience' => '',
			'language' => 'English',
			'tone'     => 'Friendly, clear and practical',
			'words'    => 1200,
			'boxes'    => array_keys( Prompts::boxes() ),
			'banned'   => implode( "\n", Prompts::ai_phrases() ),
			'style'    => '',
			'examples' => array(),
			'prompts'  => array(),
			'rev'      => 0,
		);
	}

	/**
	 * Is this folder id usable for settings? 0 = defaults; otherwise an existing folder.
	 *
	 * @param int $folder Folder id.
	 */
	public static function valid( int $folder ): bool {
		return 0 === $folder || (bool) term_exists( $folder, Notes::FOLDER );
	}

	/**
	 * Settings of a website folder (0 = defaults for notes outside website folders).
	 *
	 * @param int $folder Folder id.
	 * @return array<string, mixed>
	 */
	public static function get( int $folder ): array {
		$stored      = 0 === $folder ? get_option( self::DEFAULTS_OPTION ) : get_term_meta( $folder, self::META, true );
		$stored      = is_array( $stored ) ? $stored : array();
		$data        = array_merge( self::defaults(), $stored );
		$data        = self::clean( $data );
		$data['rev'] = (int) ( $stored['rev'] ?? 0 );
		return $data;
	}

	/**
	 * Save settings. Refuses when they were changed elsewhere since $base_rev.
	 *
	 * @param int   $folder   Folder id.
	 * @param array $input    New settings.
	 * @param int   $base_rev Revision the user started from.
	 * @return array<string, mixed>|\WP_Error Saved settings.
	 */
	public static function save( int $folder, array $input, int $base_rev ) {
		$current = self::get( $folder );
		if ( (int) $current['rev'] !== $base_rev ) {
			return new \WP_Error( 'cp_settings_changed', __( 'These settings were changed somewhere else in the meantime. Reload them, then make your change again.', 'content-pipeline' ), array( 'status' => 409 ) );
		}
		$data        = self::clean( array_merge( $current, $input ) );
		$data['rev'] = $base_rev + 1;
		if ( 0 === $folder ) {
			update_option( self::DEFAULTS_OPTION, $data, false );
		} else {
			update_term_meta( $folder, self::META, $data );
		}
		return $data;
	}

	/**
	 * Clean settings values.
	 *
	 * @param array $data Raw settings.
	 * @return array<string, mixed>
	 */
	public static function clean( array $data ): array {
		$text = static function ( $value, int $max ): string {
			return mb_substr( Notes::clean_text( $value ), 0, $max );
		};

		$boxes = array();
		foreach ( (array) ( $data['boxes'] ?? array() ) as $box ) {
			if ( is_string( $box ) && isset( Prompts::boxes()[ $box ] ) ) {
				$boxes[] = $box;
			}
		}

		$examples = array();
		foreach ( array_slice( (array) ( $data['examples'] ?? array() ), 0, 8 ) as $example ) {
			if ( ! is_array( $example ) ) {
				continue;
			}
			$examples[] = array(
				'title' => mb_substr( Notes::clean_title( $example['title'] ?? '' ), 0, 200 ),
				'text'  => $text( $example['text'] ?? '', self::EXAMPLE_MAX ),
			);
		}

		$prompts = array();
		foreach ( (array) ( $data['prompts'] ?? array() ) as $step => $template ) {
			if ( is_string( $step ) && isset( Prompts::steps()[ $step ] ) && is_string( $template ) && '' !== trim( $template ) ) {
				$prompts[ $step ] = $text( $template, 20000 );
			}
		}

		return array(
			'audience' => $text( $data['audience'] ?? '', 1000 ),
			'language' => mb_substr( Notes::clean_title( $data['language'] ?? 'English' ), 0, 60 ),
			'tone'     => $text( $data['tone'] ?? '', 1000 ),
			'words'    => max( 200, min( 10000, (int) ( $data['words'] ?? 1200 ) ) ),
			'boxes'    => array_values( array_unique( $boxes ) ),
			'banned'   => $text( $data['banned'] ?? '', 10000 ),
			'style'    => $text( $data['style'] ?? '', 20000 ),
			'examples' => $examples,
			'prompts'  => $prompts,
			'rev'      => (int) ( $data['rev'] ?? 0 ),
		);
	}
}
