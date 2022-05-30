import '../util/prod.js';
import '../config/env.js';

import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

import chalk from 'chalk';
import express from 'express';
import proxy from 'express-http-proxy';

import appName from '../config/appName.js';
import {
	bare_server,
	rammerhead,
	theatre,
	website_build,
} from '../config/paths.js';
import clearConsole from '../util/clearConsole.js';

console.log(`${chalk.cyan('Starting the server...')}\n`);

const server = express();

function tryBind(port, hostname) {
	return new Promise((resolve, reject) => {
		const server = createServer();

		server.on('error', error => {
			reject(error);
		});

		server.on('listening', () => {
			server.close(() => resolve());
		});

		server.listen(port, hostname);
	});
}

// root <= 1024
const PORT_MIN = 1025;
const PORT_MAX = 65536;

async function createPort(hostname) {
	for (let i = 0; i < 1000; i++) {
		const port = ~~(Math.random() * (PORT_MAX - PORT_MIN)) + PORT_MIN;

		try {
			await tryBind(port, hostname);
			return port;
		} catch (error) {
			continue;
		}
	}

	throw new Error('Unable to find available port');
}

const barePort = await createPort();

fork(join(bare_server, 'app.js'), {
	stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
	env: {
		PORT: barePort,
	},
});

const rhPort = await createPort();
const rhCrossDomainPort = await createPort();

fork(join(rammerhead, 'src', 'server', 'index.js'), {
	cwd: rammerhead,
	stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
	env: {
		PORT: rhPort,
		CROSS_DOMAIN_PORT: rhCrossDomainPort,
	},
});

server.use('/theatre', express.static(join(theatre, 'public')));
server.use('/api/bare', proxy(`http://localhost:${barePort}`));
server.use(
	'/api/db',
	proxy(`https://static.holy.how/`, {
		proxyReqPathResolver: req => `/db/${req.url}`,
	})
);

const rammerhead_proxy = proxy(`http://127.0.0.1:${rhPort}`, {
	proxyReqPathResolver: req =>
		req.originalUrl.replace(/^\/[a-z0-9]{32}\/\w+:\/(?!\/)/, '$&/'),
});

for (let url of [
	'/([a-z0-9]{32})*',
	'/rammerhead.js',
	'/hammerhead.js',
	'/transport-worker.js',
	'/task.js',
	'/sessionexists',
	'/deletesession',
	'/newsession',
	'/editsession',
	'/needpassword',
	'/syncLocalStorage',
	'/api/shuffleDict',
]) {
	server.use(url, rammerhead_proxy);
}

server.use(express.static(website_build));

let port = process.env.PORT || 80;
const hostname = process.env.hostname || '0.0.0.0';

try {
	await tryBind(port);
} catch (error) {
	const newPort = await createPort(hostname);
	console.error(
		`${chalk.yellow(
			chalk.bold(
				`Address ${hostname}:${port} cannot be used. Binding to ${hostname}:${newPort} instead.`
			)
		)}\n`
	);
	port = newPort;
}

server.listen(port, hostname, () => {
	clearConsole();
	console.log(`You can now view ${chalk.bold(appName)} in the browser.\n`);
	console.log(`  ${chalk.bold('Listening on:')} ${hostname}:${port}\n`);
});
