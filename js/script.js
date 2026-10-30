/* =====================================================================
 * 米哈游启动器背景提取器
 * ---------------------------------------------------------------------
 * 结构:
 *   1. 扫描核心 —— 与 DOM 无关,可被 tests/scan.test.mjs 单独抽出验证
 *   2. 渲染     —— 结果只渲染一次,筛选靠显隐,不重建 DOM
 *   3. 交互     —— 拖拽 / 选择 / 取消 / 清除
 *   4. 装饰     —— 星空与流星(尊重"减少动态效果"设置)
 * ===================================================================== */

/* ============================ 1. 扫描核心 ============================ */
/* ==scan-core-start== */
// 扩展名 → 分类
const EXT_CATS = {
  video: ['.webm', '.mp4', '.m4v', '.mov', '.mkv', '.m3u8'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif'],
  other: ['.json', '.html', '.htm', '.js', '.css', '.xml', '.dat', '.woff', '.woff2', '.ttf'],
}
const EXT_MAP = new Map()
for (const cat in EXT_CATS) for (const ext of EXT_CATS[cat]) EXT_MAP.set(ext, cat)

// URL 中允许出现的字节:可打印 ASCII,去掉引号、尖括号、花括号、竖线、反斜杠、脱字符、反引号
const URL_CHAR = new Uint8Array(256)
for (let c = 0x21; c < 0x7f; c++) URL_CHAR[c] = 1
for (const c of [0x22, 0x27, 0x3c, 0x3e, 0x7b, 0x7d, 0x7c, 0x5c, 0x5e, 0x60]) URL_CHAR[c] = 0

// 紧跟在链接后面、应当剔除的标点:逗号 分号 右圆括号 右方括号
const URL_TAIL = new Uint8Array(256)
for (const c of [0x2c, 0x3b, 0x29, 0x5d]) URL_TAIL[c] = 1

const CHUNK_SIZE = 8 * 1024 * 1024 // 每块 8 MB
const OVERLAP_SIZE = 64 * 1024 // 块间重叠 64 KB,跨块 URL 不会丢
const MIN_BODY = 12 // "://" 之后至少 12 个字符才算有效链接

const decoder = new TextDecoder('utf-8')

/**
 * 在字节块里找出所有 http(s) 链接。
 * 用原生 indexOf 直接跳到下一个 'h',而不是逐字节判断,大文件下快一个量级。
 * @param {Uint8Array} bytes
 * @param {boolean} cutAtEnd 该块是否被文件尾之外的位置截断(是则丢弃块尾不完整的链接)
 * @returns {string[]}
 */
function findUrls(bytes, cutAtEnd) {
  const out = []
  const n = bytes.length
  let i = bytes.indexOf(0x68) // 'h'
  while (i !== -1) {
    if (i + 4 >= n) break
    if (bytes[i + 1] === 0x74 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x70) {
      // 'ttp'
      let p = i + 4
      if (bytes[p] === 0x73) p++ // 's'
      if (bytes[p] === 0x3a && bytes[p + 1] === 0x2f && bytes[p + 2] === 0x2f) {
        // '://'
        let j = p + 3
        while (j < n && URL_CHAR[bytes[j]] === 1) j++
        if (j - p - 3 > MIN_BODY) {
          let end = j
          while (end > p + 3 && URL_TAIL[bytes[end - 1]] === 1) end--
          // 块尾被截断的链接留给下一块完整扫描,避免拿到半截 URL
          if (!(cutAtEnd && j >= n)) out.push(decoder.decode(bytes.subarray(i, end)))
        }
        i = j
        continue
      }
    }
    i = bytes.indexOf(0x68, i + 1)
  }
  return out
}

/** 取 URL 的扩展名(忽略查询串和哈希),统一小写 */
function extOf(url) {
  const q = url.indexOf('?')
  const path = q === -1 ? url : url.slice(0, q)
  const h = path.indexOf('#')
  const clean = h === -1 ? path : path.slice(0, h)
  const m = clean.match(/\.[a-z0-9]+$/i)
  return m ? m[0].toLowerCase() : ''
}

/** 扩展名 → 分类 */
function catOfExt(ext) {
  return EXT_MAP.get(ext) || 'other'
}

/** 去重键:去掉尾部斜杠与查询串,同一资源的不同 token 只留一条 */
function urlKey(url) {
  return url.replace(/\/+$/, '').split('?')[0]
}

/**
 * 分块扫描一组文件,返回去重后的资源列表。
 * @param {Array<{size:number,slice:(a:number,b:number)=>{arrayBuffer:()=>Promise<ArrayBuffer>}}>} files
 * @param {{onProgress?:(ratio:number)=>void, shouldAbort?:()=>boolean}} [hooks]
 */
async function scanFiles(files, hooks = {}) {
  const { onProgress, shouldAbort } = hooks
  const seen = new Set()
  const items = []
  const total = files.length
  for (let f = 0; f < total; f++) {
    const file = files[f]
    const size = file.size
    if (!size) {
      if (onProgress) onProgress((f + 1) / total)
      continue
    }
    let offset = 0
    while (offset < size) {
      if (shouldAbort && shouldAbort()) return { items, aborted: true }
      const start = Math.max(0, offset - OVERLAP_SIZE)
      const end = Math.min(size, offset + CHUNK_SIZE)
      const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer())
      for (const url of findUrls(bytes, end < size)) {
        const key = urlKey(url)
        if (seen.has(key)) continue
        seen.add(key)
        const ext = extOf(url)
        items.push({ url, ext, cat: catOfExt(ext) })
      }
      if (onProgress) onProgress((f + end / size) / total)
      offset += CHUNK_SIZE
    }
  }
  return { items, aborted: false }
}
/* ==scan-core-end== */

