/* eslint-disable no-console */
// Browser tests for ChatGPT's review of 0.4.0:
//  1. A refused article write is not shown as saved; the text stays waiting and is saved later.
//  2. A conflict answer must not throw away typing made while the save was on its way.
//  3. (workflow) The app warns when the draft changed after polishing and says which text is exported.
// DISPOSABLE TEST SITES ONLY (run through tests/app-tests.sh): writes a temporary mu-plugin
// into WP_DIR that makes WordPress refuse article updates. Env: BASE, PW, WP_DIR.
const fs = require( 'fs' );
const path = require( 'path' );
const { chromium } = require( process.env.PW || 'playwright' );
const BASE = process.env.BASE || 'http://localhost:8080';
const WP_DIR = process.env.WP_DIR || '/home/claude/rig/wp';
const MU = path.join( WP_DIR, 'wp-content/mu-plugins/rig-cp-reject.php' );

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
const rejectOn = () => fs.writeFileSync( MU, "<?php // Test only.\nadd_filter( 'wp_insert_post_empty_content', static function ( $m, $p ) { return ( 'cp_article' === ( $p['post_type'] ?? '' ) && ! empty( $p['ID'] ) ) ? true : $m; }, 10, 2 );\n" );
const rejectOff = () => fs.existsSync( MU ) && fs.unlinkSync( MU );

async function login( page ) {
	await page.goto( BASE + '/wp-login.php' );
	await page.fill( '#user_login', 'admin' );
	await page.fill( '#user_pass', 'admin' );
	await Promise.all( [ page.waitForNavigation( { timeout: 90000 } ), page.click( '#wp-submit' ) ] );
	await page.goto( BASE + '/notes/' );
	await page.waitForSelector( '.cp-shell' );
}
async function api( page, method, p, body ) {
	return page.evaluate( async ( [ m, pth, b ] ) => {
		const r = await fetch( window.CP_APP.rest + pth, { method: m, headers: { 'X-WP-Nonce': window.cpHub.state.sync.nonce, 'Content-Type': 'application/json' }, body: b ? JSON.stringify( b ) : undefined, cache: 'no-store' } );
		return { status: r.status, data: await r.json() };
	}, [ method, p, body ] );
}
async function saved( page, timeout ) {
	await page.waitForFunction( () => window.cpHub && 0 === window.cpHub.state.pending.size && ! window.cpHub.state.sync.flushing, null, { timeout: timeout || 15000 } );
}
const rnd = () => 'r' + Date.now() + Math.floor( Math.random() * 1e6 );
async function newArticle( page, title ) {
	const n = ( await api( page, 'POST', 'notes', { client_id: rnd(), title, body: 'idea' } ) ).data.note;
	return ( await api( page, 'POST', 'articles', { client_id: rnd(), note: n.id } ) ).data.article;
}
async function openArticle( page, id, stepLabel ) {
	await page.goto( BASE + '/notes/#article=' + id );
	await page.reload();
	await page.waitForSelector( '.cp-steps' );
	await page.click( '.cp-steps__btn:has(.cp-steps__label:text-is("' + stepLabel + '"))' );
	await page.waitForSelector( '.cp-step__title:has-text("' + stepLabel + '")' );
}
async function fieldOf( page, id, field ) {
	return ( await api( page, 'GET', 'articles/' + id ) ).data.article.fields[ field ] || {};
}

