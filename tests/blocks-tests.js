/* eslint-disable no-console */
// Tests for assets/js/blocks.js:
//  1. In Node: converter, outline/SEO reading, checks, prompt filling, escaping.
//  2. In the real WordPress block editor (Playwright): every block produced from
//     tests/sample-article.md must be valid (no "This block contains unexpected content").
// Env: BASE, PW (playwright package path). Part 2 needs a running test site.
const path = require( 'path' );
const fs = require( 'fs' );
const B = require( path.join( __dirname, '..', 'assets', 'js', 'blocks.js' ) );
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

const sample = fs.readFileSync( path.join( __dirname, 'sample-article.md' ), 'utf8' );
const html = B.markdownToBlocks( sample );

console.log( '== Converter (Node)' );
ok( ! /<script>/i.test( html ) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test( html ), 'pasted HTML is shown as text, never added as HTML' );
ok( /<a href="https:\/\/www\.linkedin\.com\/">LinkedIn page<\/a>/.test( html ), 'https links kept' );
ok( ! /href="javascript/i.test( B.markdownToBlocks( '[x](javascript:alert(1))' ) ), 'javascript: links not turned into links' );
ok( /<strong>really<\/strong>/.test( html ) && /<em>simple<\/em>/.test( html ), 'bold and italic' );
ok( /<code>npm install<\/code>/.test( html ), 'inline code' );
ok( ( html.match( /<!-- wp:heading -->/g ) || [] ).length === 5, '5 section headings (##)', ( html.match( /<!-- wp:heading -->/g ) || [] ).length );
ok( /<!-- wp:heading \{"level":3\} -->/.test( html ), '### becomes a level-3 heading' );
ok( /<!-- wp:list \{"ordered":true\} -->/.test( html ), 'numbered list' );
ok( /and how would you explain them to a friend\?<\/li>/.test( html ), 'wrapped list line joined to its item' );
ok( /is-style-bk-quick-answer/.test( html ) && /is-style-bk-tip/.test( html ) && /is-style-bk-warning/.test( html ) && /is-style-bk-takeaways/.test( html ), 'Blog Kit boxes (quick answer, tip, warning, takeaways)' );
ok( /<!-- wp:list \{"className":"is-style-bk-checklist"\} -->/.test( html ), 'checklist box becomes a Blog Kit checklist' );
ok( ( html.match( /<!-- wp:details \{"className":"is-style-bk-faq"\} -->/g ) || [] ).length === 2, 'FAQ box becomes 2 Blog Kit FAQ blocks' );
ok( /<summary>Can I carry a printed resume\?<\/summary>/.test( html ), 'FAQ question in summary' );
ok( /<table class="has-fixed-layout"><thead><tr><th>Role<\/th>/.test( html ), 'table' );
ok( /<!-- wp:quote -->/.test( html ), 'quote' );
ok( /\[NEEDS DETAIL: fresher salary range in Pune\]/.test( html ), '[NEEDS DETAIL] kept visible' );
ok( '' === B.markdownToBlocks( '' ), 'empty text gives no blocks' );
ok( /<h2 class="wp-block-heading">Title<\/h2>/.test( B.markdownToBlocks( '# Title' ) ), '# is turned into ##' );

console.log( '== Reading pasted answers (Node)' );
const outline = B.parseOutline( '## Why it matters\nBrief: The reader\'s problem\nWords: 200\n\n## **Dress code**\nBrief: what to wear\nWords: ~250\n\n## FAQ\nBrief: 4 questions\nWords: 150' );
ok( 3 === outline.length && 'Dress code' === outline[ 1 ].heading && 250 === outline[ 1 ].words && 'what to wear' === outline[ 1 ].brief, 'outline with ## / Brief / Words', JSON.stringify( outline ) );
const numbered = B.parseOutline( '1. Introduction (150 words)\n   - why freshers struggle\n2. Research the company (300 words)' );
ok( 2 === numbered.length && 150 === numbered[ 0 ].words && 'Research the company' === numbered[ 1 ].heading, 'numbered outline with (N words)', JSON.stringify( numbered ) );
const seo = B.parseSeo( 'SEO title: Interview Tips for Freshers: 7 Steps\n**Meta description:** Simple steps.\nSlug: Interview Tips Freshers!\nFocus keyword: interview tips for freshers\nExcerpt: Short.' );
ok( 'Interview Tips for Freshers: 7 Steps' === seo.title && 'Simple steps.' === seo.description && 'interview-tips-freshers' === seo.slug && 'interview tips for freshers' === seo.keyword && 'Short.' === seo.excerpt, 'SEO lines read (bold labels, slug cleaned)', JSON.stringify( seo ) );
ok( 'Interview Tips That Work' === B.titleLine( 'Title: Interview Tips That Work\n- point' ), 'cleanup "Title:" line read' );

console.log( '== Checks (Node)' );
const rows = B.check( sample, { words: 400, banned: [ 'delve', 'Research beats' ], seo: { title: 'Interview tips for freshers: what to do', description: 'x'.repeat( 140 ), slug: 'interview-tips', keyword: 'interview' } } );
const row = ( label ) => rows.find( ( r ) => r.label === label ) || {};
ok( 'fail' === row( 'Missing details' ).state, 'check: [NEEDS DETAIL] left = fail' );
ok( 'warn' === row( 'Phrases to avoid' ).state && /Research beats/.test( row( 'Phrases to avoid' ).text ), 'check: phrase to avoid found' );
ok( 'ok' === row( 'Sections' ).state, 'check: sections ok' );
ok( 'ok' === row( 'SEO title' ).state && 'ok' === row( 'Meta description' ).state, 'check: SEO lengths ok' );
const bad = B.check( '## A\n\n## B\nBrief: x\n:::tip\nopen box', { words: 1000, banned: [], seo: {} } );
ok( 'fail' === ( bad.find( ( r ) => 'Empty sections' === r.label ) || {} ).state, 'check: empty section = fail' );
ok( 'fail' === ( bad.find( ( r ) => 'Leftover instructions' === r.label ) || {} ).state, 'check: leftover Brief: / unclosed box = fail' );
ok( 'fail' === B.check( '', {} )[ 0 ].state, 'check: no text = fail' );

console.log( '== Prompt filling (Node)' );
ok( 'Hi Ann\n\nbye' === B.fill( 'Hi {{name}}\n\n{{empty}}\n\nbye', { name: 'Ann' } ), 'placeholders filled, empty lines collapsed' );

( async () => {
	if ( ! process.env.PW ) {
		console.log( '(skipping block-editor check: PW not set)' );
	} else {
		console.log( '== Validity in the real WordPress block editor' );
		const { chromium } = require( process.env.PW );
		const browser = await chromium.launch();
		const p = await ( await browser.newContext() ).newPage();
		await p.goto( BASE + '/wp-login.php' );
		await p.fill( '#user_login', 'admin' );
		await p.fill( '#user_pass', 'admin' );
		await Promise.all( [ p.waitForNavigation( { timeout: 90000 } ), p.click( '#wp-submit' ) ] );
		await p.goto( BASE + '/wp-admin/post-new.php' );
		await p.waitForFunction( () => window.wp && wp.blocks && wp.blocks.getBlockTypes().length > 50, null, { timeout: 60000 } );
		const result = await p.evaluate( ( markup ) => {
			const all = [];
			const walk = ( list ) => list.forEach( ( b ) => {
				all.push( b );
				walk( b.innerBlocks );
			} );
			const blocks = wp.blocks.parse( markup );
			walk( blocks );
			const invalid = all.filter( ( b ) => ! b.isValid ).map( ( b ) => b.name + ': ' + ( b.validationIssues || [] ).map( ( i ) => i.args ? i.args.join( ' ' ) : '' ).join( ' | ' ).slice( 0, 300 ) );
			const freeform = all.filter( ( b ) => 'core/freeform' === b.name || 'core/missing' === b.name ).length;
			return { count: all.length, top: blocks.length, invalid, freeform, names: Array.from( new Set( all.map( ( b ) => b.name ) ) ) };
		}, html );
		ok( result.count > 30, 'editor read ' + result.count + ' blocks (' + result.names.join( ', ' ) + ')' );
		ok( 0 === result.invalid.length, 'every block is valid in the editor', result.invalid.join( ' || ' ) );
		ok( 0 === result.freeform, 'no "Classic" or missing blocks' );
		await browser.close();
	}
	console.log( '' );
	console.log( 'Result: ' + pass + ' passed, ' + fail + ' failed' );
	process.exit( fail ? 1 : 0 );
} )();