/* ============================== 2. 渲染 ============================== */
const $ = (id) => document.getElementById(id)
const topEl = $('top')
const botEl = $('bot')
const scEl = $('sc')
const dz = $('dz')
const fi = $('fi')
const pb = $('pb')
const pf = $('pf')
const cl = $('cl')
const st = $('st')
const dv = $('dv')
const di = $('di')
const doEl = $('do')
const dashEl = $('dash')
const toastEl = $('ts')
const dzText = document.querySelector('.dz-text')

const ORDER = ['video', 'image', 'other']
const LABEL = { video: '🎬 视频', image: '🖼️ 图片', other: '📄 其他' }
const PAGE_SIZE = 80 // 每组先渲染 80 条,其余点开再补,避免上千条时卡死

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c])

let results = []
let groups = { video: [], image: [], other: [] }
let activeCats = { video: true, image: true, other: true }
let scanning = false
let scanToken = 0

function itemHtml(r) {
  const u = esc(r.url)
  let preview
  if (r.cat === 'image') {
    preview = `<img src="${u}" alt="" loading="lazy" decoding="async">`
  } else if (r.cat === 'video') {
    preview = `<video src="${u}" muted loop playsinline preload="metadata" controls></video>`
  } else {
    preview = `<span class="ph">📄</span>`
  }
  return (
    `<article class="it">` +
    `<div class="pv">${preview}</div>` +
    `<div class="meta">` +
    `<a class="u" href="${u}" target="_blank" rel="noopener noreferrer" title="${u}">${u}</a>` +
    `<div class="f">` +
    `<span class="t tg">${esc(r.ext || '无扩展名')}</span>` +
    `<span class="t tc">${r.cat}</span>` +
    `<button class="c" type="button" data-url="${u}">📋 复制</button>` +
    `</div></div></article>`
  )
}

