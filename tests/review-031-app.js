/* eslint-disable no-console */
// Browser regression test for ChatGPT's review of 0.3.1:
// taking over another tab's safety copy must never delete the old copy unless the
// replacement was stored successfully (e.g. browser storage full).
// DISPOSABLE TEST SITES ONLY. Env: BASE, PW (playwright package path).
const { chromium } = require( process.env.PW || 'playwright' );
const BASE = process.env.BASE || 'http://localhost:8080';

let pass = 0;
let fail = 0;
function ok( cond, name, detail ) {
	if ( cond ) {
		pass++;
		console.log( 'PASS  ' + name );
	} else {
		fail++;
		console.log( 'FAIL  ' + name + ( detail ? '  (' + detail + ')' : '' ) );
	}
}
async function login( page ) {
	await page.goto( BASE + '/wp-login.php' );
	await page.fill( '#user_login', 'admin' );
	await page.fill( '#user_pass', 'admin' );
	await Promise.all( [ page.waitForNavigation(), page.click( '#wp-submit' ) ] );
	await page.goto( BASE + '/notes/' );
	await page.waitForSelector( '.cp-shell' );
}
async function api( page, method, p, body ) {
	return page.evaluate( async ( [ m, pth, b ] ) => {
		const r = await fetch( window.CP_APP.rest + pth, { method: m, headers: { 'X-WP-Nonce': window.cpHub.state.sync.nonce, 'Content-Type': 'application/json' }, body: b ? JSON.stringify( b ) : undefined, cache: 'no-store' } );
		return { status: r.status, data: await r.json() };
	}, [ method, p, body ] );
}
// Run the takeover now (0.3.1 has no test hook: wait for its 5-second timer instead).
async function adopt( page ) {
	if ( await page.evaluate( () => 'function' === typeof window.cpHub.adopt ) ) {
		await page.evaluate( () => window.cpHub.adopt() );
	} else {
		await page.waitForTimeout( 6000 );
	}
}
// Safety-copy records ("rec") holding a text, grouped by tab id.
async function records( page, text ) {
	return page.evaluate( ( t ) => {
		const out = [];
		for ( const k of Object.keys( window.localStorage ) ) {
			if ( k.startsWith( window.CP_APP.storageKey + ':rec:' ) && window.localStorage.getItem( k ).includes( t ) ) {
				out.push( k.split( ':rec:' )[ 1 ].split( ':' )[ 0 ] );
			}
		}
		return out;
	}, text );
}

( async () => {
	const browser = await chromium.launch();
	const ctx = await browser.newContext();
	const tabB = await ctx.newPage();
	await login( tabB );
	const tabA = await ctx.newPage();
	await tabA.goto( BASE + '/notes/' );
	await tabA.waitForSelector( '.cp-shell' );
	const title = 'Takeover ' + Date.now();
	const note = ( await api( tabA, 'POST', 'notes', { client_id: 'to' + Date.now(), title, body: 'original' } ) ).data.note;
	await tabA.reload();
	await tabA.waitForSelector( '.cp-shell' );
	const TEXT = 'only copy of this text ' + Date.now();

	console.log( '== Tab A has unsent text, then goes away' );
	await ctx.setOffline( true );
	await tabA.click( '.cp-node__open:has(.cp-node__name:text-is("Inbox"))' );
	await tabA.click( '.cp-card:has-text("' + title + '")' );
	await tabA.fill( '.cp-editor__body', TEXT );
	await tabA.waitForTimeout( 1200 );
	const tabAId = ( await records( tabA, TEXT ) )[ 0 ];
	ok( !! tabAId, 'tab A stored its safety copy' );
	await tabA.evaluate( () => window.dispatchEvent( new Event( 'pagehide' ) ) ); // marks tab A as gone
	await tabA.close();

	console.log( '== Tab B takes over while its own writes fail (storage full)' );
	await tabB.evaluate( () => {
		window.__realSetItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function ( k, v ) {
			if ( String( k ).includes( ':rec:' ) ) {
				const e = new Error( 'The quota has been exceeded.' );
				e.name = 'QuotaExceededError';
				throw e;
			}
			return window.__realSetItem.call( this, k, v );
		};
	} );
	await adopt( tabB );
	const afterFail = await records( tabB, TEXT );
	ok( afterFail.includes( tabAId ), 'old safety copy kept when the replacement could not be written', JSON.stringify( afterFail ) );
	ok( await tabB.evaluate( ( t ) => Array.from( window.cpHub.state.pending.values() ).some( ( e ) => JSON.stringify( e ).includes( t ) ), TEXT ), 'tab B holds the text and will save it' );
	ok( 'error' === await tabB.getAttribute( '#cp-sync', 'data-state' ), 'tab B shows a storage problem (not "saved")', await tabB.getAttribute( '#cp-sync', 'data-state' ) );
	await adopt( tabB );
	ok( 1 === ( await tabB.evaluate( ( t ) => Array.from( window.cpHub.state.pending.values() ).filter( ( e ) => JSON.stringify( e ).includes( t ) ).length, TEXT ) ), 'trying again does not take the same copy twice' );

	console.log( '== Storage works again' );
	await tabB.evaluate( () => {
		Storage.prototype.setItem = window.__realSetItem;
	} );
	await adopt( tabB );
	const afterOk = await records( tabB, TEXT );
	ok( afterOk.length === 1 && afterOk[ 0 ] !== tabAId, 'replacement stored, then the old copy removed', JSON.stringify( afterOk ) );

	await ctx.setOffline( false );
	await tabB.evaluate( () => window.cpHub.flush() );
	await tabB.waitForFunction( () => 0 === window.cpHub.state.pending.size, null, { timeout: 15000 } ).catch( () => {} );
	const st = ( await api( tabB, 'GET', 'state' ) ).data;
	ok( st.notes.some( ( x ) => x.id === note.id && x.body === TEXT ), 'the text reaches the server' );
	ok( ! st.notes.some( ( x ) => / \(unsaved copy\)$/.test( x.title ) && x.body === TEXT ), 'no duplicate "(unsaved copy)" note' );

	await browser.close();
	console.log( '' );
	console.log( 'Result: ' + pass + ' passed, ' + fail + ' failed' );
	process.exit( fail ? 1 : 0 );
} )().catch( ( e ) => {
	console.log( 'FAIL  test crashed: ' + e.message );
	console.log( 'Result: ' + pass + ' passed, ' + ( fail + 1 ) + ' failed' );
	process.exit( 1 );
} );
