/**
 * 扫描核心单元测试
 * 运行:node tests/scan.test.mjs
 *
 * 直接从 js/script.js 里截取 "扫描核心" 段执行,保证测的就是页面在跑的代码。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'js', 'script.js'), 'utf8')

const START = '/* ==scan-core-start== */'
const END = '/* ==scan-core-end== */'
const from = src.indexOf(START)
const to = src.indexOf(END)
assert.ok(from !== -1 && to > from, 'js/script.js 里找不到扫描核心标记')

const core = src.slice(from + START.length, to)
const { findUrls, extOf, catOfExt, urlKey, scanFiles } = new Function(
  core + '\nreturn { findUrls, extOf, catOfExt, urlKey, scanFiles }',
)()

const enc = new TextEncoder()
let passed = 0
function test(name, fn) {
  fn()
  passed++
  console.log('  ✓ ' + name)
}
const eq = assert.deepEqual

/* ------------------------------ 工具 ------------------------------ */
// 生成 "二进制噪声 + 文本 + 尾部 0" 的缓冲区,模拟缓存文件的真实字节环境
function bufferOf(text, before = 256, after = 256) {
  const body = enc.encode(text)
  const out = new Uint8Array(before + body.length + after)
  for (let i = 0; i < before; i++) out[i] = (i * 37) & 0xff
  out.set(body, before)
  return out
}
function fakeFile(bytes) {
  return {
    size: bytes.length,
    slice(a, b) {
      const view = bytes.subarray(a, b)
      return { arrayBuffer: async () => view.slice().buffer }
    },
  }
}

/* ------------------------------ 用例 ------------------------------ */
console.log('findUrls')

test('普通链接:http 与 https 都能识别,遇到空格停止', () => {
  const buf = bufferOf('noise https://example.com/a.webm?x=1 and http://cdn.test/b.png tail')
  eq(findUrls(buf, false), ['https://example.com/a.webm?x=1', 'http://cdn.test/b.png'])
})

test('紧跟链接的逗号、分号、右括号被剔除', () => {
  const buf = bufferOf('https://a.com/pic.png, https://a.com/b.png);')
  eq(findUrls(buf, false), ['https://a.com/pic.png', 'https://a.com/b.png'])
})

test('不以 http 开头的相似字节不会误报', () => {
  const buf = bufferOf('htp://a.com/x.png httpx://a.com/y.png ftp://a.com/z.png')
  eq(findUrls(buf, false), [])
})

test('过短的碎片被过滤(正文不足 13 字符)', () => {
  const buf = bufferOf('https://a.co https://a.com/some/long/path/x.png')
  eq(findUrls(buf, false), ['https://a.com/some/long/path/x.png'])
})

test('块尾被截断的链接:cutAtEnd=true 时丢弃,false 时保留', () => {
  const long = 'https://example.com/' + 'x'.repeat(60)
  const buf = new Uint8Array(enc.encode(long))
  eq(findUrls(buf, false), [long])
  eq(findUrls(buf, true), [])
})

console.log('extOf / catOfExt / urlKey')

test('扩展名:忽略查询串与哈希,统一小写', () => {
  assert.equal(extOf('https://x/a.WEBM?v=2#t'), '.webm')
  assert.equal(extOf('https://x/a.mp4?q=1'), '.mp4')
  assert.equal(extOf('https://x/dir.v2/file'), '')
  assert.equal(extOf('https://x/a/'), '')
})

test('分类映射', () => {
  assert.equal(catOfExt('.webm'), 'video')
  assert.equal(catOfExt('.avif'), 'image')
  assert.equal(catOfExt('.dat'), 'other')
  assert.equal(catOfExt(''), 'other')
})

test('去重键:去掉末尾斜杠和查询串', () => {
  assert.equal(urlKey('https://x/a.png?token=1'), 'https://x/a.png')
  assert.equal(urlKey('https://x/a.png/'), 'https://x/a.png')
})

console.log('scanFiles')

const MB = 1024 * 1024
const big = new Uint8Array(17 * MB + 123)
const put = (pos, s) => big.set(enc.encode(s), pos)
const boundary = 'https://cdn.example.com/bg/boundary.png?token=BBB'
put(100, 'https://cdn.example.com/bg/first.webm?token=AAA')
put(8 * MB - 10, boundary) // 起点落在第一块的最后 10 字节,必须靠下一块补全
put(15 * MB, 'https://cdn.example.com/bg/late.mp4')
put(16 * MB, 'https://cdn.example.com/bg/first.webm?token=CCC') // 与第一条同资源,应去重

const progress = []
const result = await scanFiles([fakeFile(big)], { onProgress: (r) => progress.push(r) })

test('跨 8MB 块的链接完整取回,且只出现一次', () => {
  const hits = result.items.filter((x) => x.url === boundary)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].cat, 'image')
})

test('按资源去重(query 不同视为同一条)', () => {
  assert.deepEqual(
    result.items.map((x) => x.url),
    [
      'https://cdn.example.com/bg/first.webm?token=AAA',
      boundary,
      'https://cdn.example.com/bg/late.mp4',
    ],
  )
})

test('进度单调递增并以 1 收尾', () => {
  assert.ok(progress.length >= 3, '应当按块回调进度')
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1])
  assert.equal(progress.at(-1), 1)
})

{
  const a = fakeFile(bufferOf('https://cdn.example.com/a.png'))
  const b = fakeFile(bufferOf('https://cdn.example.com/a.png?y=1 https://cdn.example.com/b.png'))
  const r = await scanFiles([a, b])
  assert.equal(r.items.length, 2)
  passed++
  console.log('  ✓ 多文件共用一张去重表')
}

{
  let calls = 0
  const r = await scanFiles([fakeFile(big)], { shouldAbort: () => calls++ > 0 })
  assert.equal(r.aborted, true)
  assert.ok(r.items.length < 3)
  passed++
  console.log('  ✓ shouldAbort 能在分块之间中断')
}

/* ------------------------------ 性能 ------------------------------ */
const noise = new Uint8Array(32 * MB)
for (let i = 0; i < noise.length; i += 4096) noise[i] = 0x68
for (let i = 0; i < 400; i++) noise.set(enc.encode(`https://cdn.example.com/a/${i}.png`), i * 8192)

const t0 = performance.now()
const perf = await scanFiles([fakeFile(noise)])
const ms = performance.now() - t0

console.log(`\n  性能:32 MB / ${ms.toFixed(0)} ms ≈ ${(32 / (ms / 1000)).toFixed(0)} MB/s,命中 ${perf.items.length} 条`)
assert.equal(perf.items.length, 400)

console.log(`\n全部通过:${passed} 项`)
