import { createServer, request } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { readFile, stat, mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const port = Number(option('--port', '4191'))
const apiPort = Number(option('--api-port', '18985'))
if (![port, apiPort].every(n => Number.isInteger(n) && n > 1024 && n < 65536) || port === apiPort) throw Error('Use two distinct unprivileged ports')
const requestedDataDir = option('--data-dir', undefined)
const dataDir = path.resolve(requestedDataDir ?? await mkdtemp(path.join(os.tmpdir(), 'typewords-library-dev-')))
const adminIDs = option('--admin-ids', '')
await mkdir(dataDir, { recursive: true, mode: 0o700 })
const binary = path.join(dataDir, 'typewords-api')
const build = spawnSync('go', ['build', '-o', binary, '.'], { cwd: path.join(root, 'server'), stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)
const api = spawn(binary, [], { cwd: path.join(root, 'server'), env: { ...process.env, TYPEWORDS_DATA_DIR: dataDir, TYPEWORDS_LISTEN: `127.0.0.1:${apiPort}`, TYPEWORDS_ADMIN_USER_IDS: adminIDs, ALLOW_REGISTRATION: 'true' }, stdio: 'inherit' })
const publicRoot = path.join(root, 'apps/nuxt/.output/public')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
const web = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxy = request({ hostname: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}` } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
    proxy.on('error', () => { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, msg: 'Local API is starting or unavailable' })) })
    req.pipe(proxy)
    return
  }
  try {
    let file = path.resolve(publicRoot, '.' + decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname))
    if (!file.startsWith(publicRoot + path.sep)) file = path.join(publicRoot, 'index.html')
    try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html'); await stat(file) } catch { file = path.join(publicRoot, '200.html') }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(await readFile(file))
  } catch { res.writeHead(503); res.end('Run pnpm -F @typewords/nuxt docker-build first.') }
})
web.listen(port, '127.0.0.1', () => console.log(`Library preview http://127.0.0.1:${port}/ — data: ${dataDir} — admin IDs: ${adminIDs || 'none'}`))
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; api.kill('SIGTERM'); web.close(); setTimeout(() => process.exit(code), 200).unref() }
api.on('exit', code => { if (!stopping) stop(code ?? 1) })
web.on('error', error => { console.error(error.message); stop(1) })
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
