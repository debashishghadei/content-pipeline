/* eslint-disable no-console */
// Browser tests for the article workspace (0.4): note → Write article → 6 steps → Copy to
// WordPress, plus saving safety, settings, list, trash and phone layout.
// DISPOSABLE TEST SITES ONLY (run through tests/app-tests.sh). Env: BASE, PW, SHOTS.
const path = require( 'path' );
const fs = require( 'fs' );
const { chromium, devices } = require( process.env.PW || 'playwright' );
const BASE = process.env.BASE || 'http://localhost:8080';
const SHOTS = process.env.SHOTS || '';

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
		await page.screenshot( { path: path.join( SHOTS, name + '.png' ), fullPage: false } );
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
async function saved( page, timeout ) {
	await page.waitForFunction( () => window.cpHub && 0 === window.cpHub.state.pending.size && ! window.cpHub.state.sync.flushing, null, { timeout: timeout || 10000 } );
}
async function clip( page, text ) {
	await page.evaluate( ( t ) => navigator.clipboard.writeText( t ), text );
}
async function clipboard( page ) {
	return page.evaluate( () => navigator.clipboard.readText() );
}
async function step( page, label ) {
	await page.click( '.cp-steps__btn:has(.cp-steps__label:text-is("' + label + '"))' );
	await page.waitForSelector( '.cp-step__title:has-text("' + label + '")' );
}
async function paste( page, scope, text ) {
	await clip( page, text );
	await page.click( ( scope ? scope + ' ' : '.cp-step__body > .cp-actions ' ) + 'button:has-text("Paste answer")' );
	await page.waitForTimeout( 200 );
}
async function promptText( page, scope ) {
	await page.click( ( scope ? scope + ' ' : '.cp-step__body > .cp-actions ' ) + 'button:has-text("Copy prompt")' );
	await page.waitForSelector( '.cp-prompt-text' );
	const t = await page.inputValue( '.cp-prompt-text' );
	await page.click( 'dialog[open] .cp-copy-prompt' );
	const c = await clipboard( page );
	await page.keyboard.press( 'Escape' );
	return { t, copied: c === t };
}
async function art( page, id ) {
	return ( await api( page, 'GET', 'articles/' + id ) ).data.article;
}

