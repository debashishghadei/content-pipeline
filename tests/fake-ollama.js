// Test helper: answers like Ollama. Refuses (403) browser requests from origins that are
// not allowed, like real Ollama does without OLLAMA_ORIGINS.
// Usage: node fake-ollama.js <port> <allowed-origin>
const http = require( 'http' );
const [ port, allowed ] = process.argv.slice( 2 );

http.createServer( ( req, res ) => {
	const origin = req.headers.origin;
	if ( origin && origin !== allowed ) {
		res.writeHead( 403 );
		res.end();
		return;
	}
	const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } : {};
	if ( 'OPTIONS' === req.method ) {
		res.writeHead( 204, cors );
		res.end();
		return;
	}
	let body = '';
	req.on( 'data', ( c ) => ( body += c ) );
	req.on( 'end', () => {
		const json = ( data ) => {
			res.writeHead( 200, Object.assign( { 'Content-Type': 'application/json' }, cors ) );
			res.end( JSON.stringify( data ) );
		};
		if ( '/api/version' === req.url ) {
			return json( { version: '0.0.0-fake' } );
		}
		if ( '/api/tags' === req.url ) {
			return json( { models: [ { name: 'fake-model:1b', size: 1300000000 } ] } );
		}
		if ( '/api/generate' === req.url ) {
			const p = JSON.parse( body || '{}' );
			return json( { model: p.model, response: 'Fake answer for: ' + p.prompt, eval_count: 30, eval_duration: 1500000000 } );
		}
		res.writeHead( 404, cors );
		res.end();
	} );
} ).listen( Number( port ), '127.0.0.1' );
