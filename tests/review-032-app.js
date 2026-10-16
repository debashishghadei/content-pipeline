/* eslint-disable no-console */
// Browser regression test for ChatGPT's review of 0.3.2:
// when the CURRENT tab rescues a note deleted on another device while browser storage is
// full, its existing safety copy must be kept until the replacement copy is stored.
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
async function storedCopies( page, text ) {
	return page.evaluate( ( t ) => Object.keys( window.localStorage ).filter( ( k ) => k.startsWith( window.CP_APP.storageKey + ':rec:' ) && window.localStorage.getItem( k ).includes( t ) ), text );
}
async function storageFull( page, full ) {
	await page.evaluate( ( on ) => {
		if ( ! window.__realSetItem ) {
			window.__realSetItem = Storage.prototype.setItem;
		}
		Storage.prototype.setItem = on
			? function ( k, v ) {
				if ( String( k ).includes( ':rec:' ) ) {
					const e = new Error( 'The quota has been exceeded.' );
					e.name = 'QuotaExceededError';
					throw e;
				}
				return window.__realSetItem.call( this, k, v );
			}
			: window.__realSetItem;
	}, full );
}

( async () => {
	const browser = await chromium.launch();

	console.log( '== Rescue of a note deleted elsewhere while storage is full (same tab)' );
	{
		const ctx = await browser.newContext();
		const p = await ctx.newPage();
		await login( p );
		const title = 'Rescue full ' + Date.now();
		const note = ( await api( p, 'POST', 'notes', { client_id: 'rf' + Date.now(), title, body: 'original' } ) ).data.note;
		await p.reload();
		await p.waitForSelector( '.cp-shell' );
		const TEXT = 'only copy, rescue while full ' + Date.now();

		await ctx.setOffline( true );
		await p.click( '.cp-node__open:has(.cp-node__name:text-is("Inbox"))' );
		await p.click( '.cp-card:has-text("' + title + '")' );
		await p.fill( '.cp-editor__body', TEXT );
		await p.waitForTimeout( 1200 );
		await p.click( '[aria-label="Close note"]' );
		const before = await storedCopies( p, TEXT );
		ok( 1 === before.length, '1. unsaved text stored locally' );

		const other = await browser.newContext();
		const o = await other.newPage();
		await login( o );
		await api( o, 'DELETE', 'notes/' + note.id );
		await api( o, 'DELETE', 'notes/' + note.id + '?force=1' );
		await other.close();
		ok( true, '2. another device deleted the note' );

		await storageFull( p, true );
		// Only the rescue (404 → queue a new note) should run now, not the new note's upload yet.
		await p.route( '**/cp/v1/notes', ( r ) => ( 'POST' === r.request().method() ? r.abort() : r.continue() ) );
		await ctx.setOffline( false );
		await p.evaluate( () => window.cpHub.flush() );
		await p.waitForFunction( () => Array.from( window.cpHub.state.pending.values() ).some( ( e ) => e.create ), null, { timeout: 10000 } ).catch( () => {} );
		ok( await p.evaluate( ( t ) => Array.from( window.cpHub.state.pending.values() ).some( ( e ) => e.create && JSON.stringify( e ).includes( t ) ), TEXT ), '3. the 404 queued a replacement note' );
		const during = await storedCopies( p, TEXT );
		ok( during.includes( before[ 0 ] ), '4–5. storage full: the existing safety copy is kept', JSON.stringify( during ) );
		ok( 'error' === await p.getAttribute( '#cp-sync', 'data-state' ), 'storage problem shown' );

		await storageFull( p, false );
		await p.unroute( '**/cp/v1/notes' );
		await p.evaluate( () => window.cpHub.flush() );
		await p.waitForFunction( () => 0 === window.cpHub.state.pending.size, null, { timeout: 15000 } ).catch( () => {} );
		const after = await storedCopies( p, TEXT );
		ok( 0 === after.length, 'storage works again + saved: no copies left over', JSON.stringify( after ) );
		const st = ( await api( p, 'GET', 'state' ) ).data;
		ok( 1 === st.notes.filter( ( x ) => x.body === TEXT ).length, 'the text is on the server exactly once' );
		await ctx.close();
	}

	console.log( '== A new note gets its server id while storage is full (record key changes)' );
	{
		const ctx = await browser.newContext();
		const p = await ctx.newPage();
		await login( p );
		const TEXT = 'new note while full ' + Date.now();
		await p.route( '**/cp/v1/notes', ( r ) => ( 'POST' === r.request().method() ? r.abort() : r.continue() ) );
		await p.click( '.cp-capture__input' );
		await p.fill( '.cp-editor__title', 'Rekey full' );
		await p.fill( '.cp-editor__body', TEXT );
		await p.waitForTimeout( 1500 );
		const localCopy = ( await storedCopies( p, TEXT ) )[ 0 ];
		ok( !! localCopy, 'new note stored locally (not yet on the server)' );
		await storageFull( p, true );
		// Create succeeds, and more typing happens meanwhile, so the note keeps a pending change under its new key.
		await p.unroute( '**/cp/v1/notes' );
		await p.route( '**/cp/v1/notes', async ( r ) => {
			if ( 'POST' === r.request().method() ) {
				await p.evaluate( () => {
					document.querySelector( '.cp-editor__body' ).value += ' + typed during upload';
					document.querySelector( '.cp-editor__body' ).dispatchEvent( new Event( 'input' ) );
				} ).catch( () => {} );
			}
			return r.continue();
		} );
		// Hold back the follow-up save of the extra typing, so the note stays unsaved under its new key.
		await p.route( '**/cp/v1/notes/*', ( r ) => ( 'POST' === r.request().method() ? r.abort() : r.continue() ) );
		await p.evaluate( () => window.cpHub.flush() );
		await p.waitForFunction( () => Array.from( window.cpHub.state.pending.keys() ).some( ( k ) => /^n\d+$/.test( k ) ), null, { timeout: 10000 } ).catch( () => {} );
		ok( await p.evaluate( () => Array.from( window.cpHub.state.pending.keys() ).some( ( k ) => /^n\d+$/.test( k ) ) ), 'note created on the server; extra typing still waiting under the new key' );
		const during = await storedCopies( p, TEXT );
		ok( during.includes( localCopy ), 'storage full: the earlier copy is kept while the new-key copy cannot be written', JSON.stringify( during ) );
		await storageFull( p, false );
		await p.unroute( '**/cp/v1/notes' );
		await p.unroute( '**/cp/v1/notes/*' );
		await p.evaluate( () => window.cpHub.flush() );
		await p.waitForFunction( () => 0 === window.cpHub.state.pending.size, null, { timeout: 15000 } ).catch( () => {} );
		ok( 0 === ( await storedCopies( p, TEXT ) ).length, 'after saving: no copies left over' );
		const st = ( await api( p, 'GET', 'state' ) ).data;
		ok( st.notes.some( ( x ) => x.title === 'Rekey full' && x.body.endsWith( '+ typed during upload' ) ), 'all text reached the server' );
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