function filterBar() {
  return (
    `<div class="fl" role="group" aria-label="按类型筛选">` +
    ORDER.map(
      (cat) =>
        `<label class="fl-lb" data-c="${cat}">` +
        `<input type="checkbox"${activeCats[cat] ? ' checked' : ''}>` +
        `<span class="mk"></span>${LABEL[cat]}` +
        `<span class="cnt">${groups[cat].length}</span></label>`,
    ).join('') +
    `</div>`
  )
}

function renderResults() {
  groups = { video: [], image: [], other: [] }
  for (const r of results) groups[r.cat].push(r)

  let html = filterBar()
  for (const cat of ORDER) {
    const list = groups[cat]
    if (!list.length) continue
    html += `<section class="grp" data-c="${cat}">`
    html += `<h2 class="ch">${LABEL[cat]}<span class="cnt">${list.length}</span></h2>`
    html += `<div class="l">${list.slice(0, PAGE_SIZE).map(itemHtml).join('')}</div>`
    if (list.length > PAGE_SIZE) {
      html += `<button class="more" type="button" data-c="${cat}">展开剩余 ${list.length - PAGE_SIZE} 项</button>`
    }
    html += `</section>`
  }
  html += `<p class="em hide" id="noMatch">当前筛选项下没有结果</p>`
  scEl.innerHTML = html
  applyFilter()
}

function applyFilter() {
  let shown = 0
  for (const sec of scEl.querySelectorAll('.grp')) {
    const on = !!activeCats[sec.dataset.c]
    sec.classList.toggle('hide', !on)
    if (on) shown++
  }
  const em = $('noMatch')
  if (em) em.classList.toggle('hide', shown > 0)
}

function paintCounts() {
  const vi = results.filter((r) => r.cat === 'video').length
  const im = results.filter((r) => r.cat === 'image').length
  dv.textContent = vi
  di.textContent = im
  doEl.textContent = results.length - vi - im
  document.querySelectorAll('.di .d').forEach((d) => d.classList.add('g'))
}

/* ============================== 3. 交互 ============================== */
function toast(msg) {
  toastEl.textContent = msg
  toastEl.classList.add('s')
  clearTimeout(toastEl._t)
  toastEl._t = setTimeout(() => toastEl.classList.remove('s'), 1800)
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  toast('✧ 已复制')
}

// 结果区事件委托:筛选 / 复制 / 展开
scEl.addEventListener('change', (e) => {
  const label = e.target.closest('.fl-lb')
  if (!label) return
  activeCats[label.dataset.c] = e.target.checked
  applyFilter()
})

scEl.addEventListener('click', (e) => {
  const more = e.target.closest('.more')
  if (more) {
    const cat = more.dataset.c
    const sec = more.closest('.grp')
    const shown = sec.querySelectorAll('.it').length
    sec.querySelector('.l').insertAdjacentHTML('beforeend', groups[cat].slice(shown).map(itemHtml).join(''))
    more.remove()
    return
  }
  const btn = e.target.closest('.c')
  if (btn && btn.dataset.url) copyText(btn.dataset.url)
})

// 预览加载失败时统一降级(错误事件不冒泡,只能捕获阶段监听)
scEl.addEventListener(
  'error',
  (e) => {
    const el = e.target
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
      const pv = el.closest('.pv')
      if (pv) pv.classList.add('bad')
    }
  },
  true,
)

/* ---------------------------- 扫描流程 ---------------------------- */
function setBusy(on) {
  dz.classList.toggle('busy', on)
  dz.setAttribute('aria-disabled', on ? 'true' : 'false')
}