( async () => {
	const browser = await chromium.launch();
	const ctx = await browser.newContext( { viewport: { width: 1280, height: 900 }, permissions: [ 'clipboard-read', 'clipboard-write' ] } );
	const p = await ctx.newPage();
	try {
		await login( p );

		console.log( '== 1. WordPress refuses the write: the text is not reported as saved' );
		{
			const a = await newArticle( p, 'Refused write ' + Date.now() );
			await openArticle( p, a.id, 'Cleanup' );
			rejectOn();
			await p.fill( '.cp-step__body textarea[data-field="cleanup"]', 'typed while the server refuses' );
			await p.waitForTimeout( 3000 );
			const st = await p.evaluate( () => ( { pending: Array.from( window.cpHub.state.pending.values() ).filter( ( e ) => 'article' === e.kind ).map( ( e ) => e.value ), sync: window.cpHub.state.sync.state } ) );
			ok( st.pending.includes( 'typed while the server refuses' ), 'the change is still waiting (kept in the browser)', JSON.stringify( st ) );
			ok( 'saved' !== st.sync, 'the app does not say "Saved"', st.sync );
			ok( ! ( await fieldOf( p, a.id, 'cleanup' ) ).value, 'nothing stored on the server (as expected while refusing)' );
			rejectOff();
			await p.evaluate( () => window.cpHub.flush() );
			await saved( p, 20000 ).catch( () => {} );
			ok( 'typed while the server refuses' === ( await fieldOf( p, a.id, 'cleanup' ) ).value, 'after the problem is gone the text is saved' );
		}

		console.log( '== 2. Conflict answer while more text was typed during the save' );
		{
			const a = await newArticle( p, 'Conflict typing ' + Date.now() );
			await api( p, 'POST', 'articles/' + a.id, { field: 'cleanup', value: 'version 1', base_rev: 0 } );
			await openArticle( p, a.id, 'Cleanup' );
			// Another device changes the same step: this tab still works on revision 1.
			await api( p, 'POST', 'articles/' + a.id, { field: 'cleanup', value: 'from another device', base_rev: 1 } );
			// Slow down this tab's article saves so more typing happens while one is on its way.
			let held = 0;
			await p.route( /\/cp\/v1\/articles\/\d+/, async ( route ) => {
				if ( 'POST' === route.request().method() ) {
					held++;
					await new Promise( ( r ) => setTimeout( r, 2500 ) );
				}
				await route.continue();
			} );
			const box = '.cp-step__body textarea[data-field="cleanup"]';
			await p.fill( box, 'version 1 + first typing' );
			await p.waitForFunction( () => window.cpHub.state.sync.flushing, null, { timeout: 5000 } );
			await p.click( box );
			await p.keyboard.press( 'End' );
			await p.keyboard.type( ' + later typing' );
			await p.click( '.cp-step__title' ); // leave the box
			await saved( p, 30000 ).catch( () => {} );
			await p.unroute( /\/cp\/v1\/articles\/\d+/ );
			const f = await fieldOf( p, a.id, 'cleanup' );
			const all = [ f.value ].concat( ( f.versions || [] ).map( ( v ) => v.value ) );
			ok( held >= 1, 'a save was on its way while typing (' + held + ' slowed)' );
			ok( 'from another device' === f.value, 'the other device\'s text stays the current text', f.value );
			ok( all.includes( 'version 1 + first typing + later typing' ), 'the later typing is kept (in Earlier versions)', JSON.stringify( all ) );
			const left = await p.evaluate( () => window.cpHub.state.pending.size );
			ok( 0 === left, 'nothing left waiting afterwards' );
			ok( 'from another device' === await p.inputValue( box ), 'the box shows the current text after the conflict', await p.inputValue( box ) );
			// Typing now must not overwrite the other device's text unnoticed.
			await p.fill( box, 'from another device, edited here' );
			await saved( p );
			const g = await fieldOf( p, a.id, 'cleanup' );
			ok( 'from another device, edited here' === g.value, 'editing the shown text afterwards saves normally', g.value );
		}

		console.log( '== 2b. Same, but the box keeps the focus the whole time' );
		{
			const a = await newArticle( p, 'Conflict focus ' + Date.now() );
			await api( p, 'POST', 'articles/' + a.id, { field: 'cleanup', value: 'start', base_rev: 0 } );
			await openArticle( p, a.id, 'Cleanup' );
			await api( p, 'POST', 'articles/' + a.id, { field: 'cleanup', value: 'other device', base_rev: 1 } );
			await p.route( /\/cp\/v1\/articles\/\d+/, async ( route ) => {
				if ( 'POST' === route.request().method() ) {
					await new Promise( ( r ) => setTimeout( r, 1500 ) );
				}
				await route.continue();
			} );
			const box = '.cp-step__body textarea[data-field="cleanup"]';
			await p.click( box );
			await p.keyboard.press( 'End' );
			await p.keyboard.type( ' A' );
			await p.waitForFunction( () => window.cpHub.state.sync.flushing, null, { timeout: 5000 } );
			await p.keyboard.type( ' B' );
			await saved( p, 30000 ).catch( () => {} );
			await p.unroute( /\/cp\/v1\/articles\/\d+/ );
			ok( await p.evaluate( ( b ) => document.activeElement === document.querySelector( b ), box ), 'the box still has the focus' );
			ok( 'other device' === await p.inputValue( box ), 'the box now shows the current text', await p.inputValue( box ) );
			// Typing on now edits the current text, so nothing of the other device is lost.
			await p.keyboard.press( 'End' );
			await p.keyboard.type( ' C' );
			await saved( p );
			const f = await fieldOf( p, a.id, 'cleanup' );
			const all = ( f.versions || [] ).map( ( v ) => v.value );
			ok( 'other device C' === f.value, 'further typing builds on the other device\'s text', f.value );
			ok( all.includes( 'start A B' ), 'everything typed before is in Earlier versions', JSON.stringify( all ) );
		}

		console.log( '== 3. Draft changed after polishing' );
		{
			const a = await newArticle( p, 'Stale polish ' + Date.now() );
			const post = ( field, value, base ) => api( p, 'POST', 'articles/' + a.id, { field, value, base_rev: base || 0 } );
			await post( 'outline', [ { id: 'sec1a', heading: 'Why', brief: '', words: 100 }, { id: 'sec2b', heading: 'How', brief: '', words: 100 } ] );
			await post( 'approved', true );
			await post( 'section:sec1a', 'Draft one.' );
			await post( 'section:sec2b', 'Draft two.' );
			await post( 'polish', '## Why\n\nPolished one.\n\n## How\n\nPolished two.' );
			await openArticle( p, a.id, 'Copy to WordPress' );
			let text = await p.textContent( '.cp-step__body' );
			ok( /polished/i.test( text ) && ! /changed after polishing/i.test( text ), 'export says it uses the polished text, no warning yet' );
			await new Promise( ( r ) => setTimeout( r, 1100 ) ); // timestamps have 1-second steps
			await post( 'section:sec2b', 'Draft two, corrected.', 1 );
			await openArticle( p, a.id, 'Copy to WordPress' );
			text = await p.textContent( '.cp-step__body' );
			ok( /changed after polishing/i.test( text ), 'export warns that the draft changed after polishing', text.slice( 0, 300 ) );
			ok( /How/.test( ( await p.textContent( '.cp-exported' ) ) || '' ), 'the warning names the changed section' );
			await openArticle( p, a.id, 'Check' );
			ok( /changed after polishing/i.test( await p.textContent( '.cp-step__body' ) ), 'check warns too' );
			await openArticle( p, a.id, 'Polish' );
			ok( /changed after polishing/i.test( await p.textContent( '.cp-step__body' ) ), 'polish warns too' );
			// Choose to export the draft instead.
			await openArticle( p, a.id, 'Copy to WordPress' );
			await p.click( '.cp-exported button:has-text("Use the draft")' );
			await saved( p );
			text = await p.textContent( '.cp-preview' );
			ok( /corrected/.test( text ) && ! /Polished/.test( text ), 'after "Use the draft" the export contains the corrected draft', text.slice( 0, 200 ) );
			ok( true === ( await fieldOf( p, a.id, 'use_draft' ) ).value, 'the choice is saved with the article' );
			await openArticle( p, a.id, 'Copy to WordPress' );
			ok( /draft/i.test( await p.textContent( '.cp-exported' ) ) && /corrected/.test( await p.textContent( '.cp-preview' ) ), 'the choice is remembered after reopening' );
			await p.click( '.cp-exported button:has-text("Use the polished text")' );
			await saved( p );
			ok( /Polished/.test( await p.textContent( '.cp-preview' ) ), 'switching back exports the polished text' );
			// Re-polish: the warning goes away.
			await post( 'polish', '## Why\n\nPolished one.\n\n## How\n\nPolished two, corrected.', 1 );
			await openArticle( p, a.id, 'Copy to WordPress' );
			ok( ! /changed after polishing/i.test( await p.textContent( '.cp-step__body' ) ), 'no warning once the polished text is newer' );
		}
	} catch ( e ) {
		fail++;
		console.log( 'FAIL  test crashed: ' + e.message );
	} finally {
		rejectOff();
		await browser.close();
	}
	console.log( '\nResult: ' + pass + ' passed, ' + fail + ' failed' );
	process.exit( fail ? 1 : 0 );
} )();
