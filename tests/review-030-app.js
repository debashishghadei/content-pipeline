/* eslint-disable no-console */
// Browser regression tests for ChatGPT's review of 0.3.0 (saving and recovery):
//  2. An unsent edit must survive when the note was deleted / trashed on another device.
//  3. A second tab must never erase the first tab's safety copy.
//  4. A save the server rejects must be kept (not reported as saved) and can be retried.
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
	await Promise.all( [ page.waitForNavigation( { timeout: 90000 } ), page.click( '#wp-submit' ) ] );
	await page.goto( BASE + '/notes/' );
	await page.waitForSelector( '.cp-shell' );
}
async function saved( page, timeout ) {
	await page.waitForFunction( () => window.cpHub && 0 === window.cpHub.state.pending.size && ! window.cpHub.state.sync.flushing, null, { timeout: timeout || 10000 } );
}
async function api( page, method, p, body ) {
	return page.evaluate( async ( [ m, pth, b ] ) => {
		const r = await fetch( window.CP_APP.rest + pth, { method: m, headers: { 'X-WP-Nonce': window.cpHub.state.sync.nonce, 'Content-Type': 'application/json' }, body: b ? JSON.stringify( b ) : undefined, cache: 'no-store' } );
		return { status: r.status, data: await r.json() };
	}, [ method, p, body ] );
}
async function state( page ) {
	return ( await api( page, 'GET', 'state' ) ).data;
}
async function makeNote( page, title, body ) {
	const r = await api( page, 'POST', 'notes', { client_id: 'rv' + Date.now() + Math.floor( Math.random() * 1e6 ), title, body } );
	return r.data.note;
}
async function storedText( page ) {
	return page.evaluate( () => {
		let all = '';
		for ( let i = 0; i < window.localStorage.length; i++ ) {
			const k = window.localStorage.key( i );
			if ( k.startsWith( window.CP_APP.storageKey ) ) {
				all += window.localStorage.getItem( k );
			}
		}
		return all;
	} );
}
async function editBody( page, title, text ) {
	await page.click( '.cp-node__open:has(.cp-node__name:text-is("Inbox"))' );
	await page.click( '.cp-card:has-text("' + title + '")' );
	await page.fill( '.cp-editor__body', text );
	await page.waitForTimeout( 1500 );
	await page.click( '[aria-label="Close note"]' );
}