function startScan(files) {
  if (scanning) return
  scanning = true
  const token = ++scanToken
  const label = files.length > 1 ? `${files.length} 个文件` : files[0].name

  setBusy(true)
  dzText.innerHTML = `正在读取 <strong>${esc(label)}</strong>`
  st.textContent = '✧ 正在扫描…'
  st.style.opacity = '1'
  pb.style.display = 'block'
  pf.style.width = '0%'
  cl.textContent = '✕ 取消'
  cl.classList.add('show')

  scanFiles(files, {
    onProgress: (ratio) => {
      pf.style.width = (ratio * 100).toFixed(1) + '%'
    },
    shouldAbort: () => token !== scanToken,
  })
    .then(({ items, aborted }) => {
      if (aborted) {
        resetIdle('✧ 已取消扫描')
        return
      }
      if (!items.length) {
        resetIdle('❌ 未找到资源,确认选的是 Cache_Data 里的 data_1')
        return
      }
      results = items
      paintCounts()
      renderResults()
      pb.style.display = 'none'
      pf.style.width = '0%'
      setBusy(false)
      dzText.innerHTML = '重新选择 <strong>data_1</strong>'
      cl.textContent = '✕ 清除'
      st.innerHTML = `✧ 发现 <span class="n">${items.length}</span> 个资源`
      st.style.opacity = '1'
      topEl.classList.add('sm')
      botEl.classList.add('on')
      dashEl.classList.add('on')
    })
    .catch((err) => {
      console.error(err)
      resetIdle('❌ ' + (err && err.message ? err.message : err))
    })
    .finally(() => {
      scanning = false
      fi.value = ''
    })
}

function resetIdle(statusText) {
  pb.style.display = 'none'
  pf.style.width = '0%'
  setBusy(false)
  dzText.innerHTML = '选择或拖拽 <strong>data_1</strong> 文件'
  // 扫描失败/取消时若已有旧结果,保留"清除"入口,否则用户没法回到初始页
  if (results.length) {
    cl.textContent = '✕ 清除'
    cl.classList.add('show')
  } else {
    cl.classList.remove('show')
    cl.textContent = '✕ 清除'
  }
  if (statusText) {
    st.textContent = statusText
    st.style.opacity = '1'
  }
}

function resetAll() {
  results = []
  groups = { video: [], image: [], other: [] }
  fi.value = ''
  dv.textContent = di.textContent = doEl.textContent = '0'
  document.querySelectorAll('.di .d').forEach((d) => d.classList.remove('g'))
  scEl.innerHTML = ''
  topEl.classList.remove('sm')
  botEl.classList.remove('on')
  dashEl.classList.remove('on')
  st.innerHTML = '✧ 选择 data_1 开始解析'
  st.style.opacity = '1'
  resetIdle()
}

cl.addEventListener('click', () => {
  if (scanning) {
    scanToken++ // 让扫描循环在下一个分块处退出
    cl.classList.remove('show')
    return
  }
  resetAll()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && scanning) {
    scanToken++
    cl.classList.remove('show')
  }
})

// 阻止把文件拖到页面其它位置时浏览器直接打开文件(会丢掉当前结果)
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

dz.addEventListener('click', () => {
  if (!scanning) fi.click()
})
dz.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !scanning) {
    e.preventDefault()
    fi.click()
  }
})
dz.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (!scanning) dz.classList.add('dragover')
})
dz.addEventListener('dragleave', (e) => {
  if (!dz.contains(e.relatedTarget)) dz.classList.remove('dragover')
})
dz.addEventListener('drop', (e) => {
  e.preventDefault()
  dz.classList.remove('dragover')
  if (scanning) return
  const files = e.dataTransfer && e.dataTransfer.files
  if (files && files.length) startScan(Array.from(files))
})

fi.addEventListener('change', (e) => {
  const files = Array.from(e.target.files || [])
  if (files.length) startScan(files)
})

/* 顶部"快速路径"的复制按钮 */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]')
  if (btn) copyText(btn.dataset.copy)
})

/* ============================== 4. 装饰 ============================== */
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

