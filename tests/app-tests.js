/* eslint-disable no-console */
// Browser tests for the notes app (Playwright + Chromium).
// DISPOSABLE TEST SITES ONLY. Run through tests/app-tests.sh, which resets the notes first.
//
// Env: BASE (default http://localhost:8080), PW (path to the playwright package),
//      OLLAMA_PORT (fake Ollama port, default 11435), SHOTS (folder for screenshots).
const PW = process.env.PW || 'playwright';
const { chromium, devices } = require( PW );
const { execSync } = require( 'child_process' );
const fs = require( 'fs' );
const path = require( 'path' );

const BASE = process.env.BASE || 'http://localhost:8080';
const SHOTS = process.env.SHOTS || '';
const TINY_PNG = Buffer.from( 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64' );

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

async function shot( page, name ) {
	if ( SHOTS ) {
		await page.screenshot( { path: path.join( SHOTS, name + '.png' ) } );
	}
}

async function login( page, user, pass_ ) {
	await page.goto( BASE + '/wp-login.php' );
	await page.fill( '#user_login', user );
	await page.fill( '#user_pass', pass_ );
	await Promise.all( [ page.waitForNavigation(), page.click( '#wp-submit' ) ] );
}

async function saved( page, timeout ) {
	await page.waitForFunction( () => window.cpHub && 0 === window.cpHub.state.pending.size && ! window.cpHub.state.sync.flushing, null, { timeout: timeout || 8000 } );
}

async function serverState( page ) {
	return page.evaluate( async () => {
		const r = await fetch( window.CP_APP.rest + 'state', { headers: { 'X-WP-Nonce': window.cpHub.state.sync.nonce }, cache: 'no-store' } );
		return r.json();
	} );
}

async function apiCall( page, method, p, body ) {
	return page.evaluate( async ( [ m, pth, b ] ) => {
		const r = await fetch( window.CP_APP.rest + pth, { method: m, headers: { 'X-WP-Nonce': window.cpHub.state.sync.nonce, 'Content-Type': 'application/json' }, body: b ? JSON.stringify( b ) : undefined } );
		return { status: r.status, data: await r.json() };
	}, [ method, p, body ] );
}

function findNote( state, title ) {
	return state.notes.find( ( n ) => n.title === title );
}

function folderId( state, name ) {
	const f = state.folders.find( ( x ) => x.name === name );
	return f ? f.id : 0;
}

async function newNote( page, title, body ) {
	await page.click( '.cp-capture__input' );
	await page.fill( '.cp-editor__title', title );
	if ( body ) {
		await page.fill( '.cp-editor__body', body );
	}
	await saved( page );
	await page.click( '[aria-label="Close note"]' );
	await page.waitForSelector( 'dialog.cp-editor', { state: 'detached' } );
}

async function openTreeFolder( page, name ) {
	await page.click( '.cp-node__open:has(.cp-node__name:text-is("' + name + '"))' );
}

async function dialogInput( page, value, button ) {
	await page.fill( 'dialog[open] input.cp-input', value );
	await page.click( 'dialog[open] button:text-is("' + button + '")' );
}

( async () => {
	const browser = await chromium.launch();

	/* ---------------- desktop ---------------- */
	const ctx = await browser.newContext( { viewport: { width: 1280, height: 860 } } );
	const page = await ctx.newPage();
	const errors = [];
	page.on( 'console', ( m ) => {
		// "Failed to load resource" = refusals the tests trigger on purpose (409 duplicate folder, 400 bad file).
		if ( 'error' === m.type() && ! /Failed to load resource/.test( m.text() ) ) {
			errors.push( m.text() );
		}
	} );
	page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + e.message ) );
	let dialogs = 0;
	page.on( 'dialog', async ( d ) => {
		dialogs++;
		await d.dismiss();
	} );

	console.log( '== Start' );
	await login( page, 'admin', 'admin' );
	ok( page.url() === BASE + '/notes/', 'login lands on /notes/', page.url() );
	await page.waitForSelector( '.cp-shell' );
	ok( await page.isVisible( '.cp-node__open:has-text("Inbox")' ), 'Inbox folder shown' );
	for ( const site of [ 'Madhu Infotech', 'happylife247', 'Personal brand', 'B2B tech' ] ) {
		ok( await page.isVisible( '.cp-node:has(.cp-node__name:text-is("' + site + '")) .cp-site-dot' ), 'site folder "' + site + '" shown with website dot' );
	}
	ok( 'saved' === await page.getAttribute( '#cp-sync', 'data-state' ), 'sync shows saved at start' );

	console.log( '== Notes' );
	await newNote( page, 'Interview tips', 'Research the company\nPractise answers' );
	let st = await serverState( page );
	let n1 = findNote( st, 'Interview tips' );
	ok( n1 && 'Research the company\nPractise answers' === n1.body && n1.folder === st.inbox, 'note saved to server in Inbox' );
	ok( await page.isVisible( '.cp-card:has-text("Interview tips")' ), 'card shown' );

	await page.click( '.cp-capture__input' );
	await page.click( 'dialog[open] [aria-label="Close note"]' );
	await page.waitForTimeout( 400 );
	st = await serverState( page );
	ok( 1 === st.notes.length, 'empty new note is not saved', st.notes.length + ' notes' );

	const xss = '<img src=x onerror="window.__xss=1">"\'&%20\\';
	await newNote( page, xss, '<script>window.__xss=2</script>' );
	await page.waitForTimeout( 300 );
	ok( ! ( await page.evaluate( () => window.__xss ) ), 'HTML in notes is shown as text, never run' );
	st = await serverState( page );
	ok( !! findNote( st, xss ), 'special characters stored exactly as typed' );
	ok( await page.evaluate( ( t ) => Array.from( document.querySelectorAll( '.cp-card__title' ) ).some( ( e ) => e.textContent === t ), xss ), 'special characters shown exactly' );

	await page.reload();
	await page.waitForSelector( '.cp-card:has-text("Interview tips")' );
	ok( true, 'notes still there after reload' );

	console.log( '== Edit, autosave' );
	await page.click( '.cp-card:has-text("Interview tips")' );
	await page.fill( '.cp-editor__body', 'Research the company\nPractise answers\nDress well' );
	ok( await page.waitForSelector( 'dialog[open] .cp-editor__info:has-text("Saved")', { timeout: 8000 } ).then( () => true, () => false ), 'editor shows Saved after typing' );
	await saved( page );
	st = await serverState( page );
	n1 = findNote( st, 'Interview tips' );
	ok( n1.body.endsWith( 'Dress well' ) && n1.version >= 2, 'autosave sent the text, version went up', 'v' + n1.version );

	console.log( '== Checklist' );
	await page.click( 'dialog[open] [aria-label="Add checklist"]' );
	await page.keyboard.type( 'Print resume' );
	await page.keyboard.press( 'Enter' );
	await page.keyboard.type( 'Book cab' );
	await saved( page );
	await page.locator( 'dialog[open] .cp-list__item' ).first().locator( 'input[type="checkbox"]' ).click();
	await saved( page );
	st = await serverState( page );
	n1 = findNote( st, 'Interview tips' );
	ok( 2 === n1.checklist.length && n1.checklist[ 0 ].t === 'Print resume' && n1.checklist[ 0 ].d && ! n1.checklist[ 1 ].d, 'checklist items, Enter adds item, tick saved', JSON.stringify( n1.checklist ) );
	ok( await page.isVisible( 'dialog[open] .cp-list__done-label:has-text("1 ticked item")' ), 'ticked items listed under "1 ticked item"' );

	console.log( '== Pin and status' );
	await page.click( 'dialog[open] [aria-label="Pin"]' );
	await page.selectOption( 'dialog[open] .cp-editor__status', 'outline_ready' );
	await saved( page );
	await page.click( '[aria-label="Close note"]' );
	ok( await page.isVisible( '.cp-section-label:text-is("Pinned")' ), 'Pinned section shown' );
	ok( await page.isVisible( '.cp-card:has-text("Interview tips") .cp-badge--status-outline_ready' ), 'status badge on card' );
	await page.click( '.cp-chip:text-is("Outline ready")' );
	ok( 1 === ( await page.$$( '.cp-card' ) ).length, 'status filter shows only matching notes' );
	await page.click( '.cp-chip:text-is("Outline ready")' );
	st = await serverState( page );
	n1 = findNote( st, 'Interview tips' );
	ok( n1.pinned && 'outline_ready' === n1.status, 'pin and status saved on server' );

	console.log( '== Folders' );
	await openTreeFolder( page, 'Madhu Infotech' );
	await page.click( '.cp-tile--add' );
	await dialogInput( page, 'Interview prep', 'Create' );
	await page.waitForSelector( '.cp-tile:has-text("Interview prep")' );
	ok( true, 'new folder inside Madhu Infotech (tile button)' );
	await page.click( '.cp-tile:has-text("Interview prep")' );
	ok( await page.isVisible( '.cp-crumbs button:text-is("Madhu Infotech")' ) && await page.isVisible( '.cp-crumbs button:text-is("Interview prep")' ), 'breadcrumb shows Madhu Infotech › Interview prep' );
	ok( await page.isVisible( '.cp-crumbs .cp-badge--site:text-is("Madhu Infotech")' ), 'site badge shown for folder inside a website folder' );
	await page.click( '.cp-tile--add' );
	await dialogInput( page, 'Freshers', 'Create' );
	await page.waitForSelector( '.cp-tile:has-text("Freshers")' );
	await page.click( '.cp-tile--add' );
	await dialogInput( page, 'freshers', 'Create' );
	ok( await page.waitForSelector( '.cp-toast:has-text("already here")', { timeout: 4000 } ).then( () => true, () => false ), 'duplicate folder name refused with a message' );
	await page.keyboard.press( 'Escape' );

	console.log( '== Move note (menu)' );
	await page.click( '.cp-node__open:has-text("Inbox")' );
	await page.click( '.cp-card:has-text("Interview tips")' );
	await page.click( 'dialog[open] [aria-label="More"]' );
	await page.click( '.cp-menu button:has-text("Move to…")' );
	await page.click( 'dialog.cp-dialog--small[open] .cp-picker button:text-is("Interview prep")' );
	await saved( page );
	ok( await page.isVisible( 'dialog.cp-editor[open] .cp-editor__foot:has-text("Madhu Infotech › Interview prep")' ), 'editor shows new folder path' );
	ok( await page.isVisible( 'dialog.cp-editor[open] .cp-editor__info:has-text("Madhu Infotech ·")' ), 'editor shows the website of the note (folder inside a website folder)' );
	await page.click( '[aria-label="Close note"]' );
	st = await serverState( page );
	ok( findNote( st, 'Interview tips' ).folder === folderId( st, 'Interview prep' ), 'move saved on server' );
	ok( ! ( await page.isVisible( '.cp-card:has-text("Interview tips")' ) ), 'moved note left the Inbox view' );

	console.log( '== Drag and drop' );
	await newNote( page, 'Drag me', 'into happylife247' );
	await page.dragAndDrop( '.cp-card:has-text("Drag me")', '.cp-node:has(.cp-node__name:text-is("happylife247"))' );
	await saved( page );
	st = await serverState( page );
	ok( findNote( st, 'Drag me' ).folder === folderId( st, 'happylife247' ), 'drag a card onto a folder moves the note' );
	if ( 'false' === await page.getAttribute( '.cp-node:has(.cp-node__name:text-is("Madhu Infotech")) .cp-node__toggle', 'aria-expanded' ) ) {
		await page.click( '.cp-node:has(.cp-node__name:text-is("Madhu Infotech")) .cp-node__toggle' );
	}
	await page.waitForSelector( '.cp-node__name:text-is("Interview prep")' );
	await page.dragAndDrop( '.cp-node:has(.cp-node__name:text-is("Interview prep"))', '.cp-node:has(.cp-node__name:text-is("Personal brand"))' );
	await page.waitForTimeout( 800 );
	st = await serverState( page );
	ok( st.folders.find( ( f ) => 'Interview prep' === f.name ).parent === folderId( st, 'Personal brand' ), 'drag a folder onto a folder moves the folder (with its notes)' );
	await page.dragAndDrop( '.cp-node:has(.cp-node__name:text-is("Personal brand"))', '.cp-node:has(.cp-node__name:text-is("Freshers"))' ).catch( () => {} );
	await page.waitForTimeout( 500 );
	st = await serverState( page );
	ok( 0 === st.folders.find( ( f ) => 'Personal brand' === f.name ).parent, 'a folder cannot be dropped inside its own subfolder' );
	const loop = await apiCall( page, 'POST', 'folders/' + folderId( st, 'Personal brand' ), { parent: folderId( st, 'Freshers' ) } );
	ok( 400 === loop.status, 'server also refuses moving a folder inside itself' );

	console.log( '== Search' );
	await page.fill( '.cp-search input', 'dress' );
	await page.waitForSelector( '.cp-crumbs:has-text("1 result")' );
	ok( await page.isVisible( '.cp-card:has-text("Interview tips") .cp-path:has-text("Personal brand › Interview prep")' ), 'search finds text in a subfolder and shows its folder path' );
	await page.fill( '.cp-search input', 'book cab' );
	await page.waitForSelector( '.cp-crumbs:has-text("1 result")' );
	ok( true, 'search finds checklist text (all words)' );
	await page.fill( '.cp-search input', 'fresh' );
	await page.waitForSelector( '.cp-section-label:text-is("Folders")' );
	ok( await page.isVisible( '.cp-tile:has-text("Freshers")' ), 'search lists matching folders' );
	await page.fill( '.cp-search input', '' );
	await page.waitForTimeout( 300 );
	await openTreeFolder( page, 'happylife247' );
	await page.fill( '.cp-search input', 'interview' );
	await page.waitForSelector( '.cp-scope' );
	await page.click( '.cp-scope .cp-chip:has-text("and its subfolders")' );
	ok( await page.isVisible( '.cp-crumbs:has-text("0 results")' ), 'search can be limited to the current folder' );
	await page.click( '.cp-scope .cp-chip:text-is("All folders")' );
	ok( await page.isVisible( '.cp-crumbs:has-text("1 result")' ), 'search in all folders again' );
	await page.click( '.cp-search__clear' );

	console.log( '== Offline' );
	await openTreeFolder( page, 'Inbox' );
	await newNote( page, 'Offline test', 'online text' );
	await ctx.setOffline( true );
	await page.evaluate( () => window.dispatchEvent( new Event( 'offline' ) ) );
	await page.click( '.cp-card:has-text("Offline test")' );
	await page.fill( '.cp-editor__body', 'typed while offline' );
	await page.waitForTimeout( 1500 );
	ok( 'offline' === await page.getAttribute( '#cp-sync', 'data-state' ), 'indicator shows Offline' );
	const stored = await page.evaluate( () => Object.keys( window.localStorage ).filter( ( k ) => k.startsWith( window.CP_APP.storageKey ) ).map( ( k ) => window.localStorage.getItem( k ) ).join( '' ) );
	ok( stored && stored.includes( 'typed while offline' ), 'offline text kept in this browser' );
	await page.click( '[aria-label="Close note"]' );
	await page.click( '.cp-capture__input' );
	await page.fill( '.cp-editor__title', 'Created offline' );
	await page.waitForTimeout( 900 );
	await page.click( '[aria-label="Close note"]' );
	ok( await page.isVisible( '.cp-card:has-text("Created offline") .cp-pending' ), 'card marks "not saved yet"' );
	await page.close();
	await ctx.setOffline( false );
	const page2 = await ctx.newPage();
	page2.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + e.message ) );
	await page2.goto( BASE + '/notes/' );
	await saved( page2, 15000 );
	st = await serverState( page2 );
	ok( 'typed while offline' === findNote( st, 'Offline test' ).body, 'offline edit saved after the tab was closed and reopened online' );
	ok( !! findNote( st, 'Created offline' ), 'note created offline saved after reopening' );
	ok( 1 === st.notes.filter( ( n ) => 'Created offline' === n.title ).length, 'no duplicate notes' );

	console.log( '== Two devices editing the same note' );
	let p = page2;
	await p.click( '.cp-card:has-text("Offline test")' );
	st = await serverState( p );
	const ot = findNote( st, 'Offline test' );
	const other = await apiCall( p, 'POST', 'notes/' + ot.id, { base_version: ot.version, body: 'changed on the phone' } );
	ok( 200 === other.status, 'other device saved first' );
	await p.fill( '.cp-editor__body', 'changed on the computer' );
	await p.waitForSelector( '.cp-toast:has-text("changed on another device")', { timeout: 8000 } );
	ok( true, 'conflict reported to the user' );
	await saved( p );
	st = await serverState( p );
	ok( 'changed on the phone' === findNote( st, 'Offline test' ).body, 'other device\'s text was not overwritten' );
	const copy = st.notes.find( ( n ) => n.title.startsWith( 'Offline test (conflict copy)' ) );
	ok( copy && 'changed on the computer' === copy.body, 'this device\'s text saved as a conflict copy' );
	ok( await p.inputValue( 'dialog[open] .cp-editor__title' ) === copy.title, 'editor switched to the copy' );
	await p.click( '[aria-label="Close note"]' );

	console.log( '== Expired nonce and logged out' );
	await p.evaluate( () => {
		window.cpHub.state.sync.nonce = 'badnonce12';
	} );
	await p.click( '.cp-card:has-text("Created offline")' );
	await p.fill( '.cp-editor__body', 'after nonce expiry' );
	await saved( p );
	st = await serverState( p );
	ok( 'after nonce expiry' === findNote( st, 'Created offline' ).body, 'expired security token is renewed automatically' );
	await p.click( '[aria-label="Close note"]' );
	const cookies = await ctx.cookies();
	await ctx.clearCookies();
	await p.click( '.cp-card:has-text("Created offline")' );
	await p.fill( '.cp-editor__body', 'typed while logged out' );
	await p.waitForFunction( () => 'login' === document.getElementById( 'cp-sync' ).dataset.state, null, { timeout: 8000 } );
	ok( true, 'logged out: indicator says so' );
	await p.click( '[aria-label="Close note"]' );
	ok( await p.waitForSelector( '#cp-login-banner:not([hidden]) a:text-is("Log in")', { timeout: 8000 } ).then( () => true, () => false ), 'logged out: banner with Log in button' );
	await ctx.addCookies( cookies );
	await p.reload();
	await saved( p, 15000 );
	st = await serverState( p );
	ok( 'typed while logged out' === findNote( st, 'Created offline' ).body, 'text typed while logged out saved after logging in again' );

	console.log( '== History' );
	await openTreeFolder( p, 'happylife247' );
	await p.click( '.cp-card:has-text("Drag me")' );
	await p.fill( '.cp-editor__body', 'version B' );
	await saved( p );
	await p.click( 'dialog[open] [aria-label="More"]' );
	await p.click( '.cp-menu button:has-text("History")' );
	await p.waitForSelector( '.cp-history .cp-row' );
	const versions = await p.$$( '.cp-history .cp-row' );
	ok( versions.length >= 1, 'history lists earlier versions', versions.length + '' );
	await p.click( '.cp-history .cp-row:has-text("into happylife247") button:has-text("Restore")' );
	await p.waitForSelector( '.cp-toast:has-text("Earlier version restored")' );
	ok( 'into happylife247' === await p.inputValue( 'dialog[open] .cp-editor__body' ), 'restore brings back the earlier text' );
	st = await serverState( p );
	const dm = findNote( st, 'Drag me' );
	const hist = await apiCall( p, 'GET', 'notes/' + dm.id + '/history' );
	ok( hist.data.versions.some( ( v ) => 'version B' === v.body ), 'the text before restoring is kept in history' );

	console.log( '== Images' );
	fs.writeFileSync( '/tmp/cp-test.png', TINY_PNG );
	fs.writeFileSync( '/tmp/cp-test.txt', 'not an image' );
	await p.setInputFiles( 'dialog[open] input[type="file"]', '/tmp/cp-test.png' );
	await p.waitForSelector( 'dialog[open] .cp-image:not(.cp-image--uploading) img' );
	const src = await p.getAttribute( 'dialog[open] .cp-image img', 'src' );
	ok( /\?cp_file=[a-f0-9]{32}$/.test( src ), 'image added, served through the login gate', src );
	const imgRes = await p.evaluate( async ( u ) => {
		const r = await fetch( u );
		return { status: r.status, type: r.headers.get( 'content-type' ), cc: r.headers.get( 'cache-control' ) };
	}, src );
	ok( 200 === imgRes.status && 'image/png' === imgRes.type && /private/.test( imgRes.cc ), 'image loads for the logged-in user (private cache)' );
	fs.writeFileSync( '/tmp/cp-image-url.txt', src );
	await p.setInputFiles( 'dialog[open] input[type="file"]', '/tmp/cp-test.txt' );
	ok( await p.waitForSelector( '.cp-toast:has-text("Only JPG, PNG, GIF and WebP")', { timeout: 5000 } ).then( () => true, () => false ), 'non-image file refused' );
	await p.click( '[aria-label="Close note"]' );
	ok( await p.isVisible( '.cp-card:has-text("Drag me") .cp-card__images img' ), 'card shows the image' );

	console.log( '== Trash' );
	await openTreeFolder( p, 'Inbox' );
	await p.click( '.cp-card:has-text("Created offline")' );
	await p.click( 'dialog[open] [aria-label="More"]' );
	await p.click( '.cp-menu button:has-text("Move to trash")' );
	await p.waitForSelector( '.cp-toast:has-text("moved to the trash")' );
	await p.click( '.cp-toast button:text-is("Undo")' );
	await p.waitForSelector( '.cp-card:has-text("Created offline")' );
	ok( true, 'Undo brings a trashed note back' );
	await p.click( '.cp-card:has-text("Created offline")' );
	await p.click( 'dialog[open] [aria-label="More"]' );
	await p.click( '.cp-menu button:has-text("Move to trash")' );
	await p.click( '.cp-node__open:has-text("Trash")' );
	await p.waitForSelector( '.cp-row:has-text("Created offline")' );
	ok( await p.isVisible( '.cp-row:has-text("Created offline") .cp-row__sub:has-text("From Inbox")' ), 'trash shows where the note came from' );
	await p.click( '.cp-row:has-text("Created offline") button:has-text("Restore")' );
	await p.waitForSelector( '.cp-toast:has-text("restored to Inbox")' );
	ok( true, 'restore from trash' );

	console.log( '== Delete folder' );
	await openTreeFolder( page2, 'happylife247' );
	await p.click( '.cp-crumbs [aria-label="Folder options"]' );
	await p.click( '.cp-menu button:has-text("Delete folder")' );
	ok( await p.isVisible( 'dialog[open]:has-text("1 note will go to the trash")' ), 'delete asks first and says how many notes go to the trash' );
	await p.click( 'dialog[open] button:text-is("Delete folder")' );
	await p.waitForSelector( '.cp-toast:has-text("Folder deleted")' );
	st = await serverState( p );
	ok( ! folderId( st, 'happylife247' ) && ! findNote( st, 'Drag me' ), 'folder deleted, its note in the trash' );
	await p.click( '.cp-node__open:has-text("Trash")' );
	await p.waitForSelector( '.cp-row:has-text("Drag me")' );
	ok( await p.isVisible( '.cp-row:has-text("Drag me") .cp-row__sub:has-text("restores to the Inbox")' ), 'trash says the folder is gone (restores to Inbox)' );
	await p.click( '.cp-row:has-text("Drag me") button:has-text("Restore")' );
	await p.waitForSelector( '.cp-toast:has-text("restored to Inbox")' );
	st = await serverState( p );
	ok( findNote( st, 'Drag me' ).folder === st.inbox, 'note from a deleted folder restored into the Inbox' );
	await p.click( '.cp-node:has(.cp-node__name:text-is("Inbox")) .cp-node__more' );
	ok( ! ( await p.isVisible( '.cp-menu button:has-text("Delete folder")' ) ), 'Inbox cannot be deleted (no menu item)' );
	await p.keyboard.press( 'Escape' );

	console.log( '== Delete forever, empty trash' );
	await p.click( '.cp-node__open:has-text("Inbox")' );
	await p.click( '.cp-card:has-text("Drag me")' );
	await p.click( 'dialog[open] [aria-label="More"]' );
	await p.click( '.cp-menu button:has-text("Move to trash")' );
	await p.click( '.cp-node__open:has-text("Trash")' );
	await p.click( '.cp-row:has-text("Drag me") button:has-text("Delete forever")' );
	await p.click( 'dialog[open] button:text-is("Delete forever")' );
	await p.waitForSelector( '.cp-toast:has-text("deleted for good")' );
	const gone = await p.evaluate( async ( u ) => ( await fetch( u, { cache: 'no-store' } ) ).status, src );
	ok( 404 === gone, 'deleting a note for good also deletes its image file' );

	await shot( p, 'desktop-final' );
	ok( 0 === errors.length, 'no JavaScript errors on desktop', errors.join( ' | ' ) );
	ok( 0 === dialogs, 'no unexpected browser alert/confirm popups' );
	await ctx.close();

	/* ---------------- logged out / other users ---------------- */
	console.log( '== Visitors' );
	const anon = await browser.newContext();
	const ap = await anon.newPage();
	const imgUrl = fs.readFileSync( '/tmp/cp-image-url.txt', 'utf8' );
	const r1 = await ap.request.get( imgUrl, { maxRedirects: 0 } );
	ok( 302 === r1.status() && /wp-login\.php/.test( r1.headers().location || '' ), 'logged out: image link goes to the login screen' );
	const r2 = await ap.request.get( BASE + '/?cp_manifest=1', { maxRedirects: 0 } );
	ok( 302 === r2.status(), 'logged out: manifest goes to the login screen' );
	const r3 = await ap.request.get( BASE + '/wp-json/cp/v1/state', { maxRedirects: 0 } );
	ok( 401 === r3.status(), 'logged out: notes API answers 401' );
	await anon.close();

	/* ---------------- phone ---------------- */
	console.log( '== Phone (Android size)' );
	const phone = await browser.newContext( Object.assign( {}, devices[ 'Pixel 7' ] ) );
	const pp = await phone.newPage();
	const perr = [];
	pp.on( 'pageerror', ( e ) => perr.push( e.message ) );
	await login( pp, 'admin', 'admin' );
	await pp.waitForSelector( '.cp-shell' );
	ok( await pp.isVisible( '.cp-fab' ) && ! ( await pp.isVisible( '.cp-capture' ) ), 'phone: round + button instead of the capture box' );
	ok( ! ( await pp.isVisible( '.cp-side' ) ) || ( await pp.evaluate( () => document.querySelector( '.cp-side' ).getBoundingClientRect().right <= 0 ) ), 'phone: folders hidden in a drawer' );
	await pp.click( '.cp-top__menu' );
	await pp.waitForTimeout( 300 );
	ok( await pp.evaluate( () => document.querySelector( '.cp-side' ).getBoundingClientRect().left >= 0 ), 'phone: menu button opens the folder drawer' );
	await shot( pp, 'phone-drawer' );
	await pp.click( '.cp-node__open:has(.cp-node__name:text-is("Madhu Infotech"))' );
	await pp.waitForTimeout( 300 );
	ok( await pp.evaluate( () => document.querySelector( '.cp-side' ).getBoundingClientRect().right <= 0 ), 'phone: drawer closes after choosing a folder' );
	await pp.click( '.cp-fab' );
	await pp.fill( '.cp-editor__title', 'Phone note' );
	await pp.fill( '.cp-editor__body', 'written on the phone' );
	await saved( pp );
	const box = await pp.evaluate( () => {
		const r = document.querySelector( 'dialog.cp-editor' ).getBoundingClientRect();
		return { w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
	} );
	ok( Math.abs( box.w - box.vw ) < 2 && Math.abs( box.h - box.vh ) < 2, 'phone: editor is full screen', JSON.stringify( box ) );
	await shot( pp, 'phone-editor' );
	await pp.goBack();
	await pp.waitForSelector( 'dialog.cp-editor', { state: 'detached', timeout: 4000 } ).then( () => ok( true, 'phone: Back button closes the note (stays in the app)' ), () => ok( false, 'phone: Back button closes the note' ) );
	ok( pp.url().includes( '/notes/' ), 'phone: still on the notes page after Back' );
	st = await serverState( pp );
	ok( findNote( st, 'Phone note' ) && findNote( st, 'Phone note' ).folder === folderId( st, 'Madhu Infotech' ), 'phone: new note saved in the open folder' );
	const noScroll = await pp.evaluate( () => document.documentElement.scrollWidth <= window.innerWidth );
	ok( noScroll, 'phone: no sideways scrolling' );
	const man = await pp.evaluate( async () => {
		const link = document.querySelector( 'link[rel="manifest"]' );
		const r = await fetch( link.href, { credentials: 'include' } );
		return { cross: link.getAttribute( 'crossorigin' ), status: r.status, json: await r.json() };
	} );
	ok( 'use-credentials' === man.cross && 200 === man.status && 'standalone' === man.json.display && man.json.start_url.endsWith( '/notes/' ), 'phone: home-screen manifest (standalone, starts at /notes/)' );
	const iconsOk = await pp.evaluate( async ( icons ) => ( await Promise.all( icons.map( ( i ) => fetch( i.src ).then( ( r ) => r.status ) ) ) ).every( ( s ) => 200 === s ), man.json.icons );
	ok( iconsOk && man.json.icons.some( ( i ) => '512x512' === i.sizes ) && man.json.icons.some( ( i ) => 'maskable' === i.purpose ), 'phone: app icons load (192, 512, maskable)' );
	await pp.click( '.cp-card:has-text("Phone note")' );
	await pp.click( 'dialog[open] [aria-label="More"]' );
	await shot( pp, 'phone-menu' );
	await pp.keyboard.press( 'Escape' );
	ok( 0 === perr.length, 'no JavaScript errors on the phone', perr.join( ' | ' ) );
	await phone.close();

	/* ---------------- dark mode ---------------- */
	const dark = await browser.newContext( { viewport: { width: 1280, height: 860 }, colorScheme: 'dark' } );
	const dp = await dark.newPage();
	await login( dp, 'admin', 'admin' );
	await dp.waitForSelector( '.cp-shell' );
	const bg = await dp.evaluate( () => getComputedStyle( document.body ).backgroundColor );
	ok( 'rgb(14, 16, 19)' === bg, 'dark mode follows the device setting', bg );
	await shot( dp, 'desktop-dark' );
	await dark.close();

	/* ---------------- Ollama test page ---------------- */
	if ( process.env.OLLAMA_PORT ) {
		console.log( '== Ollama test page (fake Ollama)' );
		const oc = await browser.newContext( { viewport: { width: 1280, height: 900 } } );
		const op = await oc.newPage();
		await login( op, 'admin', 'admin' );
		await op.goto( BASE + '/wp-admin/admin.php?page=content-pipeline-ollama' );
		ok( await op.isVisible( '#cp-ollama-origin:text-is("' + BASE + '")' ), 'Ollama page shows the exact OLLAMA_ORIGINS value' );
		await op.fill( '#cp-ollama-url', 'http://localhost:' + process.env.OLLAMA_PORT );
		await op.click( '#cp-ollama-check' );
		await op.waitForSelector( '#cp-ollama-result .notice-success' );
		ok( await op.isVisible( '#cp-ollama-result:has-text("fake-model:1b")' ), 'Ollama connected, models listed' );
		await op.click( '#cp-ollama-run' );
		await op.waitForSelector( '#cp-ollama-output .notice-success' );
		ok( await op.isVisible( '#cp-ollama-output:has-text("Fake answer for")' ) && await op.isVisible( '#cp-ollama-output:has-text("20.0")' ), 'test prompt answered, speed shown' );
		await shot( op, 'ollama-ok' );
		await op.fill( '#cp-ollama-url', 'http://localhost:' + process.env.OLLAMA_BLOCKED_PORT );
		await op.click( '#cp-ollama-check' );
		await op.waitForSelector( '#cp-ollama-result .notice-error' );
		ok( await op.isVisible( '#cp-ollama-result:has-text("OLLAMA_ORIGINS")' ), 'blocked origin: clear explanation mentioning OLLAMA_ORIGINS' );
		await op.fill( '#cp-ollama-url', 'http://localhost:1' );
		await op.click( '#cp-ollama-check' );
		await op.waitForSelector( '#cp-ollama-result .notice-error' );
		ok( await op.isVisible( '#cp-ollama-result:has-text("could not reach Ollama")' ), 'Ollama not running: clear explanation' );
		await oc.close();
	}

	/* ---------------- Images switched off ---------------- */
	console.log( '== Images switched off (no private folder)' );
	{
		const priv = path.join( path.dirname( execSync( 'wp eval "echo untrailingslashit( ABSPATH );"' ).toString().trim() ), 'private_html' );
		fs.renameSync( priv, priv + '-off' );
		try {
			const ic = await browser.newContext( { viewport: { width: 1280, height: 860 } } );
			const ip = await ic.newPage();
			await login( ip, 'admin', 'admin' );
			await ip.waitForSelector( '.cp-shell' );
			await ip.click( '.cp-capture__input' );
			await ip.fill( '.cp-editor__title', 'No images here' );
			await ip.click( 'dialog[open] [aria-label="Add image"]' );
			ok( await ip.waitForSelector( '.cp-toast:has-text("Images are switched off")', { timeout: 4000 } ).then( () => true, () => false ), 'images off: the image button explains why' );
			await ic.close();
		} finally {
			fs.renameSync( priv + '-off', priv );
		}
	}

	/* ---------------- Private site OFF ---------------- */
	console.log( '== Private site OFF (notes from the dashboard)' );
	{
		const { execSync: ex } = require( 'child_process' );
		ex( 'wp option update content_pipeline_private 0', { stdio: 'ignore' } );
		try {
			const oc = await browser.newContext( { viewport: { width: 1280, height: 860 } } );
			const o = await oc.newPage();
			const oerr = [];
			o.on( 'pageerror', ( e ) => oerr.push( e.message ) );
			await login( o, 'admin', 'admin' );
			ok( o.url().includes( '/wp-admin/' ), 'off: login goes to the Dashboard', o.url() );
			await o.goto( BASE + '/' );
			ok( o.url() === BASE + '/', 'off: home page stays the normal website', o.url() );
			await o.click( '#wp-admin-bar-content-pipeline-notes a' );
			await o.waitForSelector( '.cp-shell' );
			ok( o.url() === BASE + '/notes/', 'off: "Notes" link in the admin bar opens the app' );
			await newNote( o, 'Made while the site is public', 'still private' );
			st = await serverState( o );
			ok( !! findNote( st, 'Made while the site is public' ), 'off: notes save normally' );
			ok( 0 === oerr.length, 'off: no JavaScript errors', oerr.join( ' | ' ) );
			await oc.close();
		} finally {
			ex( 'wp option update content_pipeline_private 1', { stdio: 'ignore' } );
		}
	}

	/* ---------------- "Plain" permalinks ---------------- */
	console.log( '== Plain permalinks (?rest_route=)' );
	const permalinks = ( v ) => execSync( 'wp eval \'update_option( "permalink_structure", "' + v + '" ); flush_rewrite_rules( false );\'', { stdio: 'ignore' } );
	permalinks( '' );
	try {
		const pc = await browser.newContext( { viewport: { width: 1280, height: 860 } } );
		const pl = await pc.newPage();
		await login( pl, 'admin', 'admin' );
		ok( pl.url() === BASE + '/?cp_app=1', 'plain permalinks: login lands on /?cp_app=1', pl.url() );
		await pl.waitForSelector( '.cp-shell' );
		await newNote( pl, 'Plain permalink note', 'saved via ?rest_route=' );
		st = await serverState( pl );
		ok( !! findNote( st, 'Plain permalink note' ), 'plain permalinks: notes save' );
		await pc.close();
	} finally {
		permalinks( '/%postname%/' );
	}

	await browser.close();
	console.log( '' );
	console.log( 'Result: ' + pass + ' passed, ' + fail + ' failed' );
	process.exit( fail ? 1 : 0 );
} )().catch( ( e ) => {
	console.log( 'FAIL  test crashed: ' + e.message );
	console.log( e.stack );
	console.log( 'Result: ' + pass + ' passed, ' + ( fail + 1 ) + ' failed' );
	process.exit( 1 );
} );
