/**
 * Ollama connection test. Runs in the browser on the user's PC.
 */
( function () {
	'use strict';

	const $ = ( id ) => document.getElementById( id );
	const urlInput = $( 'cp-ollama-url' );
	const result = $( 'cp-ollama-result' );
	const tryBox = $( 'cp-ollama-try' );
	const modelSel = $( 'cp-ollama-model' );
	const output = $( 'cp-ollama-output' );
	if ( ! urlInput ) {
		return;
	}

	try {
		const saved = window.localStorage.getItem( 'cp-ollama-url' );
		if ( saved ) {
			urlInput.value = saved;
		}
	} catch ( e ) {}

	function base() {
		return urlInput.value.trim().replace( /\/+$/, '' );
	}

	function notice( el, type, title, lines ) {
		el.textContent = '';
		const box = document.createElement( 'div' );
		box.className = 'notice inline notice-' + type;
		const p = document.createElement( 'p' );
		const strong = document.createElement( 'strong' );
		strong.textContent = title;
		p.appendChild( strong );
		box.appendChild( p );
		for ( const line of lines || [] ) {
			const lp = document.createElement( 'p' );
			lp.textContent = line;
			box.appendChild( lp );
		}
		el.appendChild( box );
	}

	async function getJson( path, options ) {
		const res = await fetch( base() + path, Object.assign( { cache: 'no-store' }, options || {} ) );
		if ( ! res.ok ) {
			const err = new Error( 'HTTP ' + res.status );
			err.status = res.status;
			throw err;
		}
		return res.json();
	}

	function explain( err ) {
		if ( 403 === err.status ) {
			return [ 'Ollama answered but refused this site (403). Set OLLAMA_ORIGINS to ' + window.CP_OLLAMA.origin + ' and restart Ollama (steps below).' ];
		}
		return [
			'The browser could not reach Ollama at ' + base() + '.',
			'Usual reasons: Ollama is not running; OLLAMA_ORIGINS does not include ' + window.CP_OLLAMA.origin + ' (then the browser blocks the answer); or Chrome blocked local network access. See the steps below.',
		];
	}

	async function check() {
		try {
			window.localStorage.setItem( 'cp-ollama-url', base() );
		} catch ( e ) {}
		notice( result, 'info', 'Checking…' );
		tryBox.hidden = true;
		try {
			const version = await getJson( '/api/version' );
			const tags = await getJson( '/api/tags' );
			const models = ( tags.models || [] ).map( ( m ) => ( { name: m.name, size: m.size || 0 } ) );
			modelSel.textContent = '';
			for ( const m of models ) {
				const o = document.createElement( 'option' );
				o.value = m.name;
				o.textContent = m.name + ( m.size ? ' (' + ( m.size / 1073741824 ).toFixed( 1 ) + ' GB)' : '' );
				modelSel.appendChild( o );
			}
			if ( models.length ) {
				notice( result, 'success', 'Connected to Ollama ' + ( version.version || '' ) + '.', [ models.length + ' model' + ( 1 === models.length ? '' : 's' ) + ' found: ' + models.map( ( m ) => m.name ).join( ', ' ) ] );
				tryBox.hidden = false;
			} else {
				notice( result, 'warning', 'Connected to Ollama ' + ( version.version || '' ) + ', but no models are installed.', [ 'Download one first in a terminal: ollama pull MODEL-NAME (see ollama.com/library).' ] );
			}
		} catch ( err ) {
			notice( result, 'error', 'Not connected.', explain( err ) );
		}
	}

	async function run() {
		const model = modelSel.value;
		const prompt = $( 'cp-ollama-prompt' ).value;
		const button = $( 'cp-ollama-run' );
		button.disabled = true;
		notice( output, 'info', 'Running ' + model + '… the first run can take a while because the model is loading.' );
		const started = performance.now();
		try {
			const data = await getJson( '/api/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { model, prompt, stream: false } ),
			} );
			const seconds = ( performance.now() - started ) / 1000;
			const speed = data.eval_count && data.eval_duration ? ( data.eval_count / ( data.eval_duration / 1e9 ) ).toFixed( 1 ) + ' words/s (tokens per second)' : '';
			notice( output, 'success', 'Answer from ' + model + ' in ' + seconds.toFixed( 1 ) + ' s' + ( speed ? ' · ' + speed : '' ), [ data.response || '' ] );
		} catch ( err ) {
			notice( output, 'error', 'The test prompt failed.', explain( err ) );
		} finally {
			button.disabled = false;
		}
	}

	$( 'cp-ollama-check' ).addEventListener( 'click', check );
	$( 'cp-ollama-run' ).addEventListener( 'click', run );
	$( 'cp-ollama-copy' ).addEventListener( 'click', () => {
		const text = $( 'cp-ollama-origin' ).textContent;
		if ( navigator.clipboard ) {
			navigator.clipboard.writeText( text );
		}
	} );
}() );