;(function starfield() {
  const el = $('stars')
  if (!el || reducedMotion) return
  const colors = ['#fff', '#f0f5ff', '#ffe8cc', '#e0f0ff', '#fff5e6']
  const count = window.innerWidth < 720 ? 34 : 70
  let html = ''
  for (let i = 0; i < count; i++) {
    const cls = ['s']
    let size = 0.4 + Math.random() * 1.4
    if (Math.random() < 0.08) {
      cls.push('bright')
      size += 0.4
    } else if (Math.random() < 0.2) {
      cls.push('faint')
    }
    html +=
      `<div class="${cls.join(' ')}" style="left:${(Math.random() * 100).toFixed(2)}%;top:${(Math.random() * 100).toFixed(2)}%;` +
      `font-size:${size.toFixed(2)}rem;color:${colors[(Math.random() * colors.length) | 0]};` +
      `--glow:${(size * 5).toFixed(1)}px;` +
      `--o1:${(0.1 + Math.random() * 0.3).toFixed(2)};--o2:${(0.6 + Math.random() * 0.4).toFixed(2)};--o3:${(0.15 + Math.random() * 0.3).toFixed(2)};` +
      `--s1:${(0.4 + Math.random() * 0.4).toFixed(2)};--s2:${(0.8 + Math.random() * 0.4).toFixed(2)};--s3:${(0.5 + Math.random() * 0.4).toFixed(2)};` +
      `--r1:${(-15 + Math.random() * 30).toFixed(1)}deg;--r2:${(-5 + Math.random() * 10).toFixed(1)}deg;--r3:${(-10 + Math.random() * 20).toFixed(1)}deg;` +
      `animation:shimmer ${(2 + Math.random() * 5).toFixed(2)}s ease-in-out ${(Math.random() * 6).toFixed(2)}s infinite backwards">✦</div>`
  }
  el.innerHTML = html
})()

;(function meteors() {
  const el = $('stars')
  if (!el || reducedMotion) return
  let timer = 0

  function spawn() {
    const dir = (Math.random() * 4) | 0
    let x, y, angle, fromLeft
    if (dir === 0) {
      x = Math.random() * 18
      y = Math.random() * 25
      angle = 5 + Math.random() * 50
      fromLeft = true
    } else if (dir === 1) {
      x = 82 + Math.random() * 18
      y = Math.random() * 25
      angle = 125 + Math.random() * 50
      fromLeft = false
    } else if (dir === 2) {
      x = Math.random() * 6
      y = 5 + Math.random() * 70
      angle = -20 + Math.random() * 40
      fromLeft = true
    } else {
      x = 5 + Math.random() * 90
      y = Math.random() * 8
      angle = 55 + Math.random() * 60
      fromLeft = Math.random() > 0.5
    }
    const rad = (angle * Math.PI) / 180
    const dist = 300 + Math.random() * 400
    let dur = 4 + Math.random() * 3
    if (dir === 3) dur *= 1.3
    const m = document.createElement('div')
    m.className = 'meteor'
    const star = document.createElement('span')
    star.className = 's'
    star.textContent = '✦'
    star.style.fontSize = 10 + Math.random() * 6 + 'px'
    m.appendChild(star)
    m.style.cssText =
      `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--tx:${(Math.cos(rad) * dist).toFixed(0)}px;` +
      `--ty:${(Math.sin(rad) * dist).toFixed(0)}px;--dur:${dur.toFixed(2)}s`
    el.appendChild(m)
    setTimeout(() => m.remove(), dur * 1000 + 200)
  }

  // 用递归 setTimeout 而不是 setInterval:标签页隐藏时不会持续堆节点
  function schedule() {
    clearTimeout(timer)
    if (document.hidden || reducedMotion) return
    const idle = topEl.classList.contains('sm') ? 5000 + Math.random() * 5000 : 2000 + Math.random() * 3000
    timer = setTimeout(() => {
      const n = 1 + ((Math.random() * 3) | 0)
      for (let i = 0; i < n; i++) setTimeout(spawn, i * 400)
      schedule()
    }, idle)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer)
    else schedule()
  })

  schedule()
})()

/* 入场动画只跑一次,之后由 .sm 状态控制布局 */
topEl.classList.add('init')
setTimeout(() => topEl.classList.remove('init'), 1500)
