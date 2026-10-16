/**
 * Content Pipeline Hub — notes app.
 *
 * Plain JavaScript, no build step. All user text is put on the page with textContent
 * (never innerHTML), so notes can contain anything.
 *
 * Saving: every change is kept in this browser (localStorage) until the server confirms it.
 * If the connection drops, the app keeps working and sends the changes when it is back.
 */
( function () {
	'use strict';

	const C = window.CP_APP;
	const root = document.getElementById( 'cp-root' );
	if ( ! C || ! root ) {
		return;
	}

	/* =========================================================
	 * Small helpers
	 * ======================================================= */

	const ICONS = {
		menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
		close: '<path d="M18 6 6 18M6 6l12 12"/>',
		back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
		pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 4H7l3-4z"/>',
		more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
		folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
		folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
		folderMove: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 13h6m-2-2 2 2-2 2"/>',
		inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
		all: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
		trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
		restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
		history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
		image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		list: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
		chevron: '<path d="m9 6 6 6-6 6"/>',
		logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
		dashboard: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
		bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
		edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
		globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
		refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
		shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
	};

	function icon( name ) {
		const svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
		svg.setAttribute( 'viewBox', '0 0 24 24' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.innerHTML = ICONS[ name ] || ''; // Static, trusted markup only.
		return svg;
	}

	/**
	 * Create an element. Text children become text nodes (safe for any user text).
	 *
	 * @param {string} tag
	 * @param {Object} [attrs]
	 * @param {...*}   kids
	 * @return {HTMLElement} Element.
	 */
	function h( tag, attrs, ...kids ) {
		const el = document.createElement( tag );
		if ( attrs ) {
			for ( const [ k, v ] of Object.entries( attrs ) ) {
				if ( null === v || undefined === v || false === v ) {
					continue;
				}
				if ( k.startsWith( 'on' ) && 'function' === typeof v ) {
					el.addEventListener( k.slice( 2 ).toLowerCase(), v );
				} else if ( 'class' === k ) {
					el.className = v;
				} else if ( 'dataset' === k ) {
					Object.assign( el.dataset, v );
				} else if ( 'value' === k ) {
					el.value = v;
				} else if ( 'checked' === k || 'disabled' === k || 'hidden' === k || 'multiple' === k ) {
					el[ k ] = !! v;
				} else if ( true === v ) {
					el.setAttribute( k, '' );
				} else {
					el.setAttribute( k, String( v ) );
				}
			}
		}
		append( el, kids );
		return el;
	}

	function append( el, kids ) {
		for ( const kid of kids ) {
			if ( null === kid || undefined === kid || false === kid ) {
				continue;
			}
			if ( Array.isArray( kid ) ) {
				append( el, kid );
			} else if ( kid instanceof Node ) {
				el.appendChild( kid );
			} else {
				el.appendChild( document.createTextNode( String( kid ) ) );
			}
		}
	}

	function iconBtn( name, label, onClick, extra ) {
		return h( 'button', Object.assign( { type: 'button', class: 'cp-icon-btn', 'aria-label': label, title: label, onClick }, extra || {} ), icon( name ) );
	}

	function uid() {
		const a = new Uint8Array( 12 );
		( window.crypto || window.msCrypto ).getRandomValues( a );
		return Array.from( a, ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	}

	function clone( v ) {
		return JSON.parse( JSON.stringify( v ) );
	}

	function nowIso() {
		return new Date().toISOString();
	}

	function fmtDate( iso ) {
		if ( ! iso ) {
			return '';
		}
		const d = new Date( iso );
		const diff = ( Date.now() - d.getTime() ) / 1000;
		if ( diff < 60 ) {
			return 'just now';
		}
		if ( diff < 3600 ) {
			return Math.floor( diff / 60 ) + ' min ago';
		}
		if ( diff < 86400 && d.getDate() === new Date().getDate() ) {
			return 'today ' + d.toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } );
		}
		const sameYear = d.getFullYear() === new Date().getFullYear();
		return d.toLocaleDateString( [], sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' } );
	}

	function fmtFull( iso ) {
		return iso ? new Date( iso ).toLocaleString( [], { dateStyle: 'medium', timeStyle: 'short' } ) : '';
	}

	/* =========================================================
	 * State
	 * ======================================================= */

	const S = {
		folders: new Map(),
		notes: new Map(),
		inbox: 0,
		statuses: {},
		view: { mode: 'folder', folder: 0, q: '', scope: 'all', status: '' },
		expanded: new Set(),
		pending: new Map(),
		sync: { state: 'saved', flushing: false, nonce: C.nonce, lastRefresh: Date.now() },
		editorKey: null,
		trash: null,
	};

	function noteKey( id ) {
		return 'n' + id;
	}

	function loadServerState( state ) {
		S.inbox = state.inbox;
		S.statuses = state.statuses || S.statuses;
		setFolders( state.folders );
		const fresh = new Map();
		for ( const n of state.notes ) {
			const key = noteKey( n.id );
			fresh.set( key, Object.assign( { key }, n ) );
		}
		// Keep notes that only exist on this device, and changes not yet saved.
		for ( const [ key, entry ] of S.pending ) {
			if ( entry.create ) {
				const local = S.notes.get( key ) || noteFromEntry( entry );
				fresh.set( key, local );
			} else if ( fresh.has( key ) ) {
				Object.assign( fresh.get( key ), clone( entry.fields ) );
			}
		}
		S.notes = fresh;
		if ( S.view.mode === 'folder' && ! S.folders.has( S.view.folder ) ) {
			S.view.folder = S.inbox;
		}
	}

	function setFolders( list ) {
		S.folders = new Map( list.map( ( f ) => [ f.id, f ] ) );
	}

	function childrenOf( parent ) {
		const kids = [];
		for ( const f of S.folders.values() ) {
			if ( f.parent === parent ) {
				kids.push( f );
			}
		}
		kids.sort( ( a, b ) => {
			if ( a.id === S.inbox ) {
				return -1;
			}
			if ( b.id === S.inbox ) {
				return 1;
			}
			return a.name.localeCompare( b.name, undefined, { sensitivity: 'base', numeric: true } );
		} );
		return kids;
	}

	function ancestors( id ) {
		const chain = [];
		let f = S.folders.get( id );
		let guard = 0;
		while ( f && guard++ < 100 ) {
			chain.unshift( f );
			f = S.folders.get( f.parent );
		}
		return chain;
	}

	function descendants( id ) {
		const out = new Set();
		const walk = ( p ) => {
			for ( const k of childrenOf( p ) ) {
				out.add( k.id );
				walk( k.id );
			}
		};
		walk( id );
		return out;
	}

	function folderPath( id ) {
		return ancestors( id ).map( ( f ) => f.name ).join( ' › ' );
	}

	function siteOf( folderId ) {
		const chain = ancestors( folderId );
		for ( let i = chain.length - 1; i >= 0; i-- ) {
			if ( chain[ i ].is_site ) {
				return chain[ i ];
			}
		}
		return null;
	}

	function countIn( folderId ) {
		const ids = descendants( folderId );
		ids.add( folderId );
		let n = 0;
		for ( const note of S.notes.values() ) {
			if ( ids.has( note.folder ) ) {
				n++;
			}
		}
		return n;
	}

	function isEmptyNote( n ) {
		return ! n.title.trim() && ! n.body.trim() && ! n.checklist.some( ( i ) => i.t.trim() ) && ! ( n.files && n.files.length );
	}

	/* =========================================================
	 * Pending changes (kept in this browser until saved)
	 * ======================================================= */

	const TEXT_FIELDS = [ 'title', 'body', 'checklist' ];

	function noteFromEntry( entry ) {
		const f = entry.fields;
		return {
			key: entry.key,
			id: null,
			client_id: entry.client_id,
			title: f.title || '',
			body: f.body || '',
			checklist: f.checklist || [],
			folder: f.folder || S.inbox,
			status: f.status || 'idea',
			pinned: !! f.pinned,
			version: 1,
			created: entry.created || nowIso(),
			modified: entry.modified || nowIso(),
			files: [],
			local: true,
		};
	}

	function persist() {
		try {
			const data = { v: 1, pending: Array.from( S.pending.values() ) };
			window.localStorage.setItem( C.storageKey, JSON.stringify( data ) );
		} catch ( e ) {
			setSync( 'error', 'This browser could not keep a safety copy (storage full?).' );
		}
	}

	function restorePending() {
		try {
			const raw = window.localStorage.getItem( C.storageKey );
			if ( ! raw ) {
				return;
			}
			const data = JSON.parse( raw );
			for ( const entry of data.pending || [] ) {
				if ( entry && entry.key && entry.fields ) {
					S.pending.set( entry.key, entry );
				}
			}
		} catch ( e ) {
			// Nothing stored, or unreadable: start clean.
		}
	}

	/**
	 * Record a change to a note and schedule saving.
	 *
	 * @param {string} key    Note key.
	 * @param {Object} fields Changed fields.
	 */
	function change( key, fields ) {
		const note = S.notes.get( key );
		if ( ! note ) {
			return;
		}
		Object.assign( note, clone( fields ) );
		note.modified = nowIso();

		let entry = S.pending.get( key );
		if ( ! entry ) {
			entry = note.local
				? { key, create: true, client_id: note.client_id, fields: {}, rev: 0, created: note.created }
				: { key, create: false, id: note.id, fields: {}, base: null, rev: 0 };
			if ( note.local ) {
				Object.assign( entry.fields, { title: note.title, body: note.body, checklist: note.checklist, folder: note.folder, status: note.status, pinned: note.pinned } );
			}
			S.pending.set( key, entry );
		}
		Object.assign( entry.fields, clone( fields ) );
		if ( ! entry.create && null === entry.base && TEXT_FIELDS.some( ( f ) => f in fields ) ) {
			entry.base = note.version;
		}
		entry.rev++;
		entry.modified = note.modified;
		persist();
		scheduleFlush();
	}

	let flushTimer = 0;
	function scheduleFlush( delay ) {
		// Keep "Offline" / "Logged out" visible until a save actually works.
		if ( 'offline' !== S.sync.state && 'login' !== S.sync.state ) {
			setSync( 'saving' );
		}
		window.clearTimeout( flushTimer );
		flushTimer = window.setTimeout( flush, undefined === delay ? 700 : delay );
	}

	/* =========================================================
	 * Server calls
	 * ======================================================= */

	class ApiError extends Error {
		constructor( status, code, message ) {
			super( message || code || 'Error ' + status );
			this.status = status;
			this.code = code || '';
		}
	}

	function restUrl( path, query ) {
		let url = C.rest + path;
		if ( query ) {
			url += ( url.includes( '?' ) ? '&' : '?' ) + new URLSearchParams( query ).toString();
		}
		return url;
	}

	async function refreshNonce() {
		const res = await fetch( C.nonceUrl, { credentials: 'same-origin', cache: 'no-store' } );
		const text = ( await res.text() ).trim();
		if ( ! res.ok || ! /^[a-f0-9]{10}$/.test( text ) ) {
			throw new ApiError( 401, 'cp_login_required', 'Logged out' );
		}
		S.sync.nonce = text;
	}

	/**
	 * Call the API. Throws ApiError (HTTP problem) or TypeError (no connection).
	 *
	 * @param {string} method
	 * @param {string} path
	 * @param {*}      [body]  JSON body, or FormData.
	 * @param {Object} [query]
	 * @param {boolean} [retried]
	 * @return {Promise<Object>} Response data.
	 */
	async function api( method, path, body, query, retried ) {
		const headers = { 'X-WP-Nonce': S.sync.nonce };
		const isForm = body instanceof FormData;
		if ( body && ! isForm ) {
			headers[ 'Content-Type' ] = 'application/json';
		}
		const res = await fetch( restUrl( path, query ), {
			method,
			headers,
			credentials: 'same-origin',
			cache: 'no-store',
			body: body ? ( isForm ? body : JSON.stringify( body ) ) : undefined,
		} );
		let data = null;
		try {
			data = await res.json();
		} catch ( e ) {
			data = null;
		}
		if ( res.ok ) {
			return data;
		}
		const code = data && data.code ? data.code : '';
		if ( ! retried && 'rest_cookie_invalid_nonce' === code ) {
			await refreshNonce();
			return api( method, path, body, query, true );
		}
		throw new ApiError( res.status, code, data && data.message );
	}

	function isLoginError( err ) {
		return err instanceof ApiError && ( 401 === err.status || 'rest_cookie_invalid_nonce' === err.code || 'cp_login_required' === err.code || 'rest_not_logged_in' === err.code );
	}

	function isOffline( err ) {
		return ! ( err instanceof ApiError );
	}

	/* =========================================================
	 * Saving (the queue)
	 * ======================================================= */

	async function flush() {
		if ( S.sync.flushing ) {
			return;
		}
		if ( ! S.pending.size ) {
			setSync( 'saved' );
			return;
		}
		if ( false === navigator.onLine ) {
			setSync( 'offline' );
			return;
		}
		S.sync.flushing = true;
		setSync( 'saving' );
		try {
			for ( const key of Array.from( S.pending.keys() ) ) {
				await flushOne( key );
			}
			setSync( S.pending.size ? 'saving' : 'saved' );
			if ( S.pending.size ) {
				scheduleFlush( 300 );
			}
		} catch ( err ) {
			if ( isLoginError( err ) ) {
				setSync( 'login' );
			} else if ( isOffline( err ) ) {
				setSync( 'offline' );
			} else {
				setSync( 'error', err.message );
			}
		} finally {
			S.sync.flushing = false;
		}
	}

	/**
	 * Save one note. Network and login errors are thrown (the queue stops and retries later);
	 * other problems are handled here so one bad note never blocks the rest.
	 *
	 * @param {string} key
	 */
	async function flushOne( key ) {
		const entry = S.pending.get( key );
		if ( ! entry ) {
			return;
		}
		const sentRev = entry.rev;
		const fields = clone( entry.fields );

		let data;
		try {
			if ( entry.create ) {
				data = await api( 'POST', 'notes', Object.assign( { client_id: entry.client_id }, fields ) );
			} else {
				const body = Object.assign( {}, fields );
				if ( TEXT_FIELDS.some( ( f ) => f in body ) ) {
					body.base_version = null === entry.base ? ( S.notes.get( key ) || {} ).version || 1 : entry.base;
				}
				data = await api( 'POST', 'notes/' + entry.id, body );
			}
		} catch ( err ) {
			if ( isLoginError( err ) || isOffline( err ) || err.status >= 500 ) {
				throw err;
			}
			if ( ! entry.create && ( 'cp_note_missing' === err.code || 'cp_note_trashed' === err.code ) ) {
				// Deleted or trashed on another device: keep this text as a new note.
				saveAsNewNote( key, 'cp_note_trashed' === err.code ? 'This note was moved to the trash on another device. Your changes were saved as a new note.' : 'This note was deleted on another device. Your changes were saved as a new note.' );
				return;
			}
			if ( 'cp_folder_missing' === err.code ) {
				delete entry.fields.folder;
				const n = S.notes.get( key );
				if ( n ) {
					n.folder = S.inbox;
				}
				if ( entry.create ) {
					entry.fields.folder = S.inbox;
				}
				persist();
				return;
			}
			S.pending.delete( key );
			persist();
			toast( 'A change could not be saved: ' + err.message );
			return;
		}

		const serverNote = data.note;
		let current = S.pending.get( key );

		if ( entry.create && false === data.created ) {
			// The note was already created by an earlier try: send the text as an update.
			current.create = false;
			current.id = serverNote.id;
			current.base = serverNote.version;
			rekey( key, serverNote );
			persist();
			return;
		}

		if ( data.conflict ) {
			handleConflict( key, serverNote, data.copy );
			return;
		}

		const newKey = rekey( key, serverNote );
		current = S.pending.get( newKey );
		if ( current && current.rev === sentRev ) {
			S.pending.delete( newKey );
		} else if ( current ) {
			current.create = false;
			current.id = serverNote.id;
			current.base = serverNote.version;
		}
		persist();
		renderLight();
	}

	/**
	 * Replace a local note with the server copy, keeping unsaved local edits on top.
	 *
	 * @param {string} key
	 * @param {Object} serverNote
	 * @return {string} The note's key from now on.
	 */
	function rekey( key, serverNote ) {
		const newKey = noteKey( serverNote.id );
		const entry = S.pending.get( key );
		const local = S.notes.get( key );
		const merged = Object.assign( { key: newKey }, serverNote );
		if ( entry && local && entry.rev ) {
			// Newer typing than what the server has: keep showing it.
			for ( const f of Object.keys( entry.fields ) ) {
				merged[ f ] = local[ f ];
			}
		}
		if ( newKey !== key ) {
			S.notes.delete( key );
			if ( entry ) {
				S.pending.delete( key );
				entry.key = newKey;
				S.pending.set( newKey, entry );
			}
			if ( S.editorKey === key ) {
				S.editorKey = newKey;
			}
		}
		S.notes.set( newKey, merged );
		return newKey;
	}

	function handleConflict( key, serverNote, copy ) {
		S.pending.delete( key );
		const newKey = noteKey( serverNote.id );
		S.notes.delete( key );
		S.notes.set( newKey, Object.assign( { key: newKey }, serverNote ) );
		let copyKey = null;
		if ( copy ) {
			copyKey = noteKey( copy.id );
			S.notes.set( copyKey, Object.assign( { key: copyKey }, copy ) );
		}
		persist();
		if ( copyKey && ( S.editorKey === key || S.editorKey === newKey ) ) {
			// Keep typing in the copy; bring over anything typed after the save was sent.
			const typed = editorValues();
			S.editorKey = copyKey;
			const c = S.notes.get( copyKey );
			if ( typed ) {
				// The copy keeps its "(conflict copy)" title so the two notes are easy to tell apart.
				typed.title = c.title;
				if ( typed.body !== c.body || JSON.stringify( typed.checklist ) !== JSON.stringify( c.checklist ) ) {
					change( copyKey, typed );
				}
			}
			Editor.reload();
		}
		render();
		toast( 'This note was changed on another device. Nothing was overwritten: your version is saved as “' + ( copy ? copy.title : '' ) + '”.', null, 9000 );
	}

	function saveAsNewNote( key, message ) {
		const note = S.notes.get( key );
		S.pending.delete( key );
		S.notes.delete( key );
		if ( ! note ) {
			persist();
			return;
		}
		const cid = uid();
		const fresh = Object.assign( {}, note, { key: 'c_' + cid, id: null, client_id: cid, local: true, version: 1, files: [], folder: S.folders.has( note.folder ) ? note.folder : S.inbox } );
		S.notes.set( fresh.key, fresh );
		S.pending.set( fresh.key, { key: fresh.key, create: true, client_id: cid, rev: 1, created: nowIso(), fields: { title: fresh.title, body: fresh.body, checklist: fresh.checklist, folder: fresh.folder, status: fresh.status, pinned: fresh.pinned } } );
		if ( S.editorKey === key ) {
			S.editorKey = fresh.key;
		}
		persist();
		render();
		toast( message, null, 9000 );
	}

	async function refreshFromServer() {
		if ( false === navigator.onLine ) {
			return;
		}
		try {
			const state = await api( 'GET', 'state' );
			S.sync.lastRefresh = Date.now();
			const openKey = S.editorKey;
			const before = openKey ? JSON.stringify( pickText( S.notes.get( openKey ) ) ) : '';
			loadServerState( state );
			if ( openKey && ! S.notes.has( openKey ) ) {
				Editor.close( true );
			} else if ( openKey && ! S.pending.has( openKey ) && before !== JSON.stringify( pickText( S.notes.get( openKey ) ) ) ) {
				Editor.reload();
			}
			render();
			if ( 'login' === S.sync.state ) {
				setSync( S.pending.size ? 'saving' : 'saved' );
			}
			if ( S.pending.size ) {
				flush();
			}
		} catch ( err ) {
			if ( isLoginError( err ) ) {
				setSync( 'login' );
			}
		}
	}

	function pickText( n ) {
		return n ? { title: n.title, body: n.body, checklist: n.checklist, folder: n.folder, status: n.status, pinned: n.pinned, files: ( n.files || [] ).map( ( f ) => f.id ) } : null;
	}

	/* =========================================================
	 * Sync indicator
	 * ======================================================= */

	const SYNC_TEXT = {
		saved: 'All changes saved',
		saving: 'Saving…',
		offline: 'Offline – changes kept on this device',
		login: 'Logged out – changes kept on this device',
		error: 'Not saved yet – retrying',
	};

	function setSync( state, detail ) {
		if ( 'saving' === state && ! S.pending.size && ! S.sync.flushing ) {
			state = 'saved';
		}
		S.sync.state = state;
		S.sync.detail = detail || '';
		const el = document.getElementById( 'cp-sync' );
		if ( el ) {
			el.dataset.state = state;
			el.title = SYNC_TEXT[ state ] + ( detail ? ' (' + detail + ')' : '' );
			el.querySelector( '.cp-sync__text' ).textContent = SYNC_TEXT[ state ];
		}
		const banner = document.getElementById( 'cp-login-banner' );
		if ( banner ) {
			banner.hidden = 'login' !== state;
		}
		Editor.syncText();
	}

	/* =========================================================
	 * Menus, dialogs, toasts
	 * ======================================================= */

	let openMenuEl = null;
	function closeMenu() {
		if ( openMenuEl ) {
			openMenuEl.remove();
			openMenuEl = null;
			document.removeEventListener( 'pointerdown', onMenuOutside, true );
			document.removeEventListener( 'keydown', onMenuKey, true );
		}
	}
	function onMenuOutside( e ) {
		if ( openMenuEl && ! openMenuEl.contains( e.target ) ) {
			closeMenu();
		}
	}
	function onMenuKey( e ) {
		if ( 'Escape' === e.key ) {
			e.stopPropagation();
			closeMenu();
		}
	}

	/**
	 * @param {HTMLElement} anchor
	 * @param {Array} items {label, icon, run, href, danger, sep}
	 */
	function openMenu( anchor, items ) {
		closeMenu();
		const host = anchor.closest( 'dialog' ) || document.body;
		const menu = h( 'div', { class: 'cp-menu', role: 'menu' } );
		for ( const it of items ) {
			if ( ! it ) {
				continue;
			}
			if ( it.sep ) {
				menu.appendChild( h( 'hr' ) );
				continue;
			}
			const kids = [ it.icon ? icon( it.icon ) : null, it.label ];
			const el = it.href
				? h( 'a', { href: it.href, role: 'menuitem', class: it.danger ? 'is-danger' : null, target: it.target || null }, kids )
				: h( 'button', { type: 'button', role: 'menuitem', class: it.danger ? 'is-danger' : null, onClick: () => {
					closeMenu();
					it.run();
				} }, kids );
			menu.appendChild( el );
		}
		host.appendChild( menu );
		const r = anchor.getBoundingClientRect();
		const mw = menu.offsetWidth;
		const mh = menu.offsetHeight;
		let left = Math.min( r.right - mw, window.innerWidth - mw - 8 );
		left = Math.max( 8, left );
		let top = r.bottom + 4;
		if ( top + mh > window.innerHeight - 8 ) {
			top = Math.max( 8, r.top - mh - 4 );
		}
		menu.style.left = left + 'px';
		menu.style.top = top + 'px';
		openMenuEl = menu;
		const first = menu.querySelector( 'button, a' );
		if ( first ) {
			first.focus();
		}
		document.addEventListener( 'pointerdown', onMenuOutside, true );
		document.addEventListener( 'keydown', onMenuKey, true );
	}

	function dialog( title, body, foot, cls ) {
		const d = h( 'dialog', { class: 'cp-dialog cp-dialog--small ' + ( cls || '' ) } );
		const head = h( 'div', { class: 'cp-dialog__head' }, h( 'h2', { class: 'cp-dialog__title' }, title ), iconBtn( 'close', 'Close', () => d.close() ) );
		append( d, [ head, h( 'div', { class: 'cp-dialog__body' }, body ), foot ? h( 'div', { class: 'cp-dialog__foot' }, foot ) : null ] );
		d.addEventListener( 'close', () => window.setTimeout( () => d.remove(), 0 ) );
		document.body.appendChild( d );
		d.showModal();
		return d;
	}

	function ask( title, label, value, okLabel ) {
		return new Promise( ( resolve ) => {
			let done = false;
			const input = h( 'input', { class: 'cp-input', type: 'text', value: value || '', maxlength: 100, 'aria-label': label } );
			const ok = h( 'button', { type: 'submit', class: 'cp-btn cp-btn--primary' }, okLabel || 'Save' );
			const cancel = h( 'button', { type: 'button', class: 'cp-btn' }, 'Cancel' );
			const form = h( 'form', { onSubmit: ( e ) => {
				e.preventDefault();
				done = true;
				resolve( input.value.trim() || null );
				d.close();
			} }, h( 'label', { class: 'cp-field' }, h( 'span', null, label ), input ), h( 'div', { class: 'cp-dialog__foot', style: 'padding:0;border:0' }, cancel, ok ) );
			const d = dialog( title, form );
			cancel.addEventListener( 'click', () => d.close() );
			d.addEventListener( 'close', () => {
				if ( ! done ) {
					resolve( null );
				}
			} );
			input.focus();
			input.select();
		} );
	}

	function confirmBox( title, text, okLabel, danger ) {
		return new Promise( ( resolve ) => {
			let done = false;
			const ok = h( 'button', { type: 'button', class: 'cp-btn ' + ( danger ? 'cp-btn--primary' : 'cp-btn--primary' ) }, okLabel );
			const cancel = h( 'button', { type: 'button', class: 'cp-btn' }, 'Cancel' );
			const d = dialog( title, h( 'p', { style: 'margin:0' }, text ), [ cancel, ok ] );
			cancel.addEventListener( 'click', () => d.close() );
			ok.addEventListener( 'click', () => {
				done = true;
				resolve( true );
				d.close();
			} );
			d.addEventListener( 'close', () => {
				if ( ! done ) {
					resolve( false );
				}
			} );
			ok.focus();
		} );
	}

	/**
	 * Pick a folder.
	 *
	 * @param {string} title
	 * @param {number} current Selected folder.
	 * @param {Set}    blocked Folders that cannot be chosen.
	 * @param {boolean} allowTop Offer "Top level".
	 * @return {Promise<number|null>} Folder id (0 = top level) or null.
	 */
	function pickFolder( title, current, blocked, allowTop ) {
		return new Promise( ( resolve ) => {
			let done = false;
			const list = h( 'ul', { class: 'cp-picker' } );
			const choose = ( id ) => {
				done = true;
				resolve( id );
				d.close();
			};
			if ( allowTop ) {
				list.appendChild( h( 'li', null, h( 'button', { type: 'button', 'aria-pressed': 0 === current ? 'true' : 'false', onClick: () => choose( 0 ) }, icon( 'all' ), 'Top level' ) ) );
			}
			const walk = ( parent, depth ) => {
				for ( const f of childrenOf( parent ) ) {
					const isBlocked = blocked && blocked.has( f.id );
					list.appendChild( h( 'li', null, h( 'button', {
						type: 'button',
						style: 'padding-left:' + ( 10 + depth * 18 ) + 'px',
						'aria-pressed': f.id === current ? 'true' : 'false',
						disabled: isBlocked,
						onClick: () => choose( f.id ),
					}, icon( f.id === S.inbox ? 'inbox' : 'folder' ), f.name ) ) );
					walk( f.id, depth + 1 );
				}
			};
			walk( 0, 0 );
			const newBtn = h( 'button', { type: 'button', class: 'cp-btn', onClick: async () => {
				const parent = current && S.folders.has( current ) ? current : 0;
				const name = await ask( 'New folder', 'Folder name' + ( parent ? ' (inside ' + S.folders.get( parent ).name + ')' : '' ), '', 'Create' );
				if ( name ) {
					const id = await createFolder( name, parent );
					if ( id ) {
						choose( id );
					}
				}
			} }, icon( 'folderPlus' ), 'New folder' );
			const d = dialog( title, list, [ newBtn ] );
			d.addEventListener( 'close', () => {
				if ( ! done ) {
					resolve( null );
				}
			} );
		} );
	}

	let toastTimer = 0;
	function toast( message, action, ms ) {
		const old = document.querySelector( '.cp-toast' );
		if ( old ) {
			old.remove();
		}
		window.clearTimeout( toastTimer );
		const el = h( 'div', { class: 'cp-toast', role: 'status' }, h( 'span', null, message ) );
		if ( action ) {
			el.appendChild( h( 'button', { type: 'button', onClick: () => {
				el.remove();
				action.run();
			} }, action.label ) );
		}
		( document.querySelector( 'dialog[open]' ) || document.body ).appendChild( el );
		toastTimer = window.setTimeout( () => el.remove(), ms || 5000 );
	}

	function needOnline() {
		if ( false === navigator.onLine ) {
			toast( 'You are offline. Try again when you are connected.' );
			return false;
		}
		return true;
	}

	function reportError( err ) {
		if ( isLoginError( err ) ) {
			setSync( 'login' );
			toast( 'You are logged out. Log in again to continue.' );
		} else if ( isOffline( err ) ) {
			toast( 'No connection. Try again when you are connected.' );
		} else {
			toast( err.message );
		}
	}

	/* =========================================================
	 * Note and folder actions
	 * ======================================================= */

	function newNote( folder ) {
		const cid = uid();
		const key = 'c_' + cid;
		const target = folder && S.folders.has( folder ) ? folder : S.inbox;
		S.notes.set( key, { key, id: null, client_id: cid, title: '', body: '', checklist: [], folder: target, status: 'idea', pinned: false, version: 1, created: nowIso(), modified: nowIso(), files: [], local: true } );
		Editor.open( key, true );
	}

	function discardIfEmpty( key ) {
		const n = S.notes.get( key );
		if ( n && n.local && isEmptyNote( n ) ) {
			S.notes.delete( key );
			S.pending.delete( key );
			persist();
			return true;
		}
		return false;
	}

	function togglePin( key ) {
		const n = S.notes.get( key );
		if ( n ) {
			change( key, { pinned: ! n.pinned } );
			render();
		}
	}

	function moveNote( key, folder ) {
		const n = S.notes.get( key );
		if ( ! n || n.folder === folder || ! S.folders.has( folder ) ) {
			return;
		}
		change( key, { folder } );
		render();
		Editor.syncText();
		toast( 'Moved to ' + folderPath( folder ) );
	}

	async function askMoveNote( key ) {
		const n = S.notes.get( key );
		if ( ! n ) {
			return;
		}
		const id = await pickFolder( 'Move note to…', n.folder, null, false );
		if ( id ) {
			moveNote( key, id );
		}
	}

	async function trashNote( key ) {
		const n = S.notes.get( key );
		if ( ! n ) {
			return;
		}
		if ( n.local ) {
			S.notes.delete( key );
			S.pending.delete( key );
			persist();
			Editor.close( true );
			render();
			toast( 'Note deleted.' );
			return;
		}
		if ( ! needOnline() ) {
			return;
		}
		try {
			if ( S.pending.has( key ) ) {
				await flushOne( key );
			}
			const id = n.id;
			await api( 'DELETE', 'notes/' + id );
			S.notes.delete( noteKey( id ) );
			S.pending.delete( noteKey( id ) );
			persist();
			S.trash = null;
			Editor.close( true );
			render();
			toast( 'Note moved to the trash.', { label: 'Undo', run: () => restoreNote( id ) } );
		} catch ( err ) {
			reportError( err );
		}
	}

	async function restoreNote( id ) {
		if ( ! needOnline() ) {
			return;
		}
		try {
			const data = await api( 'POST', 'notes/' + id + '/restore' );
			const key = noteKey( id );
			S.notes.set( key, Object.assign( { key }, data.note ) );
			S.trash = null;
			render();
			toast( 'Note restored to ' + folderPath( data.note.folder ) + '.' );
		} catch ( err ) {
			reportError( err );
		}
	}

	async function createFolder( name, parent ) {
		if ( ! needOnline() ) {
			return null;
		}
		try {
			const data = await api( 'POST', 'folders', { name, parent } );
			setFolders( data.folders );
			if ( parent ) {
				S.expanded.add( parent );
				saveExpanded();
			}
			render();
			return data.id;
		} catch ( err ) {
			reportError( err );
			return null;
		}
	}

	async function updateFolder( id, changes, okMessage ) {
		if ( ! needOnline() ) {
			return false;
		}
		try {
			const data = await api( 'POST', 'folders/' + id, changes );
			setFolders( data.folders );
			render();
			if ( okMessage ) {
				toast( okMessage );
			}
			return true;
		} catch ( err ) {
			reportError( err );
			return false;
		}
	}

	async function newFolderIn( parent ) {
		const name = await ask( 'New folder', parent ? 'Name of the folder inside “' + S.folders.get( parent ).name + '”' : 'Folder name', '', 'Create' );
		if ( name ) {
			const id = await createFolder( name, parent || 0 );
			if ( id ) {
				toast( 'Folder “' + name + '” created.' );
			}
		}
	}

	async function renameFolder( id ) {
		const f = S.folders.get( id );
		const name = await ask( 'Rename folder', 'New name', f.name, 'Rename' );
		if ( name && name !== f.name ) {
			updateFolder( id, { name } );
		}
	}

	async function moveFolderAsk( id ) {
		const f = S.folders.get( id );
		const blocked = descendants( id );
		blocked.add( id );
		const target = await pickFolder( 'Move “' + f.name + '” into…', f.parent, blocked, true );
		if ( null !== target && target !== f.parent ) {
			moveFolder( id, target );
		}
	}

	function moveFolder( id, parent ) {
		const f = S.folders.get( id );
		if ( ! f || f.parent === parent || id === parent || descendants( id ).has( parent ) ) {
			return;
		}
		updateFolder( id, { parent }, 'Folder moved to ' + ( parent ? folderPath( parent ) : 'the top level' ) + '.' );
		if ( parent ) {
			S.expanded.add( parent );
			saveExpanded();
		}
	}

	async function deleteFolder( id ) {
		const f = S.folders.get( id );
		const subs = descendants( id ).size;
		const notes = countIn( id );
		const text = 'Delete “' + f.name + '”' + ( subs ? ' and its ' + subs + ' subfolder' + ( 1 === subs ? '' : 's' ) : '' ) + '? ' +
			( notes ? 'Its ' + notes + ' note' + ( 1 === notes ? '' : 's' ) + ' will go to the trash (you can restore them for 30 days, into the Inbox).' : 'It has no notes.' );
		if ( ! ( await confirmBox( 'Delete folder', text, 'Delete folder', true ) ) || ! needOnline() ) {
			return;
		}
		try {
			if ( S.pending.size ) {
				await flush();
			}
			const data = await api( 'DELETE', 'folders/' + id );
			loadServerState( { folders: data.folders, notes: data.notes, inbox: S.inbox, statuses: S.statuses } );
			if ( 'folder' === S.view.mode && ! S.folders.has( S.view.folder ) ) {
				S.view.folder = f.parent && S.folders.has( f.parent ) ? f.parent : S.inbox;
			}
			S.trash = null;
			render();
			toast( 'Folder deleted.' + ( data.trashed ? ' ' + data.trashed + ' note' + ( 1 === data.trashed ? '' : 's' ) + ' moved to the trash.' : '' ) );
		} catch ( err ) {
			reportError( err );
		}
	}

	function folderMenu( anchor, id ) {
		const f = S.folders.get( id );
		const isInbox = id === S.inbox;
		openMenu( anchor, [
			{ label: 'New folder inside', icon: 'folderPlus', run: () => newFolderIn( id ) },
			{ label: 'New note here', icon: 'plus', run: () => newNote( id ) },
			{ label: 'Rename', icon: 'edit', run: () => renameFolder( id ) },
			isInbox ? null : { label: 'Move to…', icon: 'folderMove', run: () => moveFolderAsk( id ) },
			isInbox ? null : { label: f.is_site ? 'Not a website folder' : 'Mark as website folder', icon: 'globe', run: () => updateFolder( id, { is_site: ! f.is_site }, f.is_site ? 'No longer a website folder.' : 'Notes in “' + f.name + '” now belong to this website.' ) },
			isInbox ? null : { sep: true },
			isInbox ? null : { label: 'Delete folder', icon: 'trash', danger: true, run: () => deleteFolder( id ) },
		] );
	}

	/* =========================================================
	 * Navigation
	 * ======================================================= */

	function go( mode, folder ) {
		S.view.mode = mode;
		if ( 'folder' === mode ) {
			S.view.folder = folder;
			for ( const a of ancestors( folder ) ) {
				if ( a.id !== folder ) {
					S.expanded.add( a.id );
				}
			}
		}
		if ( 'trash' === mode ) {
			S.trash = null;
		}
		closeDrawer();
		render();
		window.scrollTo( 0, 0 );
		try {
			window.localStorage.setItem( 'cp-view', JSON.stringify( { mode, folder: S.view.folder } ) );
		} catch ( e ) {}
	}

	function saveExpanded() {
		try {
			window.localStorage.setItem( 'cp-expanded', JSON.stringify( Array.from( S.expanded ) ) );
		} catch ( e ) {}
	}

	function openDrawer() {
		document.querySelector( '.cp-shell' ).classList.add( 'is-drawer-open' );
	}
	function closeDrawer() {
		const shell = document.querySelector( '.cp-shell' );
		if ( shell ) {
			shell.classList.remove( 'is-drawer-open' );
		}
	}

	/* =========================================================
	 * Drag and drop (computer)
	 * ======================================================= */

	let drag = null;

	function makeDropTarget( el, folderId ) {
		el.addEventListener( 'dragover', ( e ) => {
			if ( ! drag ) {
				return;
			}
			const ok = 'note' === drag.type ? folderId > 0 : ( drag.id !== folderId && ! descendants( drag.id ).has( folderId ) );
			if ( ok ) {
				e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
				el.classList.add( 'is-drop' );
			}
		} );
		el.addEventListener( 'dragleave', () => el.classList.remove( 'is-drop' ) );
		el.addEventListener( 'drop', ( e ) => {
			e.preventDefault();
			el.classList.remove( 'is-drop' );
			if ( ! drag ) {
				return;
			}
			if ( 'note' === drag.type ) {
				moveNote( drag.key, folderId );
			} else {
				moveFolder( drag.id, folderId );
			}
			drag = null;
		} );
	}

	function makeDraggable( el, data ) {
		el.draggable = true;
		el.addEventListener( 'dragstart', ( e ) => {
			drag = data;
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData( 'text/plain', 'note' === data.type ? data.key : String( data.id ) );
			el.classList.add( 'is-dragging' );
		} );
		el.addEventListener( 'dragend', () => {
			drag = null;
			el.classList.remove( 'is-dragging' );
			document.querySelectorAll( '.is-drop' ).forEach( ( x ) => x.classList.remove( 'is-drop' ) );
		} );
	}

	/* =========================================================
	 * Rendering: shell
	 * ======================================================= */

	let sideEl;
	let mainEl;
	let searchInput;

	function renderShell() {
		root.textContent = '';

		searchInput = h( 'input', {
			type: 'search',
			placeholder: 'Search notes',
			'aria-label': 'Search notes',
			autocomplete: 'off',
			onInput: debounce( () => {
				S.view.q = searchInput.value;
				clearBtn.hidden = ! searchInput.value;
				render();
			}, 150 ),
			onKeydown: ( e ) => {
				if ( 'Escape' === e.key ) {
					clearSearch();
				}
			},
		} );
		const clearBtn = iconBtn( 'close', 'Clear search', () => clearSearch(), { class: 'cp-icon-btn cp-search__clear', hidden: true } );
		function clearSearch() {
			searchInput.value = '';
			clearBtn.hidden = true;
			S.view.q = '';
			render();
		}

		const top = h( 'header', { class: 'cp-top' },
			iconBtn( 'menu', 'Folders', openDrawer, { class: 'cp-icon-btn cp-top__menu' } ),
			h( 'div', { class: 'cp-top__brand' }, h( 'span', null, 'Notes' ) ),
			h( 'div', { class: 'cp-search', role: 'search' }, icon( 'search' ), searchInput, clearBtn ),
			h( 'span', { id: 'cp-sync', class: 'cp-sync', 'data-state': 'saved', role: 'status', 'aria-live': 'polite' }, h( 'span', { class: 'cp-sync__text' }, SYNC_TEXT.saved ) ),
			iconBtn( 'more', 'Menu', ( e ) => openMenu( e.currentTarget, [
				{ label: 'Refresh', icon: 'refresh', run: () => refreshFromServer().then( () => toast( 'Up to date.' ) ) },
				{ label: 'Dashboard', icon: 'dashboard', href: C.adminUrl },
				{ label: 'Privacy status', icon: 'shield', href: C.statusUrl },
				{ label: 'Ollama test (on your PC)', icon: 'bolt', href: C.ollamaUrl },
				{ sep: true },
				{ label: 'Log out', icon: 'logout', href: C.logoutUrl },
			] ) )
		);
		top.querySelector( '.cp-search svg' ).classList.add( 'cp-search__icon' );

		sideEl = h( 'nav', { class: 'cp-side', 'aria-label': 'Folders' } );
		mainEl = h( 'main', { class: 'cp-main' } );
		const fab = h( 'button', { type: 'button', class: 'cp-fab', 'aria-label': 'New note', title: 'New note', onClick: () => newNote( currentFolderForNew() ) }, icon( 'plus' ) );
		const scrim = h( 'div', { class: 'cp-scrim', onClick: closeDrawer } );

		root.appendChild( h( 'div', { class: 'cp-shell' }, top, sideEl, scrim, mainEl, fab ) );
	}

	function currentFolderForNew() {
		return 'folder' === S.view.mode ? S.view.folder : S.inbox;
	}

	function debounce( fn, ms ) {
		let t = 0;
		return ( ...args ) => {
			window.clearTimeout( t );
			t = window.setTimeout( () => fn( ...args ), ms );
		};
	}

	function render() {
		renderSide();
		renderMain();
	}

	// After a save only small things change (pending marks); avoid moving the page around.
	const renderLight = debounce( render, 250 );

	/* =========================================================
	 * Rendering: folder tree
	 * ======================================================= */

	function renderSide() {
		const scroll = sideEl.scrollTop;
		sideEl.textContent = '';

		const allNode = h( 'div', { class: 'cp-node' + ( 'all' === S.view.mode && ! S.view.q ? ' is-current' : '' ) },
			h( 'span', { class: 'cp-node__toggle cp-node__toggle--empty' } ),
			h( 'button', { type: 'button', class: 'cp-node__open', onClick: () => go( 'all' ) }, icon( 'all' ), h( 'span', { class: 'cp-node__name' }, 'All notes' ), h( 'span', { class: 'cp-node__count' }, String( S.notes.size ) ) ),
			h( 'span', { class: 'cp-node__spacer' } )
		);
		makeDropTargetTop( allNode );

		const tree = h( 'ul', { class: 'cp-tree' } );
		buildTree( tree, 0 );

		const trashNode = h( 'div', { class: 'cp-node' + ( 'trash' === S.view.mode ? ' is-current' : '' ) },
			h( 'span', { class: 'cp-node__toggle cp-node__toggle--empty' } ),
			h( 'button', { type: 'button', class: 'cp-node__open', onClick: () => go( 'trash' ) }, icon( 'trash' ), h( 'span', { class: 'cp-node__name' }, 'Trash' ) ),
			h( 'span', { class: 'cp-node__spacer' } )
		);

		append( sideEl, [
			allNode,
			h( 'div', { class: 'cp-side__label' }, 'Folders' ),
			tree,
			h( 'button', { type: 'button', class: 'cp-btn cp-side__new', onClick: () => newFolderIn( 0 ) }, icon( 'folderPlus' ), 'New folder' ),
			h( 'div', { class: 'cp-side__label' }, ' ' ),
			trashNode,
		] );
		sideEl.scrollTop = scroll;
	}

	function makeDropTargetTop( el ) {
		// Folders dropped on "All notes" move to the top level.
		el.addEventListener( 'dragover', ( e ) => {
			if ( drag && 'folder' === drag.type ) {
				e.preventDefault();
				el.classList.add( 'is-drop' );
			}
		} );
		el.addEventListener( 'dragleave', () => el.classList.remove( 'is-drop' ) );
		el.addEventListener( 'drop', ( e ) => {
			e.preventDefault();
			el.classList.remove( 'is-drop' );
			if ( drag && 'folder' === drag.type ) {
				moveFolder( drag.id, 0 );
			}
			drag = null;
		} );
	}

	function buildTree( ul, parent ) {
		for ( const f of childrenOf( parent ) ) {
			const kids = childrenOf( f.id );
			const open = S.expanded.has( f.id );
			const isCurrent = 'folder' === S.view.mode && S.view.folder === f.id && ! S.view.q;
			const toggle = kids.length
				? h( 'button', { type: 'button', class: 'cp-node__toggle', 'aria-expanded': open ? 'true' : 'false', 'aria-label': ( open ? 'Collapse ' : 'Expand ' ) + f.name, onClick: () => {
					if ( open ) {
						S.expanded.delete( f.id );
					} else {
						S.expanded.add( f.id );
					}
					saveExpanded();
					renderSide();
				} }, icon( 'chevron' ) )
				: h( 'span', { class: 'cp-node__toggle cp-node__toggle--empty' } );
			const node = h( 'div', { class: 'cp-node' + ( isCurrent ? ' is-current' : '' ), dataset: { folder: String( f.id ) } },
				toggle,
				h( 'button', { type: 'button', class: 'cp-node__open', 'aria-current': isCurrent ? 'page' : null, onClick: () => go( 'folder', f.id ) },
					icon( f.id === S.inbox ? 'inbox' : 'folder' ),
					h( 'span', { class: 'cp-node__name' }, f.name ),
					f.is_site ? h( 'span', { class: 'cp-site-dot', title: 'Website folder' } ) : null,
					h( 'span', { class: 'cp-node__count' }, String( countIn( f.id ) ) )
				),
				iconBtn( 'more', 'Folder options for ' + f.name, ( e ) => folderMenu( e.currentTarget, f.id ), { class: 'cp-icon-btn cp-node__more' } )
			);
			makeDropTarget( node, f.id );
			if ( f.id !== S.inbox ) {
				makeDraggable( node, { type: 'folder', id: f.id } );
			}
			const li = h( 'li', null, node );
			if ( kids.length && open ) {
				const sub = h( 'ul', { class: 'cp-tree' } );
				buildTree( sub, f.id );
				li.appendChild( sub );
			}
			ul.appendChild( li );
		}
	}

	/* =========================================================
	 * Rendering: main area
	 * ======================================================= */

	function renderMain() {
		mainEl.textContent = '';
		const inner = h( 'div', { class: 'cp-main__inner' } );
		mainEl.appendChild( inner );

		inner.appendChild( h( 'div', { id: 'cp-login-banner', class: 'cp-banner', hidden: 'login' !== S.sync.state },
			h( 'span', { style: 'flex:1' }, 'You are logged out. Your changes are kept on this device and will be saved after you log in.' ),
			h( 'a', { class: 'cp-btn cp-btn--primary', href: C.loginUrl }, 'Log in' )
		) );

		if ( S.view.q.trim() && 'trash' !== S.view.mode ) {
			renderSearch( inner );
		} else if ( 'trash' === S.view.mode ) {
			renderTrash( inner );
		} else if ( 'all' === S.view.mode ) {
			inner.appendChild( h( 'div', { class: 'cp-crumbs' }, h( 'span', null, 'All notes' ) ) );
			inner.appendChild( capture() );
			inner.appendChild( filters() );
			renderCards( inner, Array.from( S.notes.values() ), true, 'No notes yet. Tap + to write your first one.' );
		} else {
			renderFolder( inner );
		}
	}

	function renderFolder( inner ) {
		const id = S.view.folder;
		const f = S.folders.get( id );
		if ( ! f ) {
			S.view.folder = S.inbox;
			return renderFolder( inner );
		}

		const crumbs = h( 'nav', { class: 'cp-crumbs', 'aria-label': 'Folder path' } );
		const chain = ancestors( id );
		chain.forEach( ( a, i ) => {
			if ( i ) {
				crumbs.appendChild( h( 'span', { class: 'cp-crumbs__sep' }, '›' ) );
			}
			const b = h( 'button', { type: 'button', onClick: () => go( 'folder', a.id ), 'aria-current': a.id === id ? 'page' : null }, a.name );
			makeDropTarget( b, a.id );
			crumbs.appendChild( b );
		} );
		const site = siteOf( id );
		crumbs.appendChild( h( 'span', { class: 'cp-crumbs__actions' },
			site ? h( 'span', { class: 'cp-badge cp-badge--site', title: 'Notes here belong to this website' }, site.name ) : null,
			iconBtn( 'more', 'Folder options', ( e ) => folderMenu( e.currentTarget, id ) )
		) );
		inner.appendChild( crumbs );

		const tiles = h( 'div', { class: 'cp-subfolders' } );
		for ( const k of childrenOf( id ) ) {
			const tile = h( 'button', { type: 'button', class: 'cp-tile', onClick: () => go( 'folder', k.id ) }, icon( 'folder' ), h( 'span', { style: 'min-width:0' }, h( 'span', { class: 'cp-tile__name' }, k.name ), h( 'br' ), h( 'span', { class: 'cp-tile__count' }, countIn( k.id ) + ' notes' ) ) );
			makeDropTarget( tile, k.id );
			makeDraggable( tile, { type: 'folder', id: k.id } );
			tiles.appendChild( tile );
		}
		tiles.appendChild( h( 'button', { type: 'button', class: 'cp-tile cp-tile--add', onClick: () => newFolderIn( id ) }, icon( 'folderPlus' ), 'New folder' ) );
		inner.appendChild( tiles );

		inner.appendChild( capture() );
		inner.appendChild( filters() );
		const notes = Array.from( S.notes.values() ).filter( ( n ) => n.folder === id );
		renderCards( inner, notes, false, childrenOf( id ).length ? 'No notes directly in this folder. Open a folder above, or write a new note.' : 'No notes here yet. Write one, or drag notes into this folder.' );
	}

	function capture() {
		return h( 'div', { class: 'cp-capture' },
			h( 'button', { type: 'button', class: 'cp-capture__input', onClick: () => newNote( currentFolderForNew() ) }, 'Take a note…' ),
			iconBtn( 'list', 'New checklist', () => {
				newNote( currentFolderForNew() );
				Editor.addChecklist();
			} )
		);
	}

	function filters() {
		const wrap = h( 'div', { class: 'cp-filters', role: 'group', 'aria-label': 'Filter by status' } );
		const add = ( value, label ) => wrap.appendChild( h( 'button', { type: 'button', class: 'cp-chip', 'aria-pressed': S.view.status === value ? 'true' : 'false', onClick: () => {
			S.view.status = S.view.status === value ? '' : value;
			renderMain();
		} }, label ) );
		add( '', 'All' );
		for ( const [ value, label ] of Object.entries( S.statuses ) ) {
			add( value, label );
		}
		return wrap;
	}

	function sortNotes( list ) {
		return list.sort( ( a, b ) => ( b.pinned - a.pinned ) || String( b.modified ).localeCompare( String( a.modified ) ) );
	}

	function renderCards( inner, notes, showPath, emptyText ) {
		if ( S.view.status ) {
			notes = notes.filter( ( n ) => n.status === S.view.status );
		}
		sortNotes( notes );
		if ( ! notes.length ) {
			inner.appendChild( h( 'div', { class: 'cp-empty' }, icon( 'folder' ), h( 'p', null, S.view.status ? 'No notes with this status here.' : emptyText ) ) );
			return;
		}
		const pinned = notes.filter( ( n ) => n.pinned );
		const others = notes.filter( ( n ) => ! n.pinned );
		if ( pinned.length ) {
			inner.appendChild( h( 'div', { class: 'cp-section-label' }, 'Pinned' ) );
			inner.appendChild( h( 'div', { class: 'cp-cards' }, pinned.map( ( n ) => card( n, showPath ) ) ) );
			if ( others.length ) {
				inner.appendChild( h( 'div', { class: 'cp-section-label' }, 'Others' ) );
			}
		}
		if ( others.length ) {
			inner.appendChild( h( 'div', { class: 'cp-cards' }, others.map( ( n ) => card( n, showPath ) ) ) );
		}
	}

	function card( n, showPath ) {
		const site = siteOf( n.folder );
		const open = () => Editor.open( n.key );
		const el = h( 'article', { class: 'cp-card', tabindex: '0', role: 'button', 'aria-label': ( n.title || 'Untitled note' ), dataset: { key: n.key },
			onClick: ( e ) => {
				if ( ! e.target.closest( 'button' ) ) {
					open();
				}
			},
			onKeydown: ( e ) => {
				if ( ( 'Enter' === e.key || ' ' === e.key ) && e.target === el ) {
					e.preventDefault();
					open();
				}
			},
		} );
		el.appendChild( iconBtn( 'pin', n.pinned ? 'Unpin' : 'Pin', () => togglePin( n.key ), { class: 'cp-icon-btn cp-card__pin', 'aria-pressed': n.pinned ? 'true' : 'false' } ) );
		if ( n.title ) {
			el.appendChild( h( 'h3', { class: 'cp-card__title' }, n.title ) );
		}
		if ( n.body ) {
			el.appendChild( h( 'p', { class: 'cp-card__body' }, n.body.length > 1200 ? n.body.slice( 0, 1200 ) + '…' : n.body ) );
		}
		if ( n.checklist.length ) {
			const open = n.checklist.filter( ( i ) => ! i.d );
			const done = n.checklist.length - open.length;
			const ul = h( 'ul', { class: 'cp-card__list' } );
			for ( const it of open.slice( 0, 6 ) ) {
				ul.appendChild( h( 'li', null, '☐', h( 'span', null, it.t ) ) );
			}
			el.appendChild( ul );
			const more = [];
			if ( open.length > 6 ) {
				more.push( '+' + ( open.length - 6 ) + ' more' );
			}
			if ( done ) {
				more.push( done + ' ticked' );
			}
			if ( more.length ) {
				el.appendChild( h( 'div', { class: 'cp-card__more' }, more.join( ' · ' ) ) );
			}
		}
		if ( n.files && n.files.length ) {
			el.appendChild( h( 'div', { class: 'cp-card__images' }, n.files.slice( 0, 3 ).map( ( f ) => h( 'img', { src: f.url, alt: '', loading: 'lazy' } ) ) ) );
		}
		if ( ! n.title && ! n.body && ! n.checklist.length && ! ( n.files && n.files.length ) ) {
			el.appendChild( h( 'p', { class: 'cp-card__body', style: 'color:var(--cp-muted)' }, 'Empty note' ) );
		}
		const meta = h( 'div', { class: 'cp-card__meta' } );
		if ( 'idea' !== n.status ) {
			meta.appendChild( h( 'span', { class: 'cp-badge cp-badge--status-' + n.status }, S.statuses[ n.status ] || n.status ) );
		}
		if ( site && ( showPath || 'folder' !== S.view.mode ) ) {
			meta.appendChild( h( 'span', { class: 'cp-badge cp-badge--site' }, site.name ) );
		}
		if ( showPath ) {
			meta.appendChild( h( 'span', { class: 'cp-path' }, folderPath( n.folder ) ) );
		}
		if ( S.pending.has( n.key ) ) {
			meta.appendChild( h( 'span', { class: 'cp-pending', title: 'Not saved to the server yet' }, '● not saved yet' ) );
		}
		if ( meta.childNodes.length ) {
			el.appendChild( meta );
		}
		makeDraggable( el, { type: 'note', key: n.key } );
		return el;
	}

	/* =========================================================
	 * Search
	 * ======================================================= */

	function matches( n, words ) {
		const hay = ( n.title + '\n' + n.body + '\n' + n.checklist.map( ( i ) => i.t ).join( '\n' ) + '\n' + folderPath( n.folder ) ).toLowerCase();
		return words.every( ( w ) => hay.includes( w ) );
	}

	function renderSearch( inner ) {
		const q = S.view.q.trim();
		const words = q.toLowerCase().split( /\s+/ ).filter( Boolean );
		const inFolder = 'folder' === S.view.mode && 'folder' === S.view.scope;
		let pool = Array.from( S.notes.values() );
		if ( inFolder ) {
			const ids = descendants( S.view.folder );
			ids.add( S.view.folder );
			pool = pool.filter( ( n ) => ids.has( n.folder ) );
		}
		const found = pool.filter( ( n ) => matches( n, words ) );

		inner.appendChild( h( 'div', { class: 'cp-crumbs' }, h( 'span', null, found.length + ' result' + ( 1 === found.length ? '' : 's' ) + ' for “' + q + '”' ) ) );
		if ( 'folder' === S.view.mode ) {
			const f = S.folders.get( S.view.folder );
			inner.appendChild( h( 'div', { class: 'cp-scope', role: 'group', 'aria-label': 'Where to search' },
				'Search in:',
				h( 'button', { type: 'button', class: 'cp-chip', 'aria-pressed': inFolder ? 'false' : 'true', onClick: () => {
					S.view.scope = 'all';
					renderMain();
				} }, 'All folders' ),
				h( 'button', { type: 'button', class: 'cp-chip', 'aria-pressed': inFolder ? 'true' : 'false', onClick: () => {
					S.view.scope = 'folder';
					renderMain();
				} }, '“' + ( f ? f.name : '' ) + '” and its subfolders' )
			) );
		}
		// Folders whose name matches.
		const folderHits = Array.from( S.folders.values() ).filter( ( f ) => words.every( ( w ) => f.name.toLowerCase().includes( w ) ) );
		if ( folderHits.length ) {
			inner.appendChild( h( 'div', { class: 'cp-section-label' }, 'Folders' ) );
			inner.appendChild( h( 'div', { class: 'cp-subfolders' }, folderHits.slice( 0, 12 ).map( ( f ) => h( 'button', { type: 'button', class: 'cp-tile', onClick: () => {
				searchInput.value = '';
				S.view.q = '';
				document.querySelector( '.cp-search__clear' ).hidden = true;
				go( 'folder', f.id );
			} }, icon( 'folder' ), h( 'span', { style: 'min-width:0' }, h( 'span', { class: 'cp-tile__name' }, f.name ), h( 'br' ), h( 'span', { class: 'cp-tile__count' }, folderPath( f.parent ) || 'Top level' ) ) ) ) ) );
		}
		inner.appendChild( filters() );
		if ( folderHits.length && found.length ) {
			inner.appendChild( h( 'div', { class: 'cp-section-label' }, 'Notes' ) );
		}
		renderCards( inner, found, true, 'No notes match. Try fewer or different words.' );
	}

	/* =========================================================
	 * Trash
	 * ======================================================= */

	async function loadTrash() {
		try {
			S.trash = await api( 'GET', 'trash' );
		} catch ( err ) {
			S.trash = { error: err };
		}
		if ( 'trash' === S.view.mode ) {
			renderMain();
		}
	}

	function renderTrash( inner ) {
		inner.appendChild( h( 'div', { class: 'cp-crumbs' }, h( 'span', null, 'Trash' ),
			S.trash && S.trash.notes && S.trash.notes.length ? h( 'span', { class: 'cp-crumbs__actions' }, h( 'button', { type: 'button', class: 'cp-btn cp-btn--danger', onClick: emptyTrash }, 'Empty trash' ) ) : null
		) );
		if ( ! S.trash ) {
			inner.appendChild( h( 'p', { class: 'cp-empty' }, 'Loading…' ) );
			loadTrash();
			return;
		}
		if ( S.trash.error ) {
			inner.appendChild( h( 'div', { class: 'cp-empty' }, h( 'p', null, isOffline( S.trash.error ) ? 'The trash can only be opened when you are online.' : S.trash.error.message ), h( 'button', { type: 'button', class: 'cp-btn', onClick: () => {
				S.trash = null;
				renderMain();
			} }, 'Try again' ) ) );
			return;
		}
		inner.appendChild( h( 'p', { class: 'cp-scope' }, 'Notes in the trash are deleted for good after ' + S.trash.days + ' days.' ) );
		if ( ! S.trash.notes.length ) {
			inner.appendChild( h( 'div', { class: 'cp-empty' }, icon( 'trash' ), h( 'p', null, 'The trash is empty.' ) ) );
			return;
		}
		const ul = h( 'ul', { class: 'cp-rows' } );
		for ( const n of S.trash.notes ) {
			const preview = n.body || n.checklist.map( ( i ) => ( i.d ? '☑ ' : '☐ ' ) + i.t ).join( '\n' );
			ul.appendChild( h( 'li', { class: 'cp-row' },
				h( 'div', { class: 'cp-row__text' },
					h( 'div', { class: 'cp-row__title' }, n.title || 'Untitled note' ),
					h( 'div', { class: 'cp-row__sub' }, ( n.folder_path ? 'From ' + n.folder_path + ' · ' : 'Folder deleted – restores to the Inbox · ' ) + 'deleted ' + fmtDate( n.trashed_at ) ),
					preview ? h( 'p', { class: 'cp-row__preview' }, preview ) : null
				),
				h( 'button', { type: 'button', class: 'cp-btn', onClick: () => restoreNote( n.id ) }, icon( 'restore' ), 'Restore' ),
				h( 'button', { type: 'button', class: 'cp-btn cp-btn--danger', onClick: () => deleteForever( n ) }, 'Delete forever' )
			) );
		}
		inner.appendChild( ul );
	}

	async function deleteForever( n ) {
		if ( ! ( await confirmBox( 'Delete forever', 'Delete “' + ( n.title || 'Untitled note' ) + '” for good? This cannot be undone.', 'Delete forever', true ) ) || ! needOnline() ) {
			return;
		}
		try {
			await api( 'DELETE', 'notes/' + n.id, null, { force: 1 } );
			S.trash = null;
			renderMain();
			toast( 'Note deleted for good.' );
		} catch ( err ) {
			reportError( err );
		}
	}

	async function emptyTrash() {
		const count = S.trash.notes.length;
		if ( ! ( await confirmBox( 'Empty trash', 'Delete all ' + count + ' note' + ( 1 === count ? '' : 's' ) + ' in the trash for good? This cannot be undone.', 'Empty trash', true ) ) || ! needOnline() ) {
			return;
		}
		try {
			await api( 'POST', 'trash/empty' );
			S.trash = null;
			renderMain();
			toast( 'Trash emptied.' );
		} catch ( err ) {
			reportError( err );
		}
	}

	/* =========================================================
	 * Editor
	 * ======================================================= */

	const Editor = ( function () {
		let dlg = null;
		let els = {};
		let viaHistory = false;

		function note() {
			return S.editorKey ? S.notes.get( S.editorKey ) : null;
		}

		function open( key, isNew ) {
			if ( dlg ) {
				close( true );
			}
			S.editorKey = key;
			build();
			document.body.appendChild( dlg );
			dlg.showModal();
			try {
				window.history.pushState( { cpEditor: 1 }, '' );
				viaHistory = true;
			} catch ( e ) {
				viaHistory = false;
			}
			if ( isNew ) {
				els.body.focus();
			}
		}

		function build() {
			const n = note();
			dlg = h( 'dialog', { class: 'cp-dialog cp-editor', 'aria-label': 'Edit note' } );
			dlg.addEventListener( 'cancel', ( e ) => {
				e.preventDefault();
				close();
			} );

			els.status = h( 'select', { class: 'cp-editor__status', 'aria-label': 'Status', onChange: () => {
				change( S.editorKey, { status: els.status.value } );
				renderLight();
			} }, Object.entries( S.statuses ).map( ( [ v, l ] ) => h( 'option', { value: v }, l ) ) );
			els.pin = iconBtn( 'pin', 'Pin', () => {
				togglePin( S.editorKey );
				fill();
			} );
			els.title = h( 'input', { class: 'cp-editor__title', type: 'text', placeholder: 'Title', 'aria-label': 'Title', maxlength: 300, onInput: () => change( S.editorKey, { title: els.title.value } ) } );
			els.body = h( 'textarea', { class: 'cp-editor__body', placeholder: 'Note', 'aria-label': 'Note text', rows: 6, onInput: () => {
				grow();
				change( S.editorKey, { body: els.body.value } );
			} } );
			els.list = h( 'div', { class: 'cp-checklist' } );
			els.images = h( 'div', { class: 'cp-images' } );
			els.file = h( 'input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp', multiple: true, hidden: true, onChange: () => {
				const files = Array.from( els.file.files || [] );
				els.file.value = '';
				files.forEach( uploadImage );
			} } );
			els.where = h( 'button', { type: 'button', class: 'cp-btn', onClick: () => askMoveNote( S.editorKey ) }, icon( 'folder' ), h( 'span', { class: 'cp-path' } ) );
			els.info = h( 'span' );
			els.sync = h( 'span' );

			const head = h( 'div', { class: 'cp-dialog__head' },
				iconBtn( 'back', 'Close note', () => close() ),
				h( 'span', { style: 'flex:1' } ),
				els.status,
				els.pin,
				iconBtn( 'list', 'Add checklist', () => addChecklist() ),
				iconBtn( 'image', 'Add image', () => {
					if ( needOnline() ) {
						els.file.click();
					}
				} ),
				iconBtn( 'more', 'More', ( e ) => openMenu( e.currentTarget, [
					{ label: 'Move to…', icon: 'folderMove', run: () => askMoveNote( S.editorKey ) },
					{ label: 'History (earlier versions)', icon: 'history', run: showHistory },
					note() && note().checklist.length ? { label: 'Remove checklist', icon: 'list', run: removeChecklist } : null,
					{ sep: true },
					{ label: 'Move to trash', icon: 'trash', danger: true, run: () => trashNote( S.editorKey ) },
				] ) )
			);
			const body = h( 'div', { class: 'cp-dialog__body' }, els.title, els.body, els.list, els.images, els.file );
			const foot = h( 'div', { class: 'cp-editor__foot' }, els.where, h( 'span', { class: 'cp-editor__info' }, els.info, els.sync ) );
			append( dlg, [ head, body, foot ] );
			fill();
		}

		function fill() {
			const n = note();
			if ( ! n || ! dlg ) {
				return;
			}
			els.status.value = n.status;
			els.pin.setAttribute( 'aria-pressed', n.pinned ? 'true' : 'false' );
			els.pin.setAttribute( 'aria-label', n.pinned ? 'Unpin' : 'Pin' );
			if ( document.activeElement !== els.title ) {
				els.title.value = n.title;
			}
			if ( document.activeElement !== els.body ) {
				els.body.value = n.body;
			}
			renderList();
			renderImages();
			syncText();
			window.requestAnimationFrame( grow );
		}

		function grow() {
			if ( els.body ) {
				els.body.style.height = 'auto';
				els.body.style.height = Math.max( 160, els.body.scrollHeight ) + 'px';
			}
		}

		function syncText() {
			const n = note();
			if ( ! dlg || ! n ) {
				return;
			}
			els.where.querySelector( '.cp-path' ).textContent = folderPath( n.folder );
			const site = siteOf( n.folder );
			// The folder button already shows the folder; name the website only when it is a parent folder.
			els.info.textContent = ( site && site.id !== n.folder ? site.name + ' · ' : '' ) + 'Edited ' + fmtDate( n.modified );
			let s;
			if ( S.pending.has( S.editorKey ) ) {
				s = 'offline' === S.sync.state || 'login' === S.sync.state ? SYNC_TEXT[ S.sync.state ] : 'Saving…';
			} else {
				s = n.local ? '' : 'Saved';
			}
			els.sync.textContent = s ? '· ' + s : '';
		}

		/* ----- checklist ----- */

		function addChecklist() {
			const n = note();
			if ( ! n ) {
				return;
			}
			const items = n.checklist.slice();
			items.push( { t: '', d: false } );
			change( S.editorKey, { checklist: items } );
			renderList( items.filter( ( i ) => ! i.d ).length - 1 );
		}

		function removeChecklist() {
			const n = note();
			if ( ! n ) {
				return;
			}
			const lines = n.checklist.map( ( i ) => i.t ).filter( Boolean ).join( '\n' );
			const body = n.body + ( n.body && lines ? '\n' : '' ) + lines;
			change( S.editorKey, { checklist: [], body } );
			fill();
		}

		function renderList( focusOpenIndex ) {
			const n = note();
			els.list.textContent = '';
			if ( ! n || ! n.checklist.length ) {
				return;
			}
			const items = n.checklist;
			const openIdx = [];
			const doneIdx = [];
			items.forEach( ( it, i ) => ( it.d ? doneIdx : openIdx ).push( i ) );

			const row = ( i ) => {
				const it = items[ i ];
				const text = h( 'input', { type: 'text', value: it.t, 'aria-label': 'List item', maxlength: 1000,
					onInput: () => {
						const next = clone( note().checklist );
						next[ i ].t = text.value;
						change( S.editorKey, { checklist: next } );
					},
					onKeydown: ( e ) => {
						if ( 'Enter' === e.key ) {
							e.preventDefault();
							const next = clone( note().checklist );
							next.splice( i + 1, 0, { t: '', d: false } );
							change( S.editorKey, { checklist: next } );
							renderList( openPosition( next, i + 1 ) );
						} else if ( 'Backspace' === e.key && '' === text.value ) {
							e.preventDefault();
							removeItem( i, true );
						}
					},
				} );
				return h( 'li', { class: 'cp-list__item' + ( it.d ? ' is-done' : '' ) },
					h( 'input', { type: 'checkbox', checked: it.d, 'aria-label': it.d ? 'Untick' : 'Tick', onChange: () => {
						const next = clone( note().checklist );
						next[ i ].d = ! next[ i ].d;
						change( S.editorKey, { checklist: next } );
						renderList();
						renderLight();
					} } ),
					text,
					iconBtn( 'close', 'Remove item', () => removeItem( i ), { class: 'cp-icon-btn cp-list__remove' } )
				);
			};

			const ulOpen = h( 'ul', { class: 'cp-list' }, openIdx.map( row ) );
			const add = h( 'button', { type: 'button', class: 'cp-list__add', onClick: () => {
				const next = clone( note().checklist );
				next.push( { t: '', d: false } );
				change( S.editorKey, { checklist: next } );
				renderList( next.filter( ( x ) => ! x.d ).length - 1 );
			} }, icon( 'plus' ), 'List item' );
			append( els.list, [ ulOpen, add ] );
			if ( doneIdx.length ) {
				append( els.list, [ h( 'div', { class: 'cp-list__done-label' }, doneIdx.length + ' ticked item' + ( 1 === doneIdx.length ? '' : 's' ) ), h( 'ul', { class: 'cp-list' }, doneIdx.map( row ) ) ] );
			}
			if ( undefined !== focusOpenIndex && focusOpenIndex >= 0 ) {
				const inputs = ulOpen.querySelectorAll( 'input[type="text"]' );
				if ( inputs[ focusOpenIndex ] ) {
					inputs[ focusOpenIndex ].focus();
				}
			}
		}

		function openPosition( items, index ) {
			let pos = -1;
			for ( let i = 0; i <= index; i++ ) {
				if ( ! items[ i ].d ) {
					pos++;
				}
			}
			return pos;
		}

		function removeItem( i, focusPrev ) {
			const next = clone( note().checklist );
			next.splice( i, 1 );
			change( S.editorKey, { checklist: next } );
			renderList( focusPrev ? Math.max( 0, openPosition( next, Math.max( 0, i - 1 ) ) ) : undefined );
		}

		/* ----- images ----- */

		function renderImages() {
			const n = note();
			els.images.textContent = '';
			if ( ! n ) {
				return;
			}
			for ( const f of n.files || [] ) {
				els.images.appendChild( h( 'figure', { class: 'cp-image' },
					h( 'a', { href: f.url, target: '_blank', rel: 'noopener' }, h( 'img', { src: f.url, alt: f.name || '' } ) ),
					iconBtn( 'close', 'Remove image', () => removeImage( f.id ) )
				) );
			}
		}

		async function ensureSaved() {
			// Images need the note to exist on the server first.
			let n = note();
			if ( n && n.local && ! S.pending.has( n.key ) ) {
				change( n.key, { title: n.title } );
			}
			n = note();
			if ( n && S.pending.has( n.key ) ) {
				await flushOne( n.key );
			}
			n = note();
			return n && ! n.local && n.id ? n : null;
		}

		async function uploadImage( file ) {
			if ( ! needOnline() ) {
				return;
			}
			const placeholder = h( 'figure', { class: 'cp-image cp-image--uploading' }, h( 'img', { alt: 'Uploading' } ) );
			placeholder.querySelector( 'img' ).src = URL.createObjectURL( file );
			els.images.appendChild( placeholder );
			try {
				const n = await ensureSaved();
				if ( ! n ) {
					throw new Error( 'The note could not be saved first.' );
				}
				const blob = await shrink( file );
				if ( blob.size > C.maxUpload ) {
					throw new Error( 'This image is too large (max ' + Math.round( C.maxUpload / 1048576 ) + ' MB).' );
				}
				const form = new FormData();
				form.append( 'file', blob, file.name || 'image.jpg' );
				const data = await api( 'POST', 'notes/' + n.id + '/files', form );
				const target = S.notes.get( noteKey( n.id ) );
				if ( target ) {
					target.files = data.note.files;
					target.modified = data.note.modified;
				}
				renderImages();
				renderLight();
			} catch ( err ) {
				placeholder.remove();
				if ( err instanceof ApiError || isOffline( err ) ) {
					reportError( err );
				} else {
					toast( err.message );
				}
			}
		}

		async function removeImage( fileId ) {
			const n = note();
			if ( ! n || ! n.id || ! needOnline() ) {
				return;
			}
			try {
				const data = await api( 'DELETE', 'notes/' + n.id + '/files/' + fileId );
				n.files = data.note.files;
				renderImages();
				renderLight();
			} catch ( err ) {
				reportError( err );
			}
		}

		/**
		 * Phone photos are large: scale to at most 2000 px and re-save as JPEG.
		 * GIFs (may be animated) and small files are sent as they are.
		 *
		 * @param {File} file
		 * @return {Promise<Blob>} Image to upload.
		 */
		function shrink( file ) {
			return new Promise( ( resolve ) => {
				if ( 'image/gif' === file.type || file.size < 500 * 1024 ) {
					resolve( file );
					return;
				}
				const img = new Image();
				const url = URL.createObjectURL( file );
				img.onload = () => {
					URL.revokeObjectURL( url );
					const max = 2000;
					const scale = Math.min( 1, max / Math.max( img.naturalWidth, img.naturalHeight ) );
					const canvas = document.createElement( 'canvas' );
					canvas.width = Math.round( img.naturalWidth * scale );
					canvas.height = Math.round( img.naturalHeight * scale );
					const ctx = canvas.getContext( '2d' );
					if ( 'image/png' !== file.type ) {
						ctx.fillStyle = '#fff';
						ctx.fillRect( 0, 0, canvas.width, canvas.height );
					}
					ctx.drawImage( img, 0, 0, canvas.width, canvas.height );
					const type = 'image/png' === file.type && scale === 1 ? 'image/png' : 'image/jpeg';
					canvas.toBlob( ( blob ) => resolve( blob && blob.size < file.size ? blob : file ), type, 0.85 );
				};
				img.onerror = () => {
					URL.revokeObjectURL( url );
					resolve( file );
				};
				img.src = url;
			} );
		}

		/* ----- history ----- */

		async function showHistory() {
			const n = note();
			if ( ! n ) {
				return;
			}
			if ( n.local ) {
				toast( 'This note has no earlier versions yet.' );
				return;
			}
			if ( ! needOnline() ) {
				return;
			}
			let data;
			try {
				if ( S.pending.has( n.key ) ) {
					await flushOne( n.key );
				}
				data = await api( 'GET', 'notes/' + n.id + '/history' );
			} catch ( err ) {
				reportError( err );
				return;
			}
			const list = h( 'ul', { class: 'cp-rows' } );
			const d = dialog( 'Earlier versions', [
				h( 'p', { class: 'cp-scope', style: 'margin-top:0' }, 'Earlier text is kept before you change a note, at most once every 10 minutes (up to 50 versions).' ),
				list,
			], null, 'cp-history' );
			d.classList.remove( 'cp-dialog--small' );
			if ( ! data.versions.length ) {
				list.appendChild( h( 'li', { class: 'cp-empty' }, 'No earlier versions yet. They appear after you have edited this note for a while.' ) );
			}
			for ( const v of data.versions ) {
				const preview = v.body || v.checklist.map( ( i ) => ( i.d ? '☑ ' : '☐ ' ) + i.t ).join( '\n' );
				list.appendChild( h( 'li', { class: 'cp-row' },
					h( 'div', { class: 'cp-row__text' },
						h( 'div', { class: 'cp-row__title' }, v.title || 'Untitled note' ),
						h( 'div', { class: 'cp-row__sub' }, fmtFull( v.date ) ),
						preview ? h( 'p', { class: 'cp-row__preview' }, preview ) : null
					),
					h( 'button', { type: 'button', class: 'cp-btn', onClick: async () => {
						if ( ! needOnline() ) {
							return;
						}
						try {
							const res = await api( 'POST', 'notes/' + n.id + '/history/' + v.id + '/restore' );
							const key = noteKey( n.id );
							S.notes.set( key, Object.assign( { key }, res.note ) );
							S.pending.delete( key );
							persist();
							d.close();
							reload();
							render();
							toast( 'Earlier version restored. The text before it is in History too.' );
						} catch ( err ) {
							reportError( err );
						}
					} }, icon( 'restore' ), 'Restore' )
				) );
			}
		}

		/* ----- open / close ----- */

		function values() {
			if ( ! dlg ) {
				return null;
			}
			const n = note();
			return n ? { title: els.title.value, body: els.body.value, checklist: clone( n.checklist ) } : null;
		}

		function reload() {
			if ( ! dlg ) {
				return;
			}
			// Show the note's text even in the field being typed in (fill() normally skips it).
			const n = note();
			if ( n ) {
				els.title.value = n.title;
				els.body.value = n.body;
			}
			fill();
		}

		function close( silent ) {
			if ( ! dlg ) {
				return;
			}
			const key = S.editorKey;
			const d = dlg;
			dlg = null;
			els = {};
			S.editorKey = null;
			closeMenu();
			d.close();
			d.remove();
			if ( viaHistory && ! silent ) {
				viaHistory = false;
				try {
					if ( window.history.state && window.history.state.cpEditor ) {
						window.history.back();
					}
				} catch ( e ) {}
			}
			viaHistory = false;
			if ( key ) {
				discardIfEmpty( key );
			}
			render();
			if ( S.pending.size ) {
				scheduleFlush( 0 );
			}
		}

		window.addEventListener( 'popstate', () => {
			if ( dlg ) {
				viaHistory = false;
				close( true );
			}
		} );

		return { open, close, reload, syncText, addChecklist, isOpen: () => !! dlg, values };
	}() );

	function editorValues() {
		return Editor.values();
	}

	/* =========================================================
	 * Start
	 * ======================================================= */

	function start() {
		restorePending();
		try {
			S.expanded = new Set( JSON.parse( window.localStorage.getItem( 'cp-expanded' ) || '[]' ) );
		} catch ( e ) {
			S.expanded = new Set();
		}
		loadServerState( C.state );
		S.view.folder = S.inbox;
		try {
			const saved = JSON.parse( window.localStorage.getItem( 'cp-view' ) || 'null' );
			if ( saved && 'all' === saved.mode ) {
				S.view.mode = 'all';
			} else if ( saved && saved.folder && S.folders.has( saved.folder ) ) {
				S.view.folder = saved.folder;
			}
		} catch ( e ) {}

		renderShell();
		render();
		setSync( S.pending.size ? 'saving' : 'saved' );
		if ( S.pending.size ) {
			scheduleFlush( 0 );
			toast( 'Saving changes made earlier on this device…' );
		}

		window.addEventListener( 'online', () => {
			flush();
			refreshFromServer();
		} );
		window.addEventListener( 'offline', () => setSync( S.pending.size ? 'offline' : S.sync.state ) );
		document.addEventListener( 'visibilitychange', () => {
			if ( 'hidden' === document.visibilityState ) {
				persist();
			} else if ( Date.now() - S.sync.lastRefresh > 30000 ) {
				refreshFromServer();
			} else if ( S.pending.size ) {
				flush();
			}
		} );
		window.addEventListener( 'pagehide', persist );
		window.addEventListener( 'beforeunload', ( e ) => {
			persist();
			if ( S.pending.size && navigator.onLine ) {
				e.preventDefault();
				e.returnValue = '';
			}
		} );
		window.setInterval( () => {
			if ( S.pending.size && ! S.sync.flushing ) {
				flush();
			}
		}, 15000 );
		document.addEventListener( 'keydown', ( e ) => {
			if ( '/' === e.key && ! Editor.isOpen() && ! /input|textarea|select/i.test( document.activeElement.tagName ) ) {
				e.preventDefault();
				searchInput.focus();
			}
		} );

		// For automated tests and troubleshooting.
		window.cpHub = { state: S, flush, refresh: refreshFromServer };
	}

	start();
}() );
