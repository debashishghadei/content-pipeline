/**
 * Content Pipeline Hub — article screens: the article workspace (6 steps + copy to
 * WordPress), the list of articles, and the writing settings per website.
 *
 * Uses the building blocks of app.js (window.CPApp) and the text tools of blocks.js
 * (window.CPBlocks). Every change goes through the app's safe saving queue.
 */
( function () {
	'use strict';

	const A = window.CPApp;
	const B = window.CPBlocks;
	if ( ! A || ! B ) {
		return;
	}
	const { C, S, Views, h, append, icon, iconBtn, uid, clone, fmtDate, fmtFull, debounce, api, isOffline, needOnline, reportError, toast, dialog, confirmBox, openMenu, copyText, go } = A;
	const W = C.writing || { prompts: {}, steps: {}, boxes: {}, site: {} };

	const STEPS = [
		{ key: 'cleanup', label: 'Cleanup', hint: 'Turn your rough note into clear points.' },
		{ key: 'outline', label: 'Outline', hint: 'Plan the sections, then approve the outline.' },
		{ key: 'draft', label: 'Draft', hint: 'Write the article one section at a time.' },
		{ key: 'polish', label: 'Polish', hint: 'Make the whole draft read naturally (optional).' },
		{ key: 'check', label: 'Check', hint: 'Automatic checks before you publish.' },
		{ key: 'seo', label: 'SEO', hint: 'SEO title, description, slug, keyword, excerpt.' },
		{ key: 'export', label: 'Copy to WordPress', hint: 'Copy the finished article into a new post.' },
	];
	const STAGE_ORDER = [ 'idea', 'outline_ready', 'draft_ready', 'ready', 'published' ];
	const WHY = { autosave: 'Before later edits', replaced: 'Before a new answer was pasted', conflict: 'From another device (not used)' };

	const siteCache = new Map(); // folder id → settings payload from the server
	let WS = null; // the open workspace: { id, step, el: {...}, refs: [] }

	/* =========================================================
	 * Helpers
	 * ======================================================= */

	function fieldOf( art, name ) {
		return art.fields[ name ] || { value: null, rev: 0, versions: [] };
	}

	function val( art, name, fallback ) {
		const v = fieldOf( art, name ).value;
		return null === v || undefined === v ? fallback : v;
	}

	function siteName( id ) {
		const f = S.folders.get( id );
		return f ? f.name : '';
	}

	function websiteFolders() {
		return Array.from( S.folders.values() ).filter( ( f ) => f.is_site ).sort( ( a, b ) => a.name.localeCompare( b.name ) );
	}

	function noteOf( art ) {
		return S.notes.get( A.noteKey( art.note ) ) || art.note_text || null;
	}

	function noteText( art ) {
		const n = noteOf( art );
		if ( ! n ) {
			return '';
		}
		const list = ( n.checklist || [] ).map( ( i ) => ( i.d ? '- [x] ' : '- ' ) + i.t ).join( '\n' );
		return [ n.title, n.body, list ].filter( ( x ) => x && String( x ).trim() ).join( '\n\n' );
	}

	function outlineOf( art ) {
		const o = val( art, 'outline', [] );
		return Array.isArray( o ) ? o : [];
	}

	function approvedIds( art ) {
		const a = val( art, 'approved', null );
		return a && Array.isArray( a.ids ) ? a.ids : [];
	}

	function outlineChangedSinceApproval( art ) {
		const ids = approvedIds( art );
		const now = outlineOf( art ).map( ( s ) => s.id );
		return ids.length > 0 && ids.join( ',' ) !== now.join( ',' );
	}

	/** Sections to draft: the outline's sections that were approved, in outline order. */
	function draftSections( art ) {
		const ids = new Set( approvedIds( art ) );
		return outlineOf( art ).filter( ( s ) => ids.has( s.id ) );
	}

	function assembled( art ) {
		return draftSections( art ).map( ( s ) => '## ' + s.heading + '\n\n' + String( val( art, 'section:' + s.id, '' ) ).trim() ).join( '\n\n' ).trim();
	}

	/** The text that is checked and exported: polished text, or the draft as it is. */
	function finalText( art ) {
		const p = String( val( art, 'polish', '' ) ).trim();
		return p || assembled( art );
	}

	function seoOf( art ) {
		return Object.assign( { title: '', description: '', slug: '', keyword: '', excerpt: '' }, val( art, 'seo', {} ) || {} );
	}

	function stepDone( art, key ) {
		switch ( key ) {
			case 'cleanup':
				return !! String( val( art, 'cleanup', '' ) ).trim();
			case 'outline':
				return approvedIds( art ).length > 0 && ! outlineChangedSinceApproval( art );
			case 'draft': {
				const secs = draftSections( art );
				return secs.length > 0 && secs.every( ( s ) => String( val( art, 'section:' + s.id, '' ) ).trim() );
			}
			case 'polish':
				return !! String( val( art, 'polish', '' ) ).trim();
			case 'check':
				return !! val( art, 'ready', false );
			case 'seo': {
				const seo = seoOf( art );
				return !! ( seo.title && seo.description );
			}
			case 'export':
				return !! val( art, 'published', false );
		}
		return false;
	}

	function saveField( art, field, value, snapshot ) {
		A.changeArticle( art, field, value, snapshot );
		if ( 'title' === field ) {
			art.title = value;
		}
		refreshChrome();
	}

	/** Settings of the article's website (falls back to the built-in defaults). */
	function settingsFor( art ) {
		const payload = siteCache.get( art.site || 0 ) || siteCache.get( 0 );
		return Object.assign( {}, W.site, payload ? payload.settings : {} );
	}

	async function loadSettings( folder, force ) {
		if ( siteCache.has( folder ) && ! force ) {
			return siteCache.get( folder );
		}
		try {
			const data = await api( 'GET', 'sites/' + folder );
			siteCache.set( folder, data );
			return data;
		} catch ( err ) {
			if ( ! isOffline( err ) ) {
				reportError( err );
			}
			return null;
		}
	}

	/** Load an article, keeping any changes still waiting to be saved on this device. */
	async function loadArticle( id ) {
		const data = await api( 'GET', 'articles/' + id );
		const art = data.article;
		for ( const e of S.pending.values() ) {
			if ( 'article' === e.kind && e.id === id ) {
				const f = art.fields[ e.field ] || ( art.fields[ e.field ] = { value: null, rev: 0, versions: [] } );
				f.value = clone( e.value );
			}
		}
		S.art.set( id, art );
		S.articles.set( id, A.summaryOf( art ) );
		return art;
	}

	function remount() {
		const main = document.querySelector( '.cp-main' );
		if ( main ) {
			main.dataset.mounted = '';
		}
		A.render();
	}

	/* =========================================================
	 * Prompts
	 * ======================================================= */

	const BOX_HELP = {
		'quick-answer': 'quick-answer (a 2–3 sentence direct answer; once, right after the introduction)',
		takeaways: 'takeaways (3–5 "- " points; once, before the last section)',
		tip: 'tip (a helpful tip)',
		warning: 'warning (a common mistake to avoid)',
		note: 'note (extra information)',
		checklist: 'checklist (steps to tick off, as "- " points)',
		faq: 'faq (once: "### Question" lines, each followed by its answer)',
	};

	function boxesRule( st, step ) {
		const forSection = [ 'tip', 'warning', 'note', 'checklist' ];
		const allowed = ( st.boxes || [] ).filter( ( b ) => 'section' !== step || forSection.includes( b ) );
		if ( ! allowed.length ) {
			return '- Do not add any boxes.';
		}
		const example = allowed.includes( 'tip' ) ? 'tip' : allowed[ 0 ];
		return '- You may add boxes where they really help the reader' + ( 'section' === step ? ' (at most one in this section)' : '' ) + '. Write a box exactly like this, each marker on its own line:\n:::' + example + '\nThe text of the box.\n:::\n  Allowed boxes: ' + allowed.map( ( b ) => BOX_HELP[ b ] || b ).join( '; ' ) + '.';
	}

	function context( art, st ) {
		const lines = [];
		lines.push( 'Website: ' + ( siteName( art.site ) || 'my website' ) );
		if ( st.audience ) {
			lines.push( 'Audience: ' + st.audience );
		}
		lines.push( 'Language: ' + ( st.language || 'English' ) );
		if ( st.tone ) {
			lines.push( 'Tone: ' + st.tone );
		}
		if ( st.style && st.style.trim() ) {
			lines.push( '\nStyle guide (follow it):\n' + st.style.trim() );
		}
		const ex = ( st.examples || [] ).find( ( e ) => e.text && e.text.trim() );
		if ( ex ) {
			const piece = ex.text.trim().split( /\s+/ ).slice( 0, 250 ).join( ' ' );
			lines.push( '\nA short piece of one of our articles, to show the voice (match the voice; do not copy its content):\n"""\n' + piece + '\n"""' );
		}
		return lines.join( '\n' );
	}

	function bannedList( st ) {
		return String( st.banned || '' ).split( /\n+/ ).map( ( s ) => s.trim() ).filter( Boolean );
	}

	function outlineList( art ) {
		return draftSections( art ).map( ( s, k ) => ( k + 1 ) + '. ' + s.heading + ( s.brief ? ' — ' + s.brief : '' ) + ( s.words ? ' (' + s.words + ' words)' : '' ) ).join( '\n' );
	}

	/** Text of the sections before section `id`, shortened to keep the prompt small. */
	function previousText( art, id ) {
		const secs = draftSections( art );
		const before = [];
		for ( const s of secs ) {
			if ( s.id === id ) {
				break;
			}
			const t = String( val( art, 'section:' + s.id, '' ) ).trim();
			if ( t ) {
				before.push( { heading: s.heading, text: t } );
			}
		}
		if ( ! before.length ) {
			return '';
		}
		let budget = 6000;
		const parts = [];
		for ( let k = before.length - 1; k >= 0; k-- ) {
			let t = before[ k ].text;
			if ( t.length > budget ) {
				t = t.split( /\n\s*\n/ )[ 0 ].slice( 0, Math.max( 300, budget ) ) + ' […]';
			}
			budget -= t.length;
			parts.unshift( '## ' + before[ k ].heading + '\n' + t );
			if ( budget <= 0 ) {
				break;
			}
		}
		return 'Already written (do not repeat it):\n"""\n' + parts.join( '\n\n' ) + '\n"""';
	}

	function template( st, step ) {
		return ( st.prompts && st.prompts[ step ] ) || W.prompts[ step ] || '';
	}

	function buildPrompt( art, step, extra ) {
		const st = settingsFor( art );
		const sec = extra && extra.section;
		const vars = {
			context: context( art, st ),
			site: siteName( art.site ) || 'my website',
			words: st.words,
			banned: bannedList( st ).slice( 0, 30 ).join( ', ' ),
			faq_rule: ( st.boxes || [] ).includes( 'faq' ) ? '- If readers would have common questions, the second-last section can be "FAQ" (3–5 real questions).' : '',
			boxes_rule: boxesRule( st, step ),
			note: noteText( art ),
			cleanup: String( val( art, 'cleanup', '' ) ).trim() || noteText( art ),
			title: val( art, 'title', '' ) || 'Untitled',
			outline: outlineList( art ),
			heading: sec ? sec.heading : '',
			brief: sec ? sec.brief : '',
			section_words: sec && sec.words ? sec.words : Math.round( st.words / Math.max( 1, draftSections( art ).length ) ),
			previous: sec ? previousText( art, sec.id ) : '',
			draft: assembled( art ),
			article: finalText( art ),
			examples: ( st.examples || [] ).filter( ( e ) => e.text && e.text.trim() ).map( ( e, k ) => '### Example ' + ( k + 1 ) + ( e.title ? ': ' + e.title : '' ) + '\n' + e.text.trim().split( /\s+/ ).slice( 0, 1500 ).join( ' ' ) ).join( '\n\n' ),
		};
		return B.fill( template( st, step ), vars );
	}

	function promptDialog( title, text ) {
		const ta = h( 'textarea', { class: 'cp-input cp-prompt-text', readonly: true, rows: 12, 'aria-label': 'Prompt' } );
		ta.value = text;
		const d = dialog( title, [
			h( 'p', { class: 'cp-scope', style: 'margin-top:0' }, 'Copy this prompt, paste it into ChatGPT or Claude, then bring the answer back here with “Paste answer”.' ),
			ta,
			h( 'p', { class: 'cp-scope' }, text.length.toLocaleString() + ' characters' ),
		], [
			h( 'a', { class: 'cp-btn', href: 'https://chatgpt.com/', target: '_blank', rel: 'noopener' }, icon( 'external' ), 'Open ChatGPT' ),
			h( 'a', { class: 'cp-btn', href: 'https://claude.ai/new', target: '_blank', rel: 'noopener' }, icon( 'external' ), 'Open Claude' ),
			h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary cp-copy-prompt', onClick: () => copyText( text, 'Prompt copied. Paste it into ChatGPT or Claude.' ) }, icon( 'copy' ), 'Copy prompt' ),
		], 'cp-dialog--wide' );
		d.classList.remove( 'cp-dialog--small' );
		return d;
	}

	/* =========================================================
	 * Shared parts of a step
	 * ======================================================= */

	/** A text box bound to one article field. Typing autosaves; pasting keeps the old text in versions. */
	function fieldBox( art, field, opts ) {
		opts = opts || {};
		const ta = h( 'textarea', { class: 'cp-input cp-field', rows: opts.rows || 8, placeholder: opts.placeholder || '', 'aria-label': opts.label || field, dataset: { field } } );
		ta.value = String( val( art, field, '' ) || '' );
		let pasted = false;
		const grow = () => {
			ta.style.height = 'auto';
			ta.style.height = Math.min( 2400, Math.max( ( opts.rows || 8 ) * 22, ta.scrollHeight + 4 ) ) + 'px';
		};
		ta.addEventListener( 'paste', () => {
			pasted = true;
		} );
		ta.addEventListener( 'input', () => {
			grow();
			saveField( art, field, ta.value, pasted );
			pasted = false;
			if ( opts.onChange ) {
				opts.onChange( ta.value );
			}
		} );
		WS.refs.push( { field, el: ta, set: ( v ) => {
			ta.value = String( v || '' );
			grow();
		} } );
		window.requestAnimationFrame( grow );
		return ta;
	}

	/** Paste the clipboard into a field (or ask the user to long-press and paste). */
	async function pasteAnswer( art, field, after ) {
		let text = null;
		try {
			if ( navigator.clipboard && navigator.clipboard.readText && window.isSecureContext ) {
				text = await navigator.clipboard.readText();
			}
		} catch ( e ) {
			text = null;
		}
		const ref = WS.refs.find( ( r ) => r.field === field );
		if ( null === text || ! text.trim() ) {
			toast( 'Could not read the clipboard here. Long-press (or right-click) in the box below and choose Paste.', null, 7000 );
			if ( ref ) {
				ref.el.focus();
			}
			return;
		}
		if ( ref ) {
			ref.set( text );
		}
		saveField( art, field, text, true );
		if ( after ) {
			after( text );
		}
		toast( 'Answer pasted.' );
	}

	function versionsButton( art, field, onRestore ) {
		const n = ( fieldOf( art, field ).versions || [] ).length;
		return h( 'button', { type: 'button', class: 'cp-btn', disabled: ! n, dataset: { versions: field }, onClick: () => showVersions( art, field, onRestore ) }, icon( 'history' ), 'Earlier versions' + ( n ? ' (' + n + ')' : '' ) );
	}

	function preview( value ) {
		if ( 'string' === typeof value ) {
			return value;
		}
		if ( Array.isArray( value ) ) {
			return value.map( ( s ) => '## ' + s.heading + ( s.brief ? '\n' + s.brief : '' ) ).join( '\n' );
		}
		if ( value && 'object' === typeof value ) {
			return Object.entries( value ).map( ( [ k, v ] ) => k + ': ' + v ).join( '\n' );
		}
		return String( value );
	}

	function showVersions( art, field, onRestore ) {
		const versions = fieldOf( art, field ).versions || [];
		const list = h( 'ul', { class: 'cp-rows' } );
		const d = dialog( 'Earlier versions', [
			h( 'p', { class: 'cp-scope', style: 'margin-top:0' }, 'Kept automatically: before a new answer is pasted, while you edit (at most every 10 minutes), and anything sent from another device at the same time. Up to 10 per step.' ),
			list,
		] );
		d.classList.remove( 'cp-dialog--small' );
		for ( const v of versions ) {
			const text = preview( v.value );
			list.appendChild( h( 'li', { class: 'cp-row' },
				h( 'div', { class: 'cp-row__text' },
					h( 'div', { class: 'cp-row__title' }, WHY[ v.why ] || 'Earlier version' ),
					h( 'div', { class: 'cp-row__sub' }, fmtFull( v.at ) ),
					h( 'p', { class: 'cp-row__preview' }, text.slice( 0, 600 ) )
				),
				h( 'button', { type: 'button', class: 'cp-btn', onClick: () => copyText( text, 'Copied.' ) }, icon( 'copy' ), 'Copy' ),
				h( 'button', { type: 'button', class: 'cp-btn', onClick: () => {
					saveField( art, field, clone( v.value ), true );
					d.close();
					if ( onRestore ) {
						onRestore();
					} else {
						renderStep();
					}
					toast( 'Earlier version restored. The text before it is kept as an earlier version too.' );
				} }, icon( 'restore' ), 'Restore' )
			) );
		}
	}

	function stepActions( art, step, field, opts ) {
		opts = opts || {};
		return h( 'div', { class: 'cp-actions' },
			h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary', onClick: () => {
				if ( opts.before && false === opts.before() ) {
					return;
				}
				promptDialog( opts.promptTitle || 'Prompt', buildPrompt( art, step, opts.extra ) );
			} }, icon( 'copy' ), 'Copy prompt' ),
			h( 'button', { type: 'button', class: 'cp-btn', onClick: () => pasteAnswer( art, field, opts.afterPaste ) }, icon( 'paste' ), 'Paste answer' ),
			versionsButton( art, field, opts.onRestore )
		);
	}

	function nextButton( key, label ) {
		return h( 'div', { class: 'cp-next' }, h( 'button', { type: 'button', class: 'cp-btn', onClick: () => openStep( key ) }, label + ' →' ) );
	}

	/* =========================================================
	 * Steps
	 * ======================================================= */

	const Panels = {
		cleanup( art, el ) {
			const note = noteText( art );
			append( el, [
				h( 'details', { class: 'cp-source' }, h( 'summary', null, 'Your note' ), h( 'p', { class: 'cp-pre' }, note || '(The note is empty or no longer exists.)' ) ),
				stepActions( art, 'cleanup', 'cleanup', { promptTitle: 'Prompt: cleanup', afterPaste: () => renderStep() } ),
				fieldBox( art, 'cleanup', { rows: 10, placeholder: 'Paste the cleaned-up notes here (or write them yourself).', label: 'Cleaned-up notes', onChange: debounce( () => titleSuggestion( art, el ), 400 ) } ),
				h( 'div', { class: 'cp-title-suggest' } ),
				nextButton( 'outline', 'Next: Outline' ),
			] );
			titleSuggestion( art, el );
		},

		outline( art, el ) {
			const st = settingsFor( art );
			const list = h( 'div', { class: 'cp-outline' } );
			const approveBox = h( 'div', { class: 'cp-approve' } );
			const readFromText = ( text, force ) => {
				const parsed = B.parseOutline( text );
				if ( ! parsed.length ) {
					if ( force ) {
						toast( 'No sections found. Each section should start with "## ".' );
					}
					return;
				}
				if ( approvedIds( art ).length && ! force ) {
					toast( 'The outline is already approved, so the sections were not replaced. Use “Read sections from the text” to replace them.', null, 8000 );
					return;
				}
				const old = outlineOf( art );
				const next = parsed.map( ( p ) => {
					const same = old.find( ( o ) => o.heading.toLowerCase() === p.heading.toLowerCase() );
					return { id: same ? same.id : uid().slice( 0, 10 ), heading: p.heading, brief: p.brief, words: p.words };
				} );
				saveField( art, 'outline', next, true );
				drawOutline();
				toast( next.length + ' sections read from the outline.' );
			};
			const drawOutline = () => {
				list.textContent = '';
				const secs = outlineOf( art );
				const total = secs.reduce( ( sum, s ) => sum + ( s.words || 0 ), 0 );
				list.appendChild( h( 'div', { class: 'cp-section-label' }, 'Sections (' + secs.length + ')' + ( total ? ' · ' + total + ' words planned (target ' + st.words + ')' : '' ) ) );
				const update = ( k, key, value ) => {
					const next = clone( outlineOf( art ) );
					next[ k ][ key ] = 'words' === key ? Math.max( 0, parseInt( value, 10 ) || 0 ) : value;
					saveField( art, 'outline', next, false );
					drawApprove();
				};
				const move = ( k, dir ) => {
					const next = clone( outlineOf( art ) );
					const j = k + dir;
					if ( j < 0 || j >= next.length ) {
						return;
					}
					[ next[ k ], next[ j ] ] = [ next[ j ], next[ k ] ];
					saveField( art, 'outline', next, false );
					drawOutline();
				};
				secs.forEach( ( s, k ) => {
					list.appendChild( h( 'div', { class: 'cp-outline__row', dataset: { id: s.id } },
						h( 'span', { class: 'cp-outline__num' }, String( k + 1 ) ),
						h( 'div', { class: 'cp-outline__fields' },
							h( 'input', { class: 'cp-input cp-outline__heading', type: 'text', value: s.heading, 'aria-label': 'Section heading', onInput: ( e ) => update( k, 'heading', e.target.value ) } ),
							h( 'input', { class: 'cp-input cp-outline__brief', type: 'text', value: s.brief, placeholder: 'What this section covers', 'aria-label': 'What this section covers', onInput: ( e ) => update( k, 'brief', e.target.value ) } )
						),
						h( 'input', { class: 'cp-input cp-outline__words', type: 'number', min: 0, step: 50, value: s.words || '', placeholder: 'words', 'aria-label': 'Words', onInput: ( e ) => update( k, 'words', e.target.value ) } ),
						h( 'div', { class: 'cp-outline__tools' },
							iconBtn( 'up', 'Move up', () => move( k, -1 ), { disabled: 0 === k } ),
							iconBtn( 'down', 'Move down', () => move( k, 1 ), { disabled: k === secs.length - 1 } ),
							iconBtn( 'close', 'Remove section', () => {
								const next = clone( outlineOf( art ) );
								next.splice( k, 1 );
								saveField( art, 'outline', next, false );
								drawOutline();
							} )
						)
					) );
				} );
				list.appendChild( h( 'button', { type: 'button', class: 'cp-btn', onClick: () => {
					const next = clone( outlineOf( art ) );
					next.push( { id: uid().slice( 0, 10 ), heading: 'New section', brief: '', words: 200 } );
					saveField( art, 'outline', next, false );
					drawOutline();
				} }, icon( 'plus' ), 'Add section' ) );
				drawApprove();
			};
			const drawApprove = () => {
				approveBox.textContent = '';
				const secs = outlineOf( art );
				const approved = val( art, 'approved', null );
				const approve = () => {
					if ( ! outlineOf( art ).length ) {
						return;
					}
					S.pending.delete( 'a' + art.id + '|approved' ); // Re-queued last, so it is saved after the outline itself.
					A.changeArticle( art, 'approved', true, false );
					art.fields.approved.value = { at: new Date().toISOString(), ids: outlineOf( art ).map( ( s ) => s.id ) };
					refreshChrome();
					drawApprove();
					toast( 'Outline approved. Next: write the draft.', { label: 'Go to Draft', run: () => openStep( 'draft' ) } );
				};
				if ( approved && approved.ids && approved.ids.length && ! outlineChangedSinceApproval( art ) ) {
					append( approveBox, [
						h( 'p', { class: 'cp-ok' }, icon( 'check' ), 'Outline approved ' + fmtDate( approved.at ) + '. You can still edit headings and descriptions.' ),
						h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary', onClick: () => openStep( 'draft' ) }, 'Next: Draft →' ),
					] );
				} else if ( approved && approved.ids && approved.ids.length ) {
					append( approveBox, [
						h( 'p', { class: 'cp-warn' }, 'You added, removed or moved sections after approving. Approve again so the draft uses the new sections. Text already written for a section is kept.' ),
						h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary cp-approve-btn', onClick: approve }, icon( 'check' ), 'Approve again' ),
					] );
				} else {
					approveBox.appendChild( h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary cp-approve-btn', disabled: ! secs.length, onClick: approve }, icon( 'check' ), 'Approve outline' ) );
					if ( ! secs.length ) {
						approveBox.appendChild( h( 'p', { class: 'cp-scope' }, 'Paste an outline above, or add sections by hand, then approve it.' ) );
					}
				}
			};
			append( el, [
				stepActions( art, 'outline', 'outline_text', {
					promptTitle: 'Prompt: outline',
					afterPaste: ( text ) => readFromText( text, false ),
					onRestore: () => renderStep(),
				} ),
				fieldBox( art, 'outline_text', { rows: 8, placeholder: 'Paste the outline here. Each section starts with "## Heading", then "Brief:" and "Words:" lines.', label: 'Outline text' } ),
				h( 'div', { class: 'cp-actions' }, h( 'button', { type: 'button', class: 'cp-btn', onClick: () => readFromText( String( val( art, 'outline_text', '' ) ), true ) }, icon( 'refresh' ), 'Read sections from the text' ),
					versionsButton( art, 'outline', () => renderStep() ) ),
				list,
				approveBox,
			] );
			// A pasted outline (by keyboard) is read automatically while the outline is not approved yet.
			const ta = el.querySelector( 'textarea[data-field="outline_text"]' );
			ta.addEventListener( 'paste', () => window.setTimeout( () => readFromText( ta.value, false ), 0 ) );
			drawOutline();
		},

		draft( art, el ) {
			const secs = draftSections( art );
			if ( ! secs.length ) {
				append( el, [
					h( 'p', { class: 'cp-warn' }, 'Approve the outline first. Each approved section gets its own prompt here.' ),
					h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary', onClick: () => openStep( 'outline' ) }, '← Go to Outline' ),
				] );
				return;
			}
			const written = secs.filter( ( s ) => String( val( art, 'section:' + s.id, '' ) ).trim() ).length;
			el.appendChild( h( 'p', { class: 'cp-scope cp-draft-progress' }, written + ' of ' + secs.length + ' sections written. Do them one at a time, in order: each prompt includes the sections already written.' ) );
			if ( outlineChangedSinceApproval( art ) ) {
				el.appendChild( h( 'p', { class: 'cp-warn' }, 'The outline changed after approval. Approve it again in Outline to draft the new sections.' ) );
			}
			const firstEmpty = secs.find( ( s ) => ! String( val( art, 'section:' + s.id, '' ) ).trim() );
			secs.forEach( ( s, k ) => {
				const field = 'section:' + s.id;
				const count = h( 'span', { class: 'cp-count' } );
				const setCount = ( text ) => {
					const n = B.words( text );
					count.textContent = n + ( s.words ? ' / ' + s.words : '' ) + ' words';
					count.classList.toggle( 'is-done', n > 0 );
				};
				setCount( String( val( art, field, '' ) ) );
				const box = h( 'details', { class: 'cp-sec', open: firstEmpty ? firstEmpty.id === s.id : 0 === k, dataset: { id: s.id } },
					h( 'summary', null, h( 'span', { class: 'cp-sec__num' }, String( k + 1 ) ), h( 'span', { class: 'cp-sec__title' }, s.heading ), count ),
					h( 'p', { class: 'cp-scope' }, s.brief || '' ),
					stepActions( art, 'section', field, { promptTitle: 'Prompt: section ' + ( k + 1 ) + ' – ' + s.heading, extra: { section: s }, afterPaste: ( t ) => setCount( t ) } ),
					fieldBox( art, field, { rows: 8, placeholder: 'Paste the text of this section here (without its heading).', label: 'Text of section ' + ( k + 1 ), onChange: setCount } )
				);
				el.appendChild( box );
			} );
			el.appendChild( nextButton( 'polish', 'Next: Polish' ) );
		},

		polish( art, el ) {
			const draft = assembled( art );
			append( el, [
				h( 'p', { class: 'cp-scope' }, 'The draft has ' + B.words( draft ) + ' words in ' + draftSections( art ).length + ' sections. Polishing is optional: if this box stays empty, the draft is used as it is.' ),
				stepActions( art, 'polish', 'polish', { promptTitle: 'Prompt: polish', before: () => {
					if ( ! draft ) {
						toast( 'Write the draft first.' );
						return false;
					}
				} } ),
				fieldBox( art, 'polish', { rows: 18, placeholder: 'Paste the polished article here (Markdown).', label: 'Polished article' } ),
				h( 'div', { class: 'cp-actions' }, h( 'button', { type: 'button', class: 'cp-btn', disabled: ! draft, onClick: async () => {
					if ( String( val( art, 'polish', '' ) ).trim() && ! ( await confirmBox( 'Start from the draft', 'Replace the polished text with the draft? The current polished text is kept under Earlier versions.', 'Replace', false ) ) ) {
						return;
					}
					saveField( art, 'polish', draft, true );
					renderStep();
				} }, 'Copy the draft into this box to edit it by hand' ) ),
				nextButton( 'check', 'Next: Check' ),
			] );
		},

		check( art, el ) {
			const st = settingsFor( art );
			const text = finalText( art );
			const rows = B.check( text, { words: st.words, banned: bannedList( st ), seo: seoOf( art ) } );
			const fails = rows.filter( ( r ) => 'fail' === r.state ).length;
			const warns = rows.filter( ( r ) => 'warn' === r.state ).length;
			const icons = { ok: [ 'check', 'Passed' ], warn: [ 'bolt', 'Check this' ], fail: [ 'close', 'Must fix' ] };
			append( el, [
				h( 'p', { class: 'cp-scope' }, 'Checking the ' + ( String( val( art, 'polish', '' ) ).trim() ? 'polished article' : 'draft (not polished)' ) + '. ' + ( fails ? fails + ' must be fixed, ' : '' ) + ( warns ? warns + ' to look at.' : fails ? '' : 'Everything looks good.' ) ),
				h( 'ul', { class: 'cp-checks' }, rows.map( ( r ) => h( 'li', { class: 'cp-check cp-check--' + r.state },
					h( 'span', { class: 'cp-check__icon', title: icons[ r.state ][ 1 ] }, icon( icons[ r.state ][ 0 ] ) ),
					h( 'span', { class: 'cp-check__label' }, r.label ),
					h( 'span', { class: 'cp-check__text' }, r.text )
				) ) ),
			] );
			const ready = !! val( art, 'ready', false );
			el.appendChild( h( 'div', { class: 'cp-approve' }, ready
				? [ h( 'p', { class: 'cp-ok' }, icon( 'check' ), 'Marked as ready.' ), h( 'button', { type: 'button', class: 'cp-btn', onClick: () => {
					saveField( art, 'ready', false, false );
					renderStep();
				} }, 'Not ready after all' ) ]
				: h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary cp-ready-btn', disabled: ! text, onClick: async () => {
					if ( fails && ! ( await confirmBox( 'Mark as ready', fails + ' check' + ( 1 === fails ? '' : 's' ) + ' failed. Mark the article as ready anyway?', 'Mark as ready', false ) ) ) {
						return;
					}
					saveField( art, 'ready', true, false );
					renderStep();
				} }, icon( 'check' ), 'Mark as ready' ) ) );
			el.appendChild( nextButton( 'seo', 'Next: SEO' ) );
		},

		seo( art, el ) {
			const seo = seoOf( art );
			const inputs = {};
			const counters = {};
			const snippet = h( 'div', { class: 'cp-snippet' } );
			const drawSnippet = () => {
				const s = seoOf( art );
				snippet.textContent = '';
				append( snippet, [
					h( 'div', { class: 'cp-snippet__url' }, ( siteName( art.site ) || 'your-site' ).toLowerCase().replace( /\s+/g, '' ) + ' › ' + ( s.slug || 'post-slug' ) ),
					h( 'div', { class: 'cp-snippet__title' }, s.title || val( art, 'title', '' ) || 'SEO title' ),
					h( 'div', { class: 'cp-snippet__desc' }, s.description || 'Meta description…' ),
				] );
			};
			const limits = { title: [ 30, 60 ], description: [ 120, 160 ] };
			const save = () => {
				const next = {};
				for ( const k of Object.keys( inputs ) ) {
					next[ k ] = inputs[ k ].value;
				}
				saveField( art, 'seo', next, false );
				for ( const [ k, c ] of Object.entries( counters ) ) {
					const n = inputs[ k ].value.length;
					c.textContent = n + ' characters (best ' + limits[ k ][ 0 ] + '–' + limits[ k ][ 1 ] + ')';
					c.classList.toggle( 'is-bad', n > 0 && ( n < limits[ k ][ 0 ] || n > limits[ k ][ 1 ] ) );
				}
				drawSnippet();
			};
			const row = ( key, label, multi ) => {
				const input = multi ? h( 'textarea', { class: 'cp-input', rows: 3 } ) : h( 'input', { class: 'cp-input', type: 'text' } );
				input.value = seo[ key ] || '';
				input.dataset.seo = key;
				input.addEventListener( 'input', save );
				if ( 'slug' === key ) {
					input.addEventListener( 'blur', () => {
						input.value = B.slugify( input.value );
						save();
					} );
				}
				inputs[ key ] = input;
				const lab = h( 'label', { class: 'cp-field' }, h( 'span', null, label ), input );
				if ( limits[ key ] ) {
					counters[ key ] = h( 'small', { class: 'cp-counter' } );
					lab.appendChild( counters[ key ] );
				}
				WS.refs.push( { field: 'seo', el: input, set: ( v ) => {
					input.value = ( v && v[ key ] ) || '';
				} } );
				return lab;
			};
			append( el, [
				h( 'div', { class: 'cp-actions' },
					h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary', onClick: () => {
						if ( ! finalText( art ) ) {
							toast( 'Write the article first.' );
							return;
						}
						promptDialog( 'Prompt: SEO fields', buildPrompt( art, 'seo' ) );
					} }, icon( 'copy' ), 'Copy prompt' ),
					h( 'button', { type: 'button', class: 'cp-btn', onClick: async () => {
						let text = null;
						try {
							text = navigator.clipboard && window.isSecureContext ? await navigator.clipboard.readText() : null;
						} catch ( e ) {}
						const apply = ( t ) => {
							const parsed = B.parseSeo( t );
							if ( ! Object.keys( parsed ).length ) {
								toast( 'No SEO lines found. Expected lines like "SEO title: …".' );
								return;
							}
							for ( const [ k, v ] of Object.entries( parsed ) ) {
								if ( inputs[ k ] ) {
									inputs[ k ].value = v;
								}
							}
							const next = {};
							for ( const k of Object.keys( inputs ) ) {
								next[ k ] = inputs[ k ].value;
							}
							saveField( art, 'seo', next, true );
							save();
							toast( 'SEO fields filled in.' );
						};
						if ( text && text.trim() ) {
							apply( text );
							return;
						}
						// No clipboard access: paste into a box instead.
						const ta = h( 'textarea', { class: 'cp-input', rows: 8, placeholder: 'Paste the answer here' } );
						const d = dialog( 'Paste the SEO answer', ta, [ h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary', onClick: () => {
							apply( ta.value );
							d.close();
						} }, 'Use it' ) ] );
						ta.focus();
					} }, icon( 'paste' ), 'Paste answer' ),
					versionsButton( art, 'seo', () => renderStep() )
				),
				row( 'title', 'SEO title' ),
				row( 'description', 'Meta description', true ),
				row( 'slug', 'Slug (web address)' ),
				row( 'keyword', 'Focus keyword' ),
				row( 'excerpt', 'Excerpt', true ),
				h( 'div', { class: 'cp-section-label' }, 'Search result preview' ),
				snippet,
				nextButton( 'export', 'Next: Copy to WordPress' ),
			] );
			save();
		},

		export( art, el ) {
			const text = finalText( art );
			const seo = seoOf( art );
			const blocks = B.markdownToBlocks( text );
			const seoText = 'SEO title: ' + seo.title + '\nMeta description: ' + seo.description + '\nSlug: ' + seo.slug + '\nFocus keyword: ' + seo.keyword + '\nExcerpt: ' + seo.excerpt;
			const prev = h( 'div', { class: 'cp-preview' } );
			prev.innerHTML = blocks; // Safe: blocks.js escapes all text; comments are ignored.
			const published = !! val( art, 'published', false );
			append( el, [
				text ? null : h( 'p', { class: 'cp-warn' }, 'There is no article text yet.' ),
				h( 'div', { class: 'cp-actions' },
					h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary cp-copy-blocks', disabled: ! text, onClick: () => copyText( blocks, 'Copied as WordPress blocks. Paste into a new post.' ) }, icon( 'copy' ), 'Copy for WordPress' ),
					h( 'button', { type: 'button', class: 'cp-btn', disabled: ! text, onClick: () => copyText( text, 'Copied as Markdown.' ) }, icon( 'copy' ), 'Copy as Markdown' ),
					h( 'button', { type: 'button', class: 'cp-btn', onClick: () => copyText( seoText, 'SEO fields copied.' ) }, icon( 'copy' ), 'Copy SEO fields' )
				),
				h( 'details', { class: 'cp-source' }, h( 'summary', null, 'How to put it into WordPress' ),
					h( 'ol', null,
						h( 'li', null, 'On your website: Posts → Add New Post.' ),
						h( 'li', null, 'Type the post title: ' + ( seo.title || val( art, 'title', '' ) || '…' ) ),
						h( 'li', null, 'Click into the empty text area below the title and paste. Headings, lists, tables, boxes and the FAQ appear as separate blocks.' ),
						h( 'li', null, 'Put the SEO title, description and slug into your SEO plugin and the excerpt into the Excerpt box, then save as draft.' )
					)
				),
				h( 'div', { class: 'cp-approve' }, published
					? [ h( 'p', { class: 'cp-ok' }, icon( 'check' ), 'Marked as published.' ), h( 'button', { type: 'button', class: 'cp-btn', onClick: () => {
						saveField( art, 'published', false, false );
						renderStep();
					} }, 'Undo' ) ]
					: h( 'button', { type: 'button', class: 'cp-btn cp-publish-btn', disabled: ! text, onClick: () => {
						saveField( art, 'published', true, false );
						renderStep();
					} }, icon( 'check' ), 'Mark as published' ) ),
				h( 'div', { class: 'cp-section-label' }, 'Preview' ),
				prev,
			] );
		},
	};

	function titleSuggestion( art, el ) {
		const box = el.querySelector( '.cp-title-suggest' );
		if ( ! box ) {
			return;
		}
		box.textContent = '';
		const t = B.titleLine( String( val( art, 'cleanup', '' ) ) );
		if ( t && t !== val( art, 'title', '' ) ) {
			box.appendChild( h( 'button', { type: 'button', class: 'cp-btn', onClick: () => {
				saveField( art, 'title', t, false );
				if ( WS.el.title ) {
					WS.el.title.value = t;
				}
				box.textContent = '';
			} }, 'Use “' + t + '” as the article title' ) );
		}
	}

	/* =========================================================
	 * Workspace screen
	 * ======================================================= */

	function rememberStep( id, step ) {
		try {
			window.localStorage.setItem( 'cp-step-' + id, step );
		} catch ( e ) {}
	}

	function firstOpenStep( art ) {
		try {
			const saved = window.localStorage.getItem( 'cp-step-' + art.id );
			if ( saved && STEPS.some( ( s ) => s.key === saved ) ) {
				return saved;
			}
		} catch ( e ) {}
		const next = STEPS.find( ( s ) => ! stepDone( art, s.key ) );
		return next ? next.key : 'export';
	}

	function openStep( key ) {
		if ( ! WS ) {
			return;
		}
		WS.step = key;
		rememberStep( WS.id, key );
		renderStep();
		refreshChrome();
		if ( WS.el.panel && WS.el.panel.getBoundingClientRect().top < 0 ) {
			WS.el.panel.scrollIntoView( { block: 'start' } );
		}
	}

	function renderStep() {
		if ( ! WS ) {
			return;
		}
		const art = S.art.get( WS.id );
		const panel = WS.el.panel;
		WS.refs = [];
		panel.textContent = '';
		const step = STEPS.find( ( s ) => s.key === WS.step ) || STEPS[ 0 ];
		panel.appendChild( h( 'h2', { class: 'cp-step__title' }, ( STEPS.indexOf( step ) + 1 ) + '. ' + step.label ) );
		panel.appendChild( h( 'p', { class: 'cp-step__hint' }, step.hint ) );
		const body = h( 'div', { class: 'cp-step__body', dataset: { step: step.key } } );
		panel.appendChild( body );
		Panels[ step.key ]( art, body );
	}

	/** Header badge and step list (cheap; safe to run while typing). */
	function refreshChrome() {
		if ( ! WS ) {
			return;
		}
		const art = S.art.get( WS.id );
		if ( ! art ) {
			return;
		}
		const stage = ( S.articles.get( art.id ) || art ).stage;
		if ( WS.el.stage ) {
			WS.el.stage.className = 'cp-badge cp-badge--status-' + stage;
			WS.el.stage.textContent = S.statuses[ stage ] || stage;
		}
		if ( WS.el.nav ) {
			WS.el.nav.querySelectorAll( 'button[data-step]' ).forEach( ( b ) => {
				const key = b.dataset.step;
				b.setAttribute( 'aria-current', key === WS.step ? 'step' : 'false' );
				b.classList.toggle( 'is-done', stepDone( art, key ) );
			} );
		}
	}

	function header( art ) {
		const title = h( 'input', { class: 'cp-art__title', type: 'text', value: val( art, 'title', '' ), placeholder: 'Article title', 'aria-label': 'Article title', maxlength: 300, onInput: ( e ) => saveField( art, 'title', e.target.value, false ) } );
		WS.el.title = title;
		WS.refs.push( { field: 'title', el: title, set: ( v ) => {
			title.value = v || '';
		}, persistent: true } );

		const siteSel = h( 'select', { class: 'cp-select cp-art__site', 'aria-label': 'Website', onChange: async ( e ) => {
			const site = parseInt( e.target.value, 10 ) || 0;
			if ( ! needOnline() ) {
				e.target.value = String( art.site );
				return;
			}
			try {
				const data = await api( 'POST', 'articles/' + art.id, { site } );
				art.site = data.article.site;
				S.articles.set( art.id, A.summaryOf( data.article ) );
				await loadSettings( art.site );
				toast( 'Website changed to ' + ( siteName( art.site ) || 'none' ) + '. Prompts now use its writing settings.' );
				renderStep();
			} catch ( err ) {
				e.target.value = String( art.site );
				reportError( err );
			}
		} },
		h( 'option', { value: '0' }, 'No website (default settings)' ),
		websiteFolders().map( ( f ) => h( 'option', { value: String( f.id ) }, f.name ) ) );
		siteSel.value = String( art.site || 0 );

		const stage = h( 'span', { class: 'cp-badge' } );
		WS.el.stage = stage;
		const note = noteOf( art );

		return h( 'div', { class: 'cp-art__head' },
			h( 'div', { class: 'cp-art__top' },
				iconBtn( 'back', 'All articles', () => go( 'articles' ) ),
				title,
				iconBtn( 'more', 'Article options', ( e ) => openMenu( e.currentTarget, [
					note && note.id ? { label: 'Open the note', icon: 'edit', run: () => A.openNote( note.id ) } : null,
					{ label: 'Writing settings of this website', icon: 'settings', run: () => go( 'site', art.site || 0 ) },
					{ label: 'Reload', icon: 'refresh', run: async () => {
						if ( needOnline() ) {
							await loadArticle( art.id ).catch( reportError );
							remount();
						}
					} },
					{ sep: true },
					{ label: 'Move to trash', icon: 'trash', danger: true, run: () => trashArticle( art ) },
				] ) )
			),
			h( 'div', { class: 'cp-art__meta' },
				siteSel,
				stage,
				note ? h( 'button', { type: 'button', class: 'cp-linkbtn', onClick: () => note.id && A.openNote( note.id ) }, 'From note: ' + ( note.title || 'Untitled note' ) ) : h( 'span', { class: 'cp-scope' }, 'The note was deleted.' )
			)
		);
	}

	async function trashArticle( art ) {
		if ( ! ( await confirmBox( 'Move to trash', 'Move the article “' + ( val( art, 'title', '' ) || 'Untitled article' ) + '” to the trash? You can restore it for 30 days.', 'Move to trash', true ) ) || ! needOnline() ) {
			return;
		}
		try {
			await A.flush();
			const data = await api( 'DELETE', 'articles/' + art.id );
			S.articles.set( art.id, data.article );
			S.art.delete( art.id );
			go( 'articles' );
			toast( 'Article moved to the trash.' );
		} catch ( err ) {
			reportError( err );
		}
	}

	Views.article = {
		render( inner, id ) {
			WS = { id, step: null, el: {}, refs: [] };
			const art = S.art.get( id );
			if ( ! art ) {
				inner.appendChild( h( 'p', { class: 'cp-empty' }, 'Loading the article…' ) );
				loadArticle( id ).then( async ( a ) => {
					await loadSettings( a.site || 0 );
					remount();
				}, ( err ) => {
					inner.textContent = '';
					inner.appendChild( h( 'div', { class: 'cp-empty' },
						h( 'p', null, isOffline( err ) ? 'This article has not been opened on this device yet, and there is no connection. Try again when you are online.' : err.message ),
						h( 'button', { type: 'button', class: 'cp-btn', onClick: () => go( 'articles' ) }, '← All articles' )
					) );
				} );
				return;
			}
			if ( ! siteCache.has( art.site || 0 ) ) {
				loadSettings( art.site || 0 ).then( () => renderStep() );
			}
			WS.step = firstOpenStep( art );
			const nav = h( 'nav', { class: 'cp-steps', 'aria-label': 'Steps' }, STEPS.map( ( s, k ) => h( 'button', { type: 'button', class: 'cp-steps__btn', dataset: { step: s.key }, onClick: () => openStep( s.key ) },
				h( 'span', { class: 'cp-steps__num' }, String( k + 1 ) ),
				h( 'span', { class: 'cp-steps__label' }, s.label )
			) ) );
			WS.el.nav = nav;
			WS.el.panel = h( 'section', { class: 'cp-step' } );
			inner.classList.add( 'cp-art' );
			append( inner, [ header( art ), h( 'div', { class: 'cp-art__body' }, nav, WS.el.panel ) ] );
			renderStep();
			refreshChrome();
		},
		update() {
			refreshChrome();
		},
	};

	// After a save: take the server's revisions and versions; show the server's text only
	// where nothing is waiting to be saved and you are not typing in that box.
	A.ArticleHooks.saved = ( server, field, conflict ) => {
		const art = S.art.get( server.id );
		if ( ! art ) {
			return;
		}
		const waiting = new Set();
		for ( const e of S.pending.values() ) {
			if ( 'article' === e.kind && e.id === server.id ) {
				waiting.add( e.field );
			}
		}
		for ( const [ name, f ] of Object.entries( server.fields ) ) {
			if ( waiting.has( name ) ) {
				const mine = art.fields[ name ] || {};
				art.fields[ name ] = Object.assign( {}, f, { value: mine.value } );
			} else {
				art.fields[ name ] = f;
			}
		}
		Object.assign( art, { stage: server.stage, site: server.site, title: server.title, modified: server.modified } );
		if ( WS && WS.id === server.id ) {
			for ( const r of WS.refs ) {
				if ( r.field === field && conflict && document.activeElement !== r.el ) {
					r.set( val( art, field, '' ) );
				}
			}
			// Version counts may have changed.
			WS.el.panel.querySelectorAll( 'button[data-versions]' ).forEach( ( b ) => {
				const n = ( fieldOf( art, b.dataset.versions ).versions || [] ).length;
				b.lastChild.textContent = 'Earlier versions' + ( n ? ' (' + n + ')' : '' );
				b.disabled = ! n;
			} );
		}
	};

	/* =========================================================
	 * Articles list
	 * ======================================================= */

	let listStage = '';

	Views.articles = {
		render( inner ) {
			const all = Array.from( S.articles.values() ).filter( ( a ) => ! a.trashed ).sort( ( a, b ) => String( b.modified ).localeCompare( String( a.modified ) ) );
			append( inner, [
				h( 'div', { class: 'cp-crumbs' }, h( 'span', null, 'Articles' ),
					h( 'span', { class: 'cp-crumbs__actions' }, h( 'button', { type: 'button', class: 'cp-btn', onClick: () => go( 'site', 0 ) }, icon( 'settings' ), 'Default writing settings' ) ) ),
				h( 'p', { class: 'cp-scope' }, 'To start an article, open a note and press “Write article”. Each website has its own writing settings (folder menu → Website writing settings).' ),
			] );
			const chips = h( 'div', { class: 'cp-filters', role: 'group', 'aria-label': 'Filter by stage' } );
			const addChip = ( value, label ) => chips.appendChild( h( 'button', { type: 'button', class: 'cp-chip', 'aria-pressed': listStage === value ? 'true' : 'false', onClick: () => {
				listStage = listStage === value ? '' : value;
				remount();
			} }, label ) );
			addChip( '', 'All (' + all.length + ')' );
			for ( const st of STAGE_ORDER ) {
				const n = all.filter( ( a ) => a.stage === st ).length;
				if ( n ) {
					addChip( st, ( S.statuses[ st ] || st ) + ' (' + n + ')' );
				}
			}
			inner.appendChild( chips );
			const shown = listStage ? all.filter( ( a ) => a.stage === listStage ) : all;
			if ( ! shown.length ) {
				inner.appendChild( h( 'div', { class: 'cp-empty' }, icon( 'article' ), h( 'p', null, all.length ? 'No articles at this stage.' : 'No articles yet.' ) ) );
				return;
			}
			inner.appendChild( h( 'ul', { class: 'cp-rows' }, shown.map( ( a ) => {
				const note = S.notes.get( A.noteKey( a.note ) );
				return h( 'li', { class: 'cp-row cp-row--link', tabindex: '0', role: 'link', onClick: () => go( 'article', a.id ), onKeydown: ( e ) => {
					if ( 'Enter' === e.key ) {
						go( 'article', a.id );
					}
				} },
				h( 'div', { class: 'cp-row__text' },
					h( 'div', { class: 'cp-row__title' }, a.title || 'Untitled article' ),
					h( 'div', { class: 'cp-row__sub' }, ( note ? 'From note “' + ( note.title || 'Untitled' ) + '” · ' : '' ) + 'edited ' + fmtDate( a.modified ) )
				),
				a.site ? h( 'span', { class: 'cp-badge cp-badge--site' }, siteName( a.site ) ) : null,
				h( 'span', { class: 'cp-badge cp-badge--status-' + a.stage }, S.statuses[ a.stage ] || a.stage ) );
			} ) ) );
		},
	};

	/* =========================================================
	 * Writing settings (per website)
	 * ======================================================= */

	Views.site = {
		render( inner, folder ) {
			const name = folder ? siteName( folder ) : '';
			inner.appendChild( h( 'div', { class: 'cp-crumbs' },
				iconBtn( 'back', 'Back', () => window.history.length > 1 ? window.history.back() : go( 'articles' ) ),
				h( 'span', null, folder ? 'Writing settings – ' + name : 'Default writing settings' ) ) );
			if ( folder && ! S.folders.has( folder ) ) {
				inner.appendChild( h( 'p', { class: 'cp-empty' }, 'That folder no longer exists.' ) );
				return;
			}
			const holder = h( 'div', { class: 'cp-settings' }, h( 'p', { class: 'cp-empty' }, 'Loading…' ) );
			inner.appendChild( holder );
			loadSettings( folder, true ).then( ( payload ) => {
				holder.textContent = '';
				if ( ! payload ) {
					holder.appendChild( h( 'p', { class: 'cp-empty' }, 'The settings can only be opened when you are online.' ) );
					return;
				}
				settingsForm( holder, folder, payload );
			} );
		},
	};

	let settingsDirty = false;
	window.addEventListener( 'beforeunload', ( e ) => {
		if ( settingsDirty && document.querySelector( '.cp-settings' ) ) {
			e.preventDefault();
			e.returnValue = '';
		}
	} );

	function settingsForm( holder, folder, payload ) {
		const st = clone( payload.settings );
		settingsDirty = false;
		const status = h( 'span', { class: 'cp-scope cp-settings__status' } );
		const markDirty = () => {
			settingsDirty = true;
			status.textContent = 'Unsaved changes';
			status.classList.add( 'is-dirty' );
		};
		const text = ( key, label, rows, help ) => {
			const el = rows ? h( 'textarea', { class: 'cp-input', rows } ) : h( 'input', { class: 'cp-input', type: 'text' } );
			el.value = st[ key ] || '';
			el.dataset.setting = key;
			el.addEventListener( 'input', () => {
				st[ key ] = el.value;
				markDirty();
			} );
			return h( 'label', { class: 'cp-field' }, h( 'span', null, label ), el, help ? h( 'small', { class: 'cp-scope' }, help ) : null );
		};

		const words = h( 'input', { class: 'cp-input', type: 'number', min: 200, max: 10000, step: 100, value: st.words } );
		words.dataset.setting = 'words';
		words.addEventListener( 'input', () => {
			st.words = parseInt( words.value, 10 ) || 1200;
			markDirty();
		} );

		const boxes = h( 'div', { class: 'cp-boxes' }, Object.entries( payload.boxes ).map( ( [ key, label ] ) => {
			const cb = h( 'input', { type: 'checkbox', checked: st.boxes.includes( key ) } );
			cb.dataset.box = key;
			cb.addEventListener( 'change', () => {
				st.boxes = cb.checked ? Array.from( new Set( st.boxes.concat( key ) ) ) : st.boxes.filter( ( b ) => b !== key );
				markDirty();
			} );
			return h( 'label', { class: 'cp-check-row' }, cb, label );
		} ) );

		const styleField = text( 'style', 'Style guide', 10, 'Rules every prompt includes for this website. Write them yourself, or create them from example articles below.' );
		const styleArea = styleField.querySelector( 'textarea' );

		const examplesBox = h( 'div', { class: 'cp-examples' } );
		const drawExamples = () => {
			examplesBox.textContent = '';
			st.examples.forEach( ( ex, k ) => {
				const t = h( 'input', { class: 'cp-input', type: 'text', value: ex.title, placeholder: 'Title (optional)', 'aria-label': 'Example title' } );
				const body = h( 'textarea', { class: 'cp-input', rows: 6, placeholder: 'Paste the article text here', 'aria-label': 'Example text' } );
				body.value = ex.text;
				t.addEventListener( 'input', () => {
					st.examples[ k ].title = t.value;
					markDirty();
				} );
				body.addEventListener( 'input', () => {
					st.examples[ k ].text = body.value;
					markDirty();
					count.textContent = B.words( body.value ) + ' words';
				} );
				const count = h( 'small', { class: 'cp-scope' }, B.words( ex.text ) + ' words' );
				examplesBox.appendChild( h( 'div', { class: 'cp-example' },
					h( 'div', { class: 'cp-example__head' }, h( 'strong', null, 'Example ' + ( k + 1 ) ), count, iconBtn( 'close', 'Remove example', () => {
						st.examples.splice( k, 1 );
						markDirty();
						drawExamples();
					} ) ),
					t, body ) );
			} );
			if ( st.examples.length < 8 ) {
				examplesBox.appendChild( h( 'button', { type: 'button', class: 'cp-btn', onClick: () => {
					st.examples.push( { title: '', text: '' } );
					markDirty();
					drawExamples();
				} }, icon( 'plus' ), 'Add an example article' ) );
			}
		};
		drawExamples();

		const styleguidePrompt = () => {
			const filled = st.examples.filter( ( e ) => e.text && e.text.trim() );
			if ( ! filled.length ) {
				toast( 'Add at least one example article first.' );
				return;
			}
			const tpl = ( st.prompts && st.prompts.styleguide ) || payload.default_prompts.styleguide;
			const prompt = B.fill( tpl, {
				site: folder ? siteName( folder ) : 'my website',
				examples: filled.map( ( e, k ) => '### Example ' + ( k + 1 ) + ( e.title ? ': ' + e.title : '' ) + '\n' + e.text.trim().split( /\s+/ ).slice( 0, 1500 ).join( ' ' ) ).join( '\n\n' ),
			} );
			promptDialog( 'Prompt: style guide from examples', prompt );
		};

		// Prompts (advanced).
		const prompts = h( 'details', { class: 'cp-source' }, h( 'summary', null, 'Prompts (advanced)' ),
			h( 'p', { class: 'cp-scope' }, 'Change a prompt for this website, or leave it as it is. Placeholders in {{double braces}} are filled in automatically: {{context}} (website, audience, language, tone, style guide, example), {{note}}, {{cleanup}}, {{title}}, {{outline}}, {{heading}}, {{brief}}, {{section_words}}, {{previous}}, {{draft}}, {{article}}, {{words}}, {{banned}}, {{boxes_rule}}, {{faq_rule}}, {{site}}, {{examples}}.' ),
			Object.entries( payload.steps ).map( ( [ step, label ] ) => {
				const area = h( 'textarea', { class: 'cp-input cp-prompt-edit', rows: 10 } );
				area.dataset.prompt = step;
				area.value = ( st.prompts && st.prompts[ step ] ) || payload.default_prompts[ step ];
				const changed = h( 'small', { class: 'cp-scope' } );
				const mark = () => {
					changed.textContent = st.prompts[ step ] ? 'Changed for this website' : 'Default prompt';
				};
				area.addEventListener( 'input', () => {
					st.prompts = st.prompts || {};
					if ( area.value.trim() === payload.default_prompts[ step ].trim() ) {
						delete st.prompts[ step ];
					} else {
						st.prompts[ step ] = area.value;
					}
					mark();
					markDirty();
				} );
				mark();
				return h( 'div', { class: 'cp-field' }, h( 'span', null, label ), area, h( 'div', { class: 'cp-actions' }, changed, h( 'button', { type: 'button', class: 'cp-btn', onClick: () => {
					area.value = payload.default_prompts[ step ];
					delete st.prompts[ step ];
					mark();
					markDirty();
				} }, 'Reset to default' ) ) );
			} ) );

		const save = async () => {
			if ( ! needOnline() ) {
				return;
			}
			try {
				const data = await api( 'POST', 'sites/' + folder, { settings: st, base_rev: payload.settings.rev } );
				siteCache.set( folder, data );
				payload.settings = data.settings;
				Object.assign( st, clone( data.settings ) );
				settingsDirty = false;
				status.textContent = 'Saved ✓';
				status.classList.remove( 'is-dirty' );
				toast( 'Writing settings saved.' );
			} catch ( err ) {
				if ( 'cp_settings_changed' === err.code ) {
					toast( err.message, { label: 'Reload', run: () => remount() }, 12000 );
				} else {
					reportError( err );
				}
			}
		};

		append( holder, [
			h( 'p', { class: 'cp-scope' }, folder
				? 'Used for every article whose website is “' + siteName( folder ) + '”.'
				: 'Used for articles that have no website. New website folders start from the built-in values.' ),
			h( 'div', { class: 'cp-card cp-settings__group' },
				h( 'h3', null, 'Audience and voice' ),
				text( 'audience', 'Who reads this website', 2, 'For example: Freshers and graduates in India looking for their first job.' ),
				text( 'language', 'Language' ),
				text( 'tone', 'Tone', 2, 'For example: Friendly, encouraging, practical; no jargon.' ),
				h( 'label', { class: 'cp-field' }, h( 'span', null, 'Article length (words)' ), words )
			),
			h( 'div', { class: 'cp-card cp-settings__group' },
				h( 'h3', null, 'Boxes the AI may use' ),
				h( 'p', { class: 'cp-scope' }, 'They become Blog Kit boxes when you copy the article to WordPress.' ),
				boxes
			),
			h( 'div', { class: 'cp-card cp-settings__group' },
				h( 'h3', null, 'Phrases to avoid' ),
				text( 'banned', 'One per line. The prompts ask the AI to avoid them, and Check warns when they appear.', 8 )
			),
			h( 'div', { class: 'cp-card cp-settings__group' },
				h( 'h3', null, 'Example articles' ),
				h( 'p', { class: 'cp-scope' }, 'Paste 3–5 articles whose style you like (your own, or others only as style examples). A short piece of the first one goes into every prompt, and they are used to create the style guide.' ),
				examplesBox
			),
			h( 'div', { class: 'cp-card cp-settings__group' },
				h( 'h3', null, 'Style guide' ),
				h( 'div', { class: 'cp-actions' },
					h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary', onClick: styleguidePrompt }, icon( 'copy' ), 'Create style guide from examples' ),
					h( 'button', { type: 'button', class: 'cp-btn', onClick: async () => {
						let t = null;
						try {
							t = navigator.clipboard && window.isSecureContext ? await navigator.clipboard.readText() : null;
						} catch ( e ) {}
						if ( t && t.trim() ) {
							styleArea.value = t;
							st.style = t;
							markDirty();
							toast( 'Style guide pasted. Press Save.' );
						} else {
							toast( 'Could not read the clipboard here. Long-press in the Style guide box and choose Paste.' );
							styleArea.focus();
						}
					} }, icon( 'paste' ), 'Paste answer' )
				),
				styleField
			),
			prompts,
			h( 'div', { class: 'cp-settings__save' }, status, h( 'button', { type: 'button', class: 'cp-btn cp-btn--primary cp-save-settings', onClick: save }, 'Save settings' ) ),
		] );
	}
}() );