( async () => {
	const browser = await chromium.launch();
	const ctx = await browser.newContext( { viewport: { width: 1280, height: 900 }, permissions: [ 'clipboard-read', 'clipboard-write' ] } );
	const p = await ctx.newPage();
	const errors = [];
	p.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + e.message ) );
	p.on( 'console', ( m ) => {
		if ( 'error' === m.type() && ! /Failed to load resource|ERR_INTERNET_DISCONNECTED/.test( m.text() ) ) {
			errors.push( m.text() );
		}
	} );
	await login( p );

	// Writing settings for Madhu Infotech (as the user would set them).
	let st = ( await api( p, 'GET', 'state' ) ).data;
	const madhu = st.folders.find( ( f ) => 'Madhu Infotech' === f.name ).id;
	const cur = ( await api( p, 'GET', 'sites/' + madhu ) ).data.settings;
	const setup = await api( p, 'POST', 'sites/' + madhu, { base_rev: cur.rev, settings: { audience: 'Freshers and graduates in India', tone: 'Friendly and practical', words: 1200, boxes: [ 'quick-answer', 'takeaways', 'tip', 'warning', 'note', 'checklist', 'faq' ], banned: 'delve\nResearch beats', style: '- Short paragraphs.\n- Speak to the reader as "you".', examples: [ { title: 'Resume basics', text: 'EXAMPLEVOICE Your resume is the first thing a recruiter sees. Keep it to one page.' } ], prompts: {} } } );
	ok( 200 === setup.status, 'test setup: writing settings saved', JSON.stringify( setup.data ).slice( 0, 200 ) );
	await p.reload();
	await p.waitForSelector( '.cp-shell' );

	console.log( '== Write article from a note' );
	await p.click( '.cp-node__open:has(.cp-node__name:text-is("Madhu Infotech"))' );
	await p.click( '.cp-capture__input' );
	await p.fill( '.cp-editor__title', 'Interview tips for freshers' );
	await p.fill( '.cp-editor__body', 'research company, dress, tell me about yourself, salary question, follow up mail' );
	await saved( p );
	await p.click( '.cp-write-article' );
	await p.waitForSelector( '.cp-steps' );
	const id = parseInt( ( p.url().match( /#article=(\d+)/ ) || [] )[ 1 ], 10 );
	ok( id > 0, 'opens the workspace at #article=' + id );
	ok( 'Interview tips for freshers' === await p.inputValue( '.cp-art__title' ), 'title taken from the note' );
	ok( String( madhu ) === await p.inputValue( '.cp-art__site' ), 'website taken from the note\'s folder' );
	ok( await p.isVisible( '.cp-steps__btn[aria-current="step"]:has-text("Cleanup")' ), 'starts at step 1 Cleanup' );
	await shot( p, 'article-cleanup' );

	console.log( '== 1. Cleanup' );
	let pr = await promptText( p );
	ok( pr.copied, 'Copy prompt puts the prompt on the clipboard' );
	ok( /Website: Madhu Infotech/.test( pr.t ) && /Audience: Freshers and graduates in India/.test( pr.t ) && /Tone: Friendly and practical/.test( pr.t ), 'prompt has the website settings', pr.t.slice( 0, 200 ) );
	ok( /Style guide \(follow it\):\n- Short paragraphs\./.test( pr.t ) && /EXAMPLEVOICE/.test( pr.t ), 'prompt has the style guide and a piece of the example' );
	ok( /salary question, follow up mail/.test( pr.t ) && ! /\{\{/.test( pr.t ), 'prompt has the note; no unfilled placeholders' );
	await paste( p, null, 'Title: Interview Tips for Freshers That Actually Work\n- Research the company\n- Dress neatly\n- Practise "Tell me about yourself"\n- Salary: give a range\n- Send a follow-up mail' );
	ok( /Research the company/.test( await p.inputValue( 'textarea[data-field="cleanup"]' ) ), 'Paste answer fills the box' );
	await p.click( 'button:has-text("as the article title")' );
	ok( 'Interview Tips for Freshers That Actually Work' === await p.inputValue( '.cp-art__title' ), '"Use as title" sets the article title' );
	await saved( p );
	let a = await art( p, id );
	ok( /Research the company/.test( a.fields.cleanup.value ) && 'Interview Tips for Freshers That Actually Work' === a.title, 'cleanup and title saved on the server' );
	ok( await p.isVisible( '.cp-steps__btn.is-done:has-text("Cleanup")' ), 'step 1 shows as done' );

	console.log( '== 2. Outline' );
	await p.click( 'button:has-text("Next: Outline")' );
	await p.waitForSelector( '.cp-step__title:has-text("Outline")' );
	pr = await promptText( p );
	ok( /about 1200 words/.test( pr.t ) && /Research the company/.test( pr.t ) && /"FAQ"/.test( pr.t ), 'outline prompt: target words, cleaned notes, FAQ rule' );
	await paste( p, null, '## Why the first interview feels hard\nBrief: the reader\'s worry\nWords: 150\n\n## Research the company\nBrief: three things to find\nWords: 300\n\n## What to wear\nBrief: safe choices\nWords: 250\n\n## FAQ\nBrief: common questions\nWords: 200' );
	await p.waitForSelector( '.cp-outline__row' );
	ok( 4 === ( await p.$$( '.cp-outline__row' ) ).length, 'pasted outline read into 4 sections' );
	await p.fill( '.cp-outline__row >> nth=2 >> .cp-outline__heading', 'What to wear on the day' );
	await p.click( '.cp-outline__row >> nth=2 >> [aria-label="Move up"]' );
	await saved( p );
	a = await art( p, id );
	ok( 'What to wear on the day' === a.fields.outline.value[ 1 ].heading, 'edit and move a section: saved' );
	await p.click( '.cp-approve-btn' );
	await saved( p );
	a = await art( p, id );
	ok( 'outline_ready' === a.stage && 4 === a.fields.approved.value.ids.length, 'Approve outline: stage Outline ready' );
	st = ( await api( p, 'GET', 'state' ) ).data;
	ok( 'outline_ready' === st.notes.find( ( n ) => n.id === a.note ).status, 'the note\'s status follows (Outline ready)' );
	await shot( p, 'article-outline' );

	console.log( '== 3. Draft' );
	await step( p, 'Draft' );
	ok( 4 === ( await p.$$( '.cp-sec' ) ).length, '4 section boxes' );
	// Outline order after the move: Why…, What to wear on the day, Research the company, FAQ.
	const texts = [ 'Your first interview can feel scary.', 'Wear clean, simple clothes.', 'Spend 30 minutes on the company website.', ':::faq\n### Can I carry my resume?\nYes, two copies.\n:::' ];
	for ( let k = 0; k < 4; k++ ) {
		const scope = '.cp-sec >> nth=' + k;
		if ( ! await p.$eval( '.cp-sec >> nth=' + k, ( d ) => d.open ) ) {
			await p.click( '.cp-sec >> nth=' + k + ' >> summary' );
		}
		if ( 1 === k ) {
			await p.locator( scope ).locator( 'button:has-text("Copy prompt")' ).click();
			await p.waitForSelector( '.cp-prompt-text' );
			const sp = { t: await p.inputValue( '.cp-prompt-text' ) };
			await p.keyboard.press( 'Escape' );
			ok( /Section heading: What to wear on the day/.test( sp.t ) && /Already written \(do not repeat it\)/.test( sp.t ) && /Your first interview can feel scary/.test( sp.t ), 'section prompt has its heading and the sections already written' );
			ok( /:::tip/.test( sp.t ) && ! /quick-answer/.test( sp.t ), 'section prompt offers section boxes only (no quick answer)' );
		}
		await clip( p, texts[ k ] );
		await p.locator( scope ).locator( 'button:has-text("Paste answer")' ).click();
		await p.waitForTimeout( 150 );
	}
	await saved( p );
	a = await art( p, id );
	ok( 'draft_ready' === a.stage, 'all sections written: stage Draft ready' );
	ok( /4 \/ 250 words|\d+ \/ \d+ words/.test( await p.textContent( '.cp-sec >> nth=1 >> .cp-count' ) ), 'word count per section' );

	console.log( '== 4. Polish' );
	await step( p, 'Polish' );
	pr = await promptText( p );
	ok( /## What to wear on the day\n\nWear clean, simple clothes\./.test( pr.t ) && /delve/.test( pr.t ) && /quick-answer/.test( pr.t ), 'polish prompt: whole draft, phrases to avoid, all boxes' );
	const polished = fs.readFileSync( path.join( __dirname, 'sample-article.md' ), 'utf8' );
	await paste( p, null, polished );
	await saved( p );

	console.log( '== 5. Check' );
	await step( p, 'Check' );
	const checkText = await p.textContent( '.cp-checks' );
	ok( /Missing details/.test( checkText ) && await p.isVisible( '.cp-check--fail:has-text("Missing details")' ), 'check: [NEEDS DETAIL] left = must fix' );
	ok( await p.isVisible( '.cp-check--warn:has-text("Phrases to avoid")' ), 'check: phrase to avoid from the website settings found' );
	await shot( p, 'article-check' );
	await p.click( '.cp-ready-btn' );
	await p.click( 'dialog[open] button:text-is("Mark as ready")' );
	await saved( p );
	ok( 'ready' === ( await art( p, id ) ).stage, 'Mark as ready (after confirming failed checks): stage Ready' );

	console.log( '== 6. SEO' );
	await step( p, 'SEO' );
	pr = await promptText( p );
	ok( /SEO title:/.test( pr.t ) && /Research the company/.test( pr.t ), 'SEO prompt has the article' );
	await clip( p, 'SEO title: Interview Tips for Freshers: 7 Simple Steps\nMeta description: ' + 'A'.repeat( 150 ) + '\nSlug: Interview Tips Freshers!\nFocus keyword: interview tips for freshers\nExcerpt: Simple steps for your first interview.' );
	await p.click( '.cp-step__body button:has-text("Paste answer")' );
	await p.waitForTimeout( 300 );
	ok( 'interview-tips-freshers' === await p.inputValue( 'input[data-seo="slug"]' ) && 'Interview Tips for Freshers: 7 Simple Steps' === await p.inputValue( 'input[data-seo="title"]' ), 'Paste fills the 5 SEO fields (slug cleaned)' );
	ok( /43 characters/.test( await p.textContent( '.cp-counter >> nth=0' ) ), 'character counter' );
	ok( /interview-tips-freshers/.test( await p.textContent( '.cp-snippet' ) ), 'search result preview' );
	await saved( p );
	ok( 'interview tips for freshers' === ( await art( p, id ) ).fields.seo.value.keyword, 'SEO fields saved' );

	console.log( '== 7. Copy to WordPress' );
	await step( p, 'Copy to WordPress' );
	await p.click( '.cp-copy-blocks' );
	const blocks = await clipboard( p );
	ok( /^<!-- wp:heading -->/.test( blocks ) && /is-style-bk-quick-answer/.test( blocks ) && /is-style-bk-faq/.test( blocks ), 'Copy for WordPress: block markup with Blog Kit boxes' );
	ok( ! /<script>/.test( blocks ) && 0 === await p.$$eval( '.cp-preview script', ( s ) => s.length ), 'no script in the copy or the preview' );
	ok( await p.isVisible( '.cp-preview .is-style-bk-tip' ) && await p.isVisible( '.cp-preview table' ), 'preview shows boxes and table' );
	await shot( p, 'article-export' );
	await p.click( '.cp-publish-btn' );
	await saved( p );
	a = await art( p, id );
	st = ( await api( p, 'GET', 'state' ) ).data;
	ok( 'published' === a.stage && 'published' === st.notes.find( ( n ) => n.id === a.note ).status, 'Mark as published: article and note Published' );
	// The copied blocks in the real block editor.
	const ed = await ctx.newPage();
	await ed.goto( BASE + '/wp-admin/post-new.php' );
	await ed.waitForFunction( () => window.wp && wp.blocks && wp.blocks.getBlockTypes().length > 50, null, { timeout: 60000 } );
	const v = await ed.evaluate( ( m ) => {
		const all = [];
		const walk = ( l ) => l.forEach( ( b ) => {
			all.push( b );
			walk( b.innerBlocks );
		} );
		walk( wp.blocks.parse( m ) );
		return { n: all.length, bad: all.filter( ( b ) => ! b.isValid || 'core/freeform' === b.name ).map( ( b ) => b.name ) };
	}, blocks );
	ok( v.n > 20 && 0 === v.bad.length, 'copied article: ' + v.n + ' blocks, all valid in the WordPress editor', v.bad.join( ',' ) );
	await ed.close();

	console.log( '== Earlier versions' );
	await step( p, 'Cleanup' );
	await paste( p, null, '- a newer cleanup' );
	await saved( p );
	await p.click( '.cp-step__body button[data-versions="cleanup"]' );
	await p.waitForSelector( 'dialog[open] .cp-row' );
	ok( await p.isVisible( 'dialog[open] .cp-row__title:has-text("Before a new answer was pasted")' ), 'earlier version listed after pasting a new answer' );
	await p.click( 'dialog[open] .cp-row >> nth=0 >> button:has-text("Restore")' );
	ok( /Research the company/.test( await p.inputValue( 'textarea[data-field="cleanup"]' ) ), 'Restore brings it back' );
	await saved( p );

	console.log( '== Reload and Back' );
	await p.reload();
	await p.waitForSelector( '.cp-steps' );
	ok( p.url().endsWith( '#article=' + id ) && await p.isVisible( '.cp-steps__btn[aria-current="step"]:has-text("Cleanup")' ), 'reload stays on the article and the last step' );
	await p.click( '.cp-art__top [aria-label="All articles"]' );
	await p.waitForSelector( '.cp-crumbs:has-text("Articles")' );
	ok( await p.isVisible( '.cp-row[data-id="' + id + '"] .cp-badge--status-published' ), 'articles list shows it as Published' );
	await p.goBack();
	await p.waitForSelector( '.cp-steps' );
	ok( p.url().endsWith( '#article=' + id ), 'Back returns to the article' );

	console.log( '== Saving safety for article text' );
	await step( p, 'Polish' );
	await ctx.setOffline( true );
	await p.fill( 'textarea[data-field="polish"]', 'typed while offline in the article' );
	await p.waitForTimeout( 1200 );
	const stored = await p.evaluate( () => Object.keys( localStorage ).filter( ( k ) => k.includes( ':rec:' ) ).map( ( k ) => localStorage.getItem( k ) ).join( '' ) );
	ok( /typed while offline in the article/.test( stored ), 'offline: article text kept in this browser' );
	await p.close();
	await ctx.setOffline( false );
	const p2 = await ctx.newPage();
	p2.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + e.message ) );
	await p2.goto( BASE + '/notes/#article=' + id );
	await p2.waitForSelector( '.cp-steps' );
	await saved( p2, 30000 ).catch( () => {} );
	let a2 = await art( p2, id );
	for ( let k = 0; k < 30 && 'typed while offline in the article' !== a2.fields.polish.value; k++ ) {
		await p2.waitForTimeout( 1000 );
		a2 = await art( p2, id );
	}
	ok( 'typed while offline in the article' === a2.fields.polish.value, 'saved after the tab was closed and reopened online' );

	// Another device changes the same step while this tab has an unsaved change.
	await step( p2, 'Polish' );
	await p2.route( '**/cp/v1/articles/' + id, ( r ) => ( 'POST' === r.request().method() ? r.abort() : r.continue() ) );
	await p2.fill( 'textarea[data-field="polish"]', 'this tab\'s version' );
	await p2.waitForTimeout( 1000 );
	const other = await browser.newContext();
	const o = await other.newPage();
	await login( o );
	const oa = await art( o, id );
	await api( o, 'POST', 'articles/' + id, { field: 'polish', value: 'other device version', base_rev: oa.fields.polish.rev } );
	await other.close();
	await p2.unroute( '**/cp/v1/articles/' + id );
	await p2.evaluate( () => window.cpHub.flush() );
	await p2.waitForSelector( '.cp-toast:has-text("changed on another device")', { timeout: 10000 } ).then( () => ok( true, 'conflict: the user is told' ), () => ok( false, 'conflict: the user is told' ) );
	a2 = await art( p2, id );
	ok( 'other device version' === a2.fields.polish.value && a2.fields.polish.versions.some( ( x ) => 'conflict' === x.why && 'this tab\'s version' === x.value ), 'conflict: nothing overwritten, this tab\'s text kept as an earlier version' );

	// Refused save.
	await p2.route( '**/cp/v1/articles/' + id, ( r ) => ( 'POST' === r.request().method() ? r.fulfill( { status: 403, contentType: 'application/json', body: '{"code":"rest_forbidden","message":"Sorry, you are not allowed to do that.","data":{"status":403}}' } ) : r.continue() ) );
	await p2.fill( 'textarea[data-field="polish"]', 'must not be lost' );
	await p2.waitForSelector( '#cp-error-banner:not([hidden])', { timeout: 10000 } );
	ok( await p2.isVisible( '#cp-error-banner button:has-text("Copy text")' ) && await p2.isVisible( '#cp-error-banner button:has-text("Discard")' ), 'refused save: kept, with Try again / Copy text / Discard' );
	ok( 'saved' !== await p2.getAttribute( '#cp-sync', 'data-state' ), 'refused save: indicator does not say saved' );
	await p2.unroute( '**/cp/v1/articles/' + id );
	await p2.click( '#cp-error-banner button:has-text("Try again")' );
	await saved( p2 );
	ok( 'must not be lost' === ( await art( p2, id ) ).fields.polish.value, 'Try again saves it' );

	console.log( '== Writing settings screen' );
	await p2.goto( BASE + '/notes/' );
	await p2.waitForSelector( '.cp-shell' );
	await p2.click( '.cp-node:has(.cp-node__name:text-is("Madhu Infotech")) .cp-node__more' );
	await p2.click( '.cp-menu button:has-text("Website writing settings")' );
	await p2.waitForSelector( '.cp-save-settings' );
	ok( p2.url().includes( '#site=' + madhu ), 'folder menu opens the website\'s writing settings' );
	ok( 'Freshers and graduates in India' === await p2.inputValue( '[data-setting="audience"]' ), 'settings shown' );
	await p2.fill( '[data-setting="tone"]', 'Warm and direct' );
	await p2.click( 'button:has-text("Add an example article")' );
	await p2.fill( '.cp-example >> nth=1 >> textarea', 'SECONDEXAMPLE text of a second article.' );
	await p2.uncheck( 'input[data-box="faq"]' );
	ok( await p2.isVisible( '.cp-settings__status.is-dirty' ), 'unsaved changes shown' );
	await p2.click( '.cp-save-settings' );
	await p2.waitForSelector( '.cp-settings__status:text-is("Saved ✓")' );
	const s2 = ( await api( p2, 'GET', 'sites/' + madhu ) ).data.settings;
	ok( 'Warm and direct' === s2.tone && 2 === s2.examples.length && ! s2.boxes.includes( 'faq' ), 'Save settings: tone, example, boxes saved', JSON.stringify( { tone: s2.tone, ex: s2.examples.length, boxes: s2.boxes } ) );
	await p2.click( 'button:has-text("Create style guide from examples")' );
	await p2.waitForSelector( '.cp-prompt-text' );
	const sg = await p2.inputValue( '.cp-prompt-text' );
	ok( /EXAMPLEVOICE/.test( sg ) && /SECONDEXAMPLE/.test( sg ) && /Madhu Infotech/.test( sg ), 'style guide prompt has all examples' );
	await p2.keyboard.press( 'Escape' );
	await clip( p2, '- Write for first-time job seekers.\n- One idea per paragraph.' );
	await p2.click( '.cp-settings button:has-text("Paste answer")' );
	await p2.click( '.cp-save-settings' );
	await p2.waitForSelector( '.cp-settings__status:text-is("Saved ✓")' );
	ok( /One idea per paragraph/.test( ( await api( p2, 'GET', 'sites/' + madhu ) ).data.settings.style ), 'style guide pasted and saved' );
	await p2.click( '.cp-source summary:has-text("Prompts")' );
	await p2.fill( 'textarea[data-prompt="cleanup"]', 'CUSTOM CLEANUP {{note}}' );
	await p2.click( '.cp-save-settings' );
	await p2.waitForSelector( '.cp-settings__status:text-is("Saved ✓")' );
	ok( /^CUSTOM CLEANUP/.test( ( ( await api( p2, 'GET', 'sites/' + madhu ) ).data.settings.prompts || {} ).cleanup || '' ), 'custom prompt saved' );
	// Stale save: settings changed elsewhere meanwhile.
	const s3 = ( await api( p2, 'GET', 'sites/' + madhu ) ).data.settings;
	await api( p2, 'POST', 'sites/' + madhu, { base_rev: s3.rev, settings: { language: 'English (India)' } } );
	await p2.fill( '[data-setting="tone"]', 'stale edit' );
	const toastSeen = p2.waitForSelector( '.cp-toast:has-text("changed somewhere else")', { timeout: 6000 } ).then( () => true, () => false );
	await p2.click( '.cp-save-settings' );
	ok( await toastSeen, 'stale settings save refused with a Reload button' );
	const s4 = ( await api( p2, 'GET', 'sites/' + madhu ) ).data.settings;
	ok( 'English (India)' === s4.language, 'the other change was not overwritten', JSON.stringify( { lang: s4.language, tone: s4.tone, rev: s4.rev, s3rev: s3.rev } ) );

	console.log( '== Custom prompt is used' );
	await p2.goto( BASE + '/notes/#article=' + id );
	await p2.waitForSelector( '.cp-steps' );
	await step( p2, 'Cleanup' );
	pr = await promptText( p2 );
	ok( /^CUSTOM CLEANUP Interview tips for freshers/.test( pr.t ), 'the website\'s own cleanup prompt is used' );

	console.log( '== Trash' );
	await p2.click( '.cp-art__top [aria-label="Article options"]' );
	await p2.click( '.cp-menu button:has-text("Move to trash")' );
	await p2.click( 'dialog[open] button:text-is("Move to trash")' );
	await p2.waitForSelector( '.cp-toast:has-text("moved to the trash")' );
	ok( ! await p2.isVisible( '.cp-row[data-id="' + id + '"]' ), 'trashed article left the list' );
	await p2.click( '.cp-node__open:has-text("Trash")' );
	await p2.waitForSelector( '.cp-row:has-text("Interview Tips for Freshers That Actually Work")' );
	await p2.click( '.cp-row:has-text("Interview Tips for Freshers That Actually Work") button:has-text("Restore")' );
	await p2.waitForSelector( '.cp-toast:has-text("Article restored")' );
	ok( false === ( await art( p2, id ) ).trashed, 'restored from the trash' );

	console.log( '== Note shows its article' );
	await p2.click( '.cp-node__open:has(.cp-node__name:text-is("Madhu Infotech"))' );
	ok( await p2.isVisible( '.cp-card:has-text("Interview tips for freshers") .cp-badge--article' ), 'note card shows it has an article' );
	await p2.click( '.cp-card:has-text("Interview tips for freshers")' );
	ok( await p2.isVisible( 'dialog[open] .cp-editor__articles button:has-text("Published")' ) && await p2.isVisible( 'dialog[open] .cp-write-article:has-text("New article")' ), 'note editor links to the article and offers a new one' );
	await p2.click( 'dialog[open] .cp-editor__articles button:has-text("Published")' );
	await p2.waitForSelector( '.cp-steps' );
	ok( p2.url().endsWith( '#article=' + id ), 'link opens the article' );
	ok( 0 === errors.length, 'no JavaScript errors (desktop)', errors.join( ' | ' ) );
	await ctx.close();

	console.log( '== Phone' );
	const phone = await browser.newContext( Object.assign( {}, devices[ 'Pixel 7' ], { permissions: [ 'clipboard-read', 'clipboard-write' ] } ) );
	const pp = await phone.newPage();
	const perr = [];
	pp.on( 'pageerror', ( e ) => perr.push( e.message ) );
	await login( pp );
	await pp.goto( BASE + '/notes/#article=' + id );
	await pp.waitForSelector( '.cp-steps' );
	const layout = await pp.evaluate( () => ( { row: 'row' === getComputedStyle( document.querySelector( '.cp-steps' ) ).flexDirection, wide: document.documentElement.scrollWidth <= window.innerWidth } ) );
	ok( layout.row, 'phone: steps shown as a scrollable row' );
	ok( layout.wide, 'phone: no sideways scrolling' );
	await step( pp, 'Outline' );
	await shot( pp, 'phone-article-outline' );
	ok( await pp.isVisible( '.cp-outline__row' ), 'phone: outline editor usable' );
	ok( 0 === perr.length, 'no JavaScript errors (phone)', perr.join( ' | ' ) );
	await phone.close();

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