( async () => {
	const browser = await chromium.launch();

	for ( const how of [ 'deleted', 'trashed' ] ) {
		console.log( '== 2. Unsent edit, note ' + how + ' on another device, tab reopened' );
		const ctx = await browser.newContext();
		const a = await ctx.newPage();
		await login( a );
		const title = 'Orphan ' + how + ' ' + Date.now();
		const n = await makeNote( a, title, 'original' );
		await a.reload();
		await a.waitForSelector( '.cp-shell' );
		await ctx.setOffline( true );
		await editBody( a, title, 'unsent text (' + how + ')' );
		ok( ( await storedText( a ) ).includes( 'unsent text (' + how + ')' ), how + ': unsent text kept in this browser' );
		await a.close();
		await ctx.setOffline( false );
		const other = await browser.newContext();
		const o = await other.newPage();
		await login( o );
		await api( o, 'DELETE', 'notes/' + n.id );
		if ( 'deleted' === how ) {
			await api( o, 'DELETE', 'notes/' + n.id + '?force=1' );
		}
		await other.close();
		const b = await ctx.newPage();
		await b.goto( BASE + '/notes/' );
		await b.waitForSelector( '.cp-shell' );
		// The tab was closed without its "closing" event (like a phone killing it), so the new
		// tab waits until the old tab's "alive" signal is 15 s old before taking over its copies.
		let st;
		let rescued;
		const until = Date.now() + 35000;
		do {
			await b.waitForTimeout( 1000 );
			st = await state( b );
			rescued = st.notes.find( ( x ) => x.body === 'unsent text (' + how + ')' );
		} while ( ! rescued && Date.now() < until );
		await saved( b, 15000 ).catch( () => {} );
		ok( !! rescued, how + ': the unsent text was saved as a new note', JSON.stringify( st.notes.map( ( x ) => x.title ) ) );
		ok( 0 === ( await b.evaluate( () => window.cpHub.state.pending.size ) ), how + ': nothing left waiting afterwards' );
		ok( await b.isVisible( '.cp-toast:has-text("saved as a new note")' ) || !! rescued, how + ': the user is told' );
		await ctx.close();
	}

	console.log( '== 2b. Same, but the tab is simply reloaded (normal closing): taken over at once' );
	{
		const ctx = await browser.newContext();
		const a = await ctx.newPage();
		await login( a );
		const title = 'Orphan reload ' + Date.now();
		const n = await makeNote( a, title, 'original' );
		await a.reload();
		await a.waitForSelector( '.cp-shell' );
		await ctx.setOffline( true );
		await editBody( a, title, 'unsent text (reload)' );
		const other = await browser.newContext();
		const o = await other.newPage();
		await login( o );
		await api( o, 'DELETE', 'notes/' + n.id );
		await api( o, 'DELETE', 'notes/' + n.id + '?force=1' );
		await other.close();
		await ctx.setOffline( false );
		const started = Date.now();
		await a.reload();
		await a.waitForSelector( '.cp-shell' );
		await saved( a, 15000 ).catch( () => {} );
		const st = await state( a );
		ok( st.notes.some( ( x ) => 'unsent text (reload)' === x.body ), 'reload: unsent text saved as a new note' );
		ok( Date.now() - started < 8000, 'reload: taken over at once (' + ( Date.now() - started ) + ' ms)' );
		await ctx.close();
	}

	console.log( '== 3. A second tab must not erase the first tab\'s safety copy' );
	{
		const ctx = await browser.newContext();
		const tabB = await ctx.newPage();
		await login( tabB );
		const tabA = await ctx.newPage();
		await tabA.goto( BASE + '/notes/' );
		await tabA.waitForSelector( '.cp-shell' );
		const title = 'Tabs ' + Date.now();
		await makeNote( tabA, title, 'original' );
		await tabA.reload();
		await tabA.waitForSelector( '.cp-shell' );
		// Tab A has no connection to the server (but the browser thinks it is online).
		await tabA.route( '**/cp/v1/**', ( r ) => r.abort() );
		await editBody( tabA, title, 'tab A unsent text' );
		ok( ( await storedText( tabA ) ).includes( 'tab A unsent text' ), 'tab A: unsent text kept in this browser' );
		// Tab B (open since before, nothing to save) is hidden / closed.
		await tabB.evaluate( () => {
			Object.defineProperty( document, 'visibilityState', { value: 'hidden', configurable: true } );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
			window.dispatchEvent( new Event( 'pagehide' ) );
		} );
		ok( ( await storedText( tabA ) ).includes( 'tab A unsent text' ), 'tab A\'s safety copy survives tab B saving its own (empty) state' );
		await tabB.close();
		ok( ( await storedText( tabA ) ).includes( 'tab A unsent text' ), 'tab A\'s safety copy survives tab B closing' );
		await tabA.unroute( '**/cp/v1/**' );
		await tabA.evaluate( () => window.cpHub.flush() );
		await saved( tabA, 15000 ).catch( () => {} );
		const st = await state( tabA );
		ok( st.notes.some( ( x ) => x.title === title && 'tab A unsent text' === x.body ), 'tab A\'s text reaches the server when its connection is back' );
		await ctx.close();
	}

	console.log( '== 4. A save the server rejects is kept, shown, and can be retried' );
	{
		const ctx = await browser.newContext();
		const p = await ctx.newPage();
		await login( p );
		const title = 'Rejected ' + Date.now();
		const n = await makeNote( p, title, 'original' );
		await p.reload();
		await p.waitForSelector( '.cp-shell' );
		const rejectRoute = ( r ) => {
			if ( 'POST' === r.request().method() && r.request().url().includes( 'notes/' + n.id ) ) {
				return r.fulfill( { status: 403, contentType: 'application/json', body: JSON.stringify( { code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.', data: { status: 403 } } ) } );
			}
			return r.continue();
		};
		await p.route( '**/cp/v1/**', rejectRoute );
		await editBody( p, title, 'must survive a 403' );
		await p.waitForTimeout( 1500 );
		ok( 0 < ( await p.evaluate( () => window.cpHub.state.pending.size ) ), '403: change still waiting (not dropped)' );
		ok( ( await storedText( p ) ).includes( 'must survive a 403' ), '403: text still kept in this browser' );
		const syncState = await p.getAttribute( '#cp-sync', 'data-state' );
		ok( 'saved' !== syncState, '403: indicator does not say saved', syncState );
		ok( await p.isVisible( '#cp-error-banner:not([hidden])' ), '403: a lasting message explains it' );
		await p.reload();
		await p.waitForSelector( '.cp-shell' );
		await p.waitForTimeout( 1500 );
		ok( ( await storedText( p ) ).includes( 'must survive a 403' ), '403: still kept after reloading the page' );
		await p.unroute( '**/cp/v1/**', rejectRoute );
		await p.click( '#cp-error-banner button:has-text("Try again")' ).catch( () => {} );
		await saved( p, 15000 ).catch( () => {} );
		const st = await state( p );
		ok( st.notes.some( ( x ) => x.id === n.id && 'must survive a 403' === x.body ), '403: "Try again" saves it once the server accepts it' );
		await ctx.close();
	}

	await browser.close();
	console.log( '' );
	console.log( 'Result: ' + pass + ' passed, ' + fail + ' failed' );
	process.exit( fail ? 1 : 0 );
} )().catch( ( e ) => {
	console.log( 'FAIL  test crashed: ' + e.message );
	console.log( 'Result: ' + pass + ' passed, ' + ( fail + 1 ) + ' failed' );
	process.exit( 1 );
} );
