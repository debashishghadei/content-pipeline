/**
 * Content Pipeline Hub — text tools for articles (no page access, so they can be tested alone).
 *
 * - Markdown (as written by ChatGPT/Claude) → WordPress blocks, including Blog Kit boxes
 *   written as :::tip … ::: in the text.
 * - Reading pasted outlines and SEO fields.
 * - Automatic article checks.
 * - Filling prompt templates.
 *
 * All text is HTML-escaped before any formatting is added, so pasted text can never add
 * scripts or other HTML to the result.
 */
( function ( root, factory ) {
	'use strict';
	const lib = factory();
	if ( 'object' === typeof module && module.exports ) {
		module.exports = lib;
	} else {
		root.CPBlocks = lib;
	}
}( 'undefined' !== typeof self ? self : this, function () {
	'use strict';

	/* ---------------- inline text ---------------- */

	function esc( s ) {
		return String( s ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /"/g, '&quot;' ).replace( /'/g, '&#039;' );
	}

	/**
	 * Inline Markdown → safe HTML: **bold**, *italic* / _italic_, `code`, [text](https://…).
	 *
	 * @param {string} text
	 * @return {string} HTML.
	 */
	function inline( text ) {
		const codes = [];
		let s = String( text ).replace( /`([^`\n]+)`/g, ( m, c ) => {
			codes.push( '<code>' + esc( c ) + '</code>' );
			return '\u0000' + ( codes.length - 1 ) + '\u0000';
		} );
		const links = [];
		s = s.replace( /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, ( m, t, u ) => {
			links.push( { t, u } );
			return '\u0001' + ( links.length - 1 ) + '\u0001';
		} );
		s = esc( s );
		s = s.replace( /\*\*(?=\S)([^*\n]+?)\*\*/g, '<strong>$1</strong>' );
		s = s.replace( /__(?=\S)([^_\n]+?)__/g, '<strong>$1</strong>' );
		s = s.replace( /(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>' );
		s = s.replace( /(^|[^_\w])_(?=\S)([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>' );
		s = s.replace( /\u0001(\d+)\u0001/g, ( m, i ) => '<a href="' + esc( links[ i ].u ) + '">' + inline( links[ i ].t ) + '</a>' );
		s = s.replace( /\u0000(\d+)\u0000/g, ( m, i ) => codes[ i ] );
		return s;
	}

	/** Plain text of inline Markdown (for counting words, checks). */
	function plain( text ) {
		return String( text ).replace( /`([^`]*)`/g, '$1' ).replace( /\[([^\]]+)\]\([^)]*\)/g, '$1' ).replace( /[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1' );
	}

	/* ---------------- Markdown → nodes ---------------- */

	const BOX_NAMES = [ 'quick-answer', 'takeaways', 'tip', 'warning', 'note', 'checklist', 'faq' ];

	/**
	 * Parse Markdown into a simple list of nodes.
	 *
	 * @param {string} md
	 * @return {Array} Nodes: {t:'h',level,text} {t:'p',text} {t:'list',ordered,items}
	 *   {t:'quote',text} {t:'table',head,rows} {t:'code',text} {t:'box',name,nodes}.
	 */
	function parse( md ) {
		const lines = String( md || '' ).replace( /\r\n?/g, '\n' ).split( '\n' );
		return parseLines( lines );
	}

	function parseLines( lines ) {
		const nodes = [];
		let i = 0;
		let para = [];
		const flush = () => {
			if ( para.length ) {
				nodes.push( { t: 'p', text: para.join( ' ' ).trim() } );
				para = [];
			}
		};
		while ( i < lines.length ) {
			const raw = lines[ i ];
			const line = raw.trim();

			if ( '' === line ) {
				flush();
				i++;
				continue;
			}

			// :::box … :::
			const box = line.match( /^:::\s*([a-z-]+)\s*$/i );
			if ( box ) {
				flush();
				const name = box[ 1 ].toLowerCase();
				const inner = [];
				i++;
				while ( i < lines.length && ! /^:::\s*$/.test( lines[ i ].trim() ) ) {
					inner.push( lines[ i ] );
					i++;
				}
				i++; // closing :::
				nodes.push( { t: 'box', name: BOX_NAMES.includes( name ) ? name : 'note', nodes: parseLines( inner ) } );
				continue;
			}
			if ( /^:::\s*$/.test( line ) ) {
				i++; // stray closing marker
				continue;
			}

			// ``` code ```
			if ( /^```/.test( line ) ) {
				flush();
				const code = [];
				i++;
				while ( i < lines.length && ! /^```/.test( lines[ i ].trim() ) ) {
					code.push( lines[ i ] );
					i++;
				}
				i++;
				nodes.push( { t: 'code', text: code.join( '\n' ) } );
				continue;
			}

			// Headings
			const hd = line.match( /^(#{1,6})\s+(.+?)\s*#*$/ );
			if ( hd ) {
				flush();
				const level = Math.min( 4, Math.max( 2, hd[ 1 ].length ) );
				nodes.push( { t: 'h', level, text: hd[ 2 ], h1: 1 === hd[ 1 ].length } );
				i++;
				continue;
			}

			// Horizontal rule: dropped.
			if ( /^(-{3,}|\*{3,}|_{3,})$/.test( line ) ) {
				flush();
				i++;
				continue;
			}

			// Lists (nested items are flattened into the same list).
			const li = line.match( /^([-*+]|\d+[.)])\s+(.*)$/ );
			if ( li ) {
				flush();
				const ordered = /\d/.test( li[ 1 ] );
				const items = [];
				while ( i < lines.length ) {
					const m = lines[ i ].trim().match( /^([-*+]|\d+[.)])\s+(.*)$/ );
					if ( m ) {
						items.push( m[ 2 ].replace( /^\[[ xX]\]\s+/, '' ) );
						i++;
					} else if ( '' !== lines[ i ].trim() && /^\s{2,}/.test( lines[ i ] ) && items.length ) {
						items[ items.length - 1 ] += ' ' + lines[ i ].trim();
						i++;
					} else {
						break;
					}
				}
				nodes.push( { t: 'list', ordered, items } );
				continue;
			}

			// Quote
			if ( /^>/.test( line ) ) {
				flush();
				const q = [];
				while ( i < lines.length && /^>/.test( lines[ i ].trim() ) ) {
					q.push( lines[ i ].trim().replace( /^>\s?/, '' ) );
					i++;
				}
				nodes.push( { t: 'quote', text: q.join( ' ' ).trim() } );
				continue;
			}

			// Table: header row, separator row, body rows.
			if ( /^\|.*\|$/.test( line ) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test( lines[ i + 1 ].trim() ) ) {
				flush();
				const cells = ( l ) => l.trim().replace( /^\|/, '' ).replace( /\|$/, '' ).split( '|' ).map( ( c ) => c.trim() );
				const head = cells( line );
				i += 2;
				const rows = [];
				while ( i < lines.length && /^\|.*\|$/.test( lines[ i ].trim() ) ) {
					rows.push( cells( lines[ i ] ) );
					i++;
				}
				nodes.push( { t: 'table', head, rows } );
				continue;
			}

			para.push( line );
			i++;
		}
		flush();
		return nodes;
	}

	/* ---------------- nodes → WordPress blocks ---------------- */

	function block( name, attrs, html ) {
		const a = attrs && Object.keys( attrs ).length ? ' ' + JSON.stringify( attrs ) : '';
		return '<!-- wp:' + name + a + ' -->\n' + html + '\n<!-- /wp:' + name + ' -->';
	}

	function paragraph( text ) {
		return block( 'paragraph', null, '<p>' + inline( text ) + '</p>' );
	}

	function list( items, ordered, className ) {
		const attrs = {};
		if ( ordered ) {
			attrs.ordered = true;
		}
		if ( className ) {
			attrs.className = className;
		}
		const tag = ordered ? 'ol' : 'ul';
		const lis = items.map( ( t ) => block( 'list-item', null, '<li>' + inline( t ) + '</li>' ) ).join( '\n\n' );
		return block( 'list', attrs, '<' + tag + ' class="wp-block-list' + ( className ? ' ' + className : '' ) + '">' + lis + '</' + tag + '>' );
	}

	function group( className, inner ) {
		return block( 'group', { className, layout: { type: 'constrained' } }, '<div class="wp-block-group ' + className + '">' + inner + '</div>' );
	}

	function faq( nodes ) {
		// ### Question, then the answer until the next question.
		const out = [];
		let q = null;
		let a = [];
		const push = () => {
			if ( q ) {
				const inner = a.length ? toBlocks( a ) : paragraph( '' );
				out.push( block( 'details', { className: 'is-style-bk-faq' }, '<details class="wp-block-details is-style-bk-faq"><summary>' + inline( q ) + '</summary>' + inner + '</details>' ) );
			}
		};
		for ( const n of nodes ) {
			if ( 'h' === n.t ) {
				push();
				q = n.text;
				a = [];
			} else if ( 'p' === n.t && ! q && /\?$/.test( n.text ) ) {
				push();
				q = n.text;
				a = [];
			} else if ( q ) {
				a.push( n );
			} else {
				out.push( toBlocks( [ n ] ) );
			}
		}
		push();
		return out.join( '\n\n' );
	}

	function boxBlock( n ) {
		switch ( n.name ) {
			case 'checklist': {
				const items = [];
				const rest = [];
				for ( const c of n.nodes ) {
					if ( 'list' === c.t ) {
						items.push( ...c.items );
					} else {
						rest.push( c );
					}
				}
				return ( rest.length ? toBlocks( rest ) + '\n\n' : '' ) + list( items, false, 'is-style-bk-checklist' );
			}
			case 'faq':
				return faq( n.nodes );
			default:
				return group( 'is-style-bk-' + n.name, toBlocks( n.nodes ) || paragraph( '' ) );
		}
	}

	function table( n ) {
		const cols = n.head.length;
		const row = ( cells, tag ) => '<tr>' + Array.from( { length: cols }, ( _, k ) => '<' + tag + '>' + inline( cells[ k ] || '' ) + '</' + tag + '>' ).join( '' ) + '</tr>';
		return block( 'table', null, '<figure class="wp-block-table"><table class="has-fixed-layout"><thead>' + row( n.head, 'th' ) + '</thead><tbody>' + n.rows.map( ( r ) => row( r, 'td' ) ).join( '' ) + '</tbody></table></figure>' );
	}

	/**
	 * Nodes → serialized WordPress blocks.
	 *
	 * @param {Array} nodes
	 * @return {string} Block markup.
	 */
	function toBlocks( nodes ) {
		return nodes.map( ( n ) => {
			switch ( n.t ) {
				case 'h':
					return 2 === n.level
						? block( 'heading', null, '<h2 class="wp-block-heading">' + inline( n.text ) + '</h2>' )
						: block( 'heading', { level: n.level }, '<h' + n.level + ' class="wp-block-heading">' + inline( n.text ) + '</h' + n.level + '>' );
				case 'p':
					return paragraph( n.text );
				case 'list':
					return list( n.items, n.ordered );
				case 'quote':
					return block( 'quote', null, '<blockquote class="wp-block-quote">' + paragraph( n.text ) + '</blockquote>' );
				case 'table':
					return table( n );
				case 'code':
					return block( 'code', null, '<pre class="wp-block-code"><code>' + esc( n.text ).replace( /&#039;/g, "'" ).replace( /&quot;/g, '"' ) + '</code></pre>' );
				case 'box':
					return boxBlock( n );
			}
			return '';
		} ).filter( Boolean ).join( '\n\n' );
	}

	/** Markdown → WordPress block markup. */
	function markdownToBlocks( md ) {
		return toBlocks( parse( md ) );
	}

	/* ---------------- reading pasted answers ---------------- */

	/**
	 * Read an outline: "## Heading" lines, optional "Brief:" and "Words:" lines below.
	 * Also accepts numbered or bulleted headings when there are no "##" lines.
	 *
	 * @param {string} text
	 * @return {Array<{heading: string, brief: string, words: number}>} Sections.
	 */
	function parseOutline( text ) {
		const lines = String( text || '' ).replace( /\r\n?/g, '\n' ).split( '\n' );
		const hasHashes = lines.some( ( l ) => /^\s*#{1,3}\s+\S/.test( l ) );
		const sections = [];
		let cur = null;
		for ( const raw of lines ) {
			const line = raw.trim();
			if ( ! line ) {
				continue;
			}
			// Without ## headings, a heading is a numbered or bulleted line that is NOT indented.
			let m = hasHashes ? line.match( /^#{1,3}\s+(.+)$/ ) : ( /^\S/.test( raw ) ? line.match( /^(?:\d+[.)]|[-*])\s+(.+)$/ ) : null );
			if ( m && ! /^(brief|words?)\s*:/i.test( m[ 1 ] ) ) {
				cur = { heading: plain( m[ 1 ] ).replace( /^(section\s+\d+\s*[:.-]\s*)/i, '' ).replace( /\s*\(\s*~?\d+\s*words?\s*\)\s*$/i, '' ).trim(), brief: '', words: 0 };
				const w = m[ 1 ].match( /\(\s*~?(\d+)\s*words?\s*\)\s*$/i );
				if ( w ) {
					cur.words = parseInt( w[ 1 ], 10 );
				}
				sections.push( cur );
				continue;
			}
			if ( ! cur ) {
				continue;
			}
			m = line.match( /^[-*]?\s*\**brief\**\s*:\s*(.*)$/i );
			if ( m ) {
				cur.brief = plain( m[ 1 ] ).trim();
				continue;
			}
			m = line.match( /^[-*]?\s*\**words?\**\s*:\s*~?(\d+)/i );
			if ( m ) {
				cur.words = parseInt( m[ 1 ], 10 );
				continue;
			}
			if ( ! cur.brief ) {
				cur.brief = plain( line.replace( /^[-*]\s+/, '' ) ).trim();
			}
		}
		return sections.filter( ( s ) => s.heading );
	}

	/** Read the 5 SEO lines. */
	function parseSeo( text ) {
		const out = {};
		const map = { title: /^seo\s*title|^title/i, description: /^meta\s*description|^description/i, slug: /^slug|^url/i, keyword: /^focus\s*keyword|^keyword/i, excerpt: /^excerpt/i };
		for ( const raw of String( text || '' ).split( /\r?\n/ ) ) {
			const line = raw.trim().replace( /^[-*]\s+/, '' ).replace( /\*\*/g, '' );
			const m = line.match( /^([^:]{2,30}):\s*(.+)$/ );
			if ( ! m ) {
				continue;
			}
			for ( const [ k, re ] of Object.entries( map ) ) {
				if ( re.test( m[ 1 ].trim() ) && ! out[ k ] ) {
					out[ k ] = m[ 2 ].trim().replace( /^["“]|["”]$/g, '' );
					break;
				}
			}
		}
		if ( out.slug ) {
			out.slug = slugify( out.slug );
		}
		return out;
	}

	/** First "Title: …" line of a cleanup answer. */
	function titleLine( text ) {
		const m = String( text || '' ).match( /^\s*\**\s*(?:working\s+)?title\s*\**\s*:\s*\**\s*(.+?)\s*\**\s*$/im );
		return m ? m[ 1 ].trim() : '';
	}

	function slugify( s ) {
		return String( s ).toLowerCase().normalize( 'NFKD' ).replace( /[̀-ͯ]/g, '' ).replace( /https?:\/\/[^/]+\//, '' ).replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ).slice( 0, 80 );
	}

	/* ---------------- checks ---------------- */

	function words( text ) {
		const m = plain( String( text || '' ) ).replace( /[#>*_`|:-]+/g, ' ' ).match( /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu );
		return m ? m.length : 0;
	}

	const STOP = new Set( 'a an the and or but if of to in on at for with by from as is are was were be been it its this that these those you your yours we our they their he she his her i me my not no do does did can could will would should may might must have has had so than then there here what when where which who how why all any each more most other some such only own same too very just also about into over after before up down out off again once both few'.split( ' ' ) );

	/**
	 * Check an article. Returns rows {state: 'ok'|'warn'|'fail', label, text}.
	 *
	 * @param {string} md     Article Markdown.
	 * @param {Object} opts   {words, banned: string[], seo: {...}}.
	 * @return {Array} Rows.
	 */
	function check( md, opts ) {
		opts = opts || {};
		const rows = [];
		const add = ( state, label, text ) => rows.push( { state, label, text } );
		const nodes = parse( md );
		const text = String( md || '' );
		const total = words( text );
		const target = opts.words || 0;

		if ( ! total ) {
			add( 'fail', 'Article text', 'There is no article text yet.' );
			return rows;
		}

		if ( target ) {
			const ratio = total / target;
			add( ratio >= 0.8 && ratio <= 1.25 ? 'ok' : 'warn', 'Length', total + ' words (target ' + target + ').' + ( ratio < 0.8 ? ' Quite short.' : ratio > 1.25 ? ' Quite long.' : '' ) );
		} else {
			add( 'ok', 'Length', total + ' words.' );
		}

		const h2 = nodes.filter( ( n ) => 'h' === n.t && 2 === n.level );
		add( h2.length >= 2 ? 'ok' : 'fail', 'Sections', h2.length + ' main sections (## headings).' + ( h2.length < 2 ? ' An article needs at least 2.' : '' ) );

		if ( nodes.some( ( n ) => n.h1 ) ) {
			add( 'warn', 'Title heading', 'The text has a "# " heading. The post title is the main heading; use ## for sections (it is turned into ## when copied).' );
		}

		const firstH = nodes.find( ( n ) => 'h' === n.t );
		if ( firstH && firstH.level > 2 ) {
			add( 'warn', 'Heading order', 'The first heading is a ### subheading; start sections with ##.' );
		}

		const headings = nodes.filter( ( n ) => 'h' === n.t ).map( ( n ) => plain( n.text ).toLowerCase().trim() );
		const dup = headings.filter( ( hh, k ) => headings.indexOf( hh ) !== k );
		if ( dup.length ) {
			add( 'warn', 'Repeated headings', 'Used more than once: ' + Array.from( new Set( dup ) ).join( ', ' ) );
		}

		// Sections with no text under them.
		let empty = 0;
		nodes.forEach( ( n, k ) => {
			if ( 'h' === n.t && 2 === n.level ) {
				const next = nodes[ k + 1 ];
				if ( ! next || ( 'h' === next.t && 2 === next.level ) ) {
					empty++;
				}
			}
		} );
		if ( empty ) {
			add( 'fail', 'Empty sections', empty + ' section' + ( 1 === empty ? ' has' : 's have' ) + ' a heading but no text.' );
		}

		const needs = text.match( /\[NEEDS DETAIL[^\]]*\]/gi ) || [];
		add( needs.length ? 'fail' : 'ok', 'Missing details', needs.length ? needs.length + ' [NEEDS DETAIL] marker' + ( 1 === needs.length ? '' : 's' ) + ' still in the text: ' + needs.slice( 0, 3 ).join( ' ' ) : 'No [NEEDS DETAIL] markers left.' );

		const leftovers = text.match( /^\s*(Brief|Words)\s*:/gim ) || [];
		const opens = ( text.match( /^:::\s*[a-z-]+\s*$/gim ) || [] ).length;
		const closes = ( text.match( /^:::\s*$/gm ) || [] ).length;
		if ( leftovers.length || opens !== closes ) {
			add( 'fail', 'Leftover instructions', ( leftovers.length ? 'Outline lines (Brief:/Words:) are still in the text. ' : '' ) + ( opens !== closes ? 'A ::: box is not closed.' : '' ) );
		}

		const lower = text.toLowerCase();
		const found = ( opts.banned || [] ).map( ( b ) => String( b ).trim() ).filter( ( b ) => b && lower.includes( b.toLowerCase() ) );
		add( found.length ? 'warn' : 'ok', 'Phrases to avoid', found.length ? 'Found: ' + found.slice( 0, 8 ).join( ', ' ) : 'None found.' );

		const paras = nodes.filter( ( n ) => 'p' === n.t );
		const longParas = paras.filter( ( n ) => words( n.text ) > 120 ).length;
		add( longParas ? 'warn' : 'ok', 'Paragraphs', longParas ? longParas + ' paragraph' + ( 1 === longParas ? ' is' : 's are' ) + ' over 120 words; split them for easier reading.' : 'All paragraphs are a comfortable length.' );

		const sentences = paras.map( ( n ) => plain( n.text ) ).join( ' ' ).split( /(?<=[.!?])\s+/ );
		const longS = sentences.filter( ( s ) => words( s ) > 35 ).length;
		add( longS > 2 ? 'warn' : 'ok', 'Sentences', longS ? longS + ' sentence' + ( 1 === longS ? ' is' : 's are' ) + ' over 35 words.' : 'No very long sentences.' );

		// Overused words.
		const counts = {};
		( plain( text ).toLowerCase().match( /[\p{L}][\p{L}'’-]{3,}/gu ) || [] ).forEach( ( w ) => {
			if ( ! STOP.has( w ) ) {
				counts[ w ] = ( counts[ w ] || 0 ) + 1;
			}
		} );
		const heavy = Object.entries( counts ).filter( ( [ , c ] ) => c >= 8 && c / total > 0.02 ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 4 );
		const keyword = String( ( opts.seo && opts.seo.keyword ) || '' ).toLowerCase();
		const heavyNotKey = heavy.filter( ( [ w ] ) => ! keyword.includes( w ) );
		if ( heavyNotKey.length ) {
			add( 'warn', 'Repeated words', heavyNotKey.map( ( [ w, c ] ) => '"' + w + '" ' + c + '×' ).join( ', ' ) );
		}

		// SEO fields.
		const seo = opts.seo || {};
		const tl = ( seo.title || '' ).length;
		add( ! tl ? 'warn' : tl >= 30 && tl <= 60 ? 'ok' : 'warn', 'SEO title', tl ? tl + ' characters (best 30–60).' : 'Not filled in yet (SEO step).' );
		const dl = ( seo.description || '' ).length;
		add( ! dl ? 'warn' : dl >= 120 && dl <= 160 ? 'ok' : 'warn', 'Meta description', dl ? dl + ' characters (best 120–160).' : 'Not filled in yet (SEO step).' );
		if ( seo.slug && ! /^[a-z0-9]+(-[a-z0-9]+)*$/.test( seo.slug ) ) {
			add( 'warn', 'Slug', 'Use lowercase words joined with hyphens.' );
		}
		if ( keyword ) {
			const inTitle = String( seo.title || '' ).toLowerCase().includes( keyword );
			const start = plain( text ).toLowerCase().split( /\s+/ ).slice( 0, 150 ).join( ' ' );
			const inStart = start.includes( keyword );
			add( inTitle && inStart ? 'ok' : 'warn', 'Focus keyword', 'In the SEO title: ' + ( inTitle ? 'yes' : 'no' ) + '. In the first 150 words: ' + ( inStart ? 'yes' : 'no' ) + '.' );
		}
		return rows;
	}

	/* ---------------- prompt templates ---------------- */

	/** Replace {{name}} placeholders; unknown names become empty. Lines left empty collapse. */
	function fill( template, vars ) {
		return String( template ).replace( /\{\{\s*([a-z_]+)\s*\}\}/g, ( m, k ) => ( null === vars[ k ] || undefined === vars[ k ] ? '' : String( vars[ k ] ) ) ).replace( /\n{3,}/g, '\n\n' ).trim();
	}

	return { esc, inline, plain, parse, toBlocks, markdownToBlocks, parseOutline, parseSeo, titleLine, slugify, words, check, fill, BOX_NAMES };
} ) );
