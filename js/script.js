// 资源类型 → 扩展名映射
const EXT_CATS={
  video:['.webm','.mp4','.m4v','.mov','.mkv','.m3u8'],
  image:['.png','.jpg','.jpeg','.gif','.webp','.bmp','.ico','.avif'],
  other:['.json','.html','.htm','.js','.css','.xml','.dat','.woff','.woff2','.ttf']
}
// URL 中合法的字符(排除空白/引号/尖括号/大括号/管道/反斜杠/插入符/反引号/控制符)
function isUrlChar(c){
  if(c<=0x20||c>=0x7f)return false
  return c!==0x22&&c!==0x27&&c!==0x3c&&c!==0x3e&&c!==0x7b&&c!==0x7d&&c!==0x7c&&c!==0x5c&&c!==0x5e&&c!==0x60
}
// 单次线性扫描,直接提取所有 http(s):// 链接,替代逐扩展名扫描(更快且更准)
// 第二个参数为 true 时,跳过「被当前块截断」的 URL(留待下一块完整扫描)
function findUrls(d,truncateAtEnd){
  const r=[],dec=new TextDecoder('utf-8')
  for(let i=0;i<d.length-4;i++){
    if(d[i]!==0x68||d[i+1]!==0x74||d[i+2]!==0x74||d[i+3]!==0x70)continue // 'http'
    const s=(d[i+4]===0x73)?i+5:i+4 // 'https' 则再跳过 's'
    if(d[s]!==0x3a||d[s+1]!==0x2f||d[s+2]!==0x2f)continue // 必须是 '://'
    let j=s+3
    while(j<d.length&&isUrlChar(d[j]))j++
    if(j-s-3>12&&!(truncateAtEnd&&j>=d.length)){ // 过滤过短的碎片;块尾截断的留待下一块
      r.push({off:i,url:dec.decode(d.subarray(i,j))})
    }
    i=j-1
  }
  return r
}
// 根据 URL 扩展名判断资源类型
function catFor(url){
  const low=url.split('?')[0].split('#')[0].toLowerCase()
  for(const c in EXT_CATS)for(const e of EXT_CATS[c])if(low.endsWith(e))return c
  return 'other'
}
// 取 URL 的扩展名
function extOf(url){
  const p=url.split('?')[0].split('#')[0].match(/\.[a-z0-9]+$/i)
  return p?p[0]:''
}

const $=function(id){return document.getElementById(id)}
const topEl=$('top'),botEl=$('bot'),scEl=$('sc')
const fi=$('fi'),pb=$('pb'),pf=$('pf'),cl=$('cl')
const st=$('st'),dv=$('dv'),di=$('di'),do_=$('do'),dash=$('dash'),ts=$('ts')
let results=[],activeCats={video:1,image:1,other:1}
document.getElementById('sc').addEventListener('change',function(e){
    if(e.target.closest('.fl-lb')){
        var label=e.target.closest('.fl-lb')
        activeCats[label.dataset.c]=e.target.checked?1:0
        renderResults()
    }
})
// 复制按钮:事件委托,避免内联 onclick 的引号转义问题
document.getElementById('sc').addEventListener('click',function(e){
    var b=e.target.closest('.c')
    if(b&&b.dataset.url)cpy(b.dataset.url)
})
function renderResults(){
    if(!results.length){scEl.innerHTML='<div class="em" style="padding:30px;text-align:center;color:rgba(255,255,255,.15);font-size:.82rem">无结果</div>';return}
    var h='',groups={}
    for(var x=0;x<results.length;x++){var c=results[x].cat;if(!groups[c])groups[c]=[];groups[c].push(results[x])}
    var order=['video','image','other'],lbl={'video':'🎬 视频','image':'🖼️ 图片','other':'📄 其他'}
    for(var c=0;c<order.length;c++){
        if(!activeCats[order[c]])continue
        var items=groups[order[c]]
        if(!items||!items.length)continue
        h+='<div class="ch">'+lbl[order[c]]+'</div><div class="l">'
        for(var x=0;x<items.length;x++){
            var r=items[x]
            var u=r.url.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')
            var pv=''
            if(r.cat==='image')pv='<img src="'+u+'" loading="lazy" onerror="this.alt=\'❌\'">'
            else if(r.cat==='video')pv='<video src="'+u+'" muted loop preload="metadata" controls onerror="this.outerHTML=\'<span class=ph>❌</span>\'"></video>'
            else pv='<span class="ph">📄</span>'
            h+='<div class="it"><div class="pv">'+pv+'</div><div><a class="u" href="'+u+'" target="_blank">'+u+'</a><div class="f"><span class="t tg">'+r.ext+'</span><span class="t tc">'+r.cat+'</span><button class="c" data-url="'+u+'">📋 复制</button></div></div></div>'
        }
        h+='</div>'
    }
    function cb(c){return activeCats[c]?'checked':''}
    var flHtml='<div class="fl" id="fl"><label class="fl-lb" data-c="video"><input type="checkbox" '+cb('video')+'><span class="mk"></span> 🎬 视频</label><label class="fl-lb" data-c="image"><input type="checkbox" '+cb('image')+'><span class="mk"></span> 🖼️ 图片</label><label class="fl-lb" data-c="other"><input type="checkbox" '+cb('other')+'><span class="mk"></span> 📄 其他</label></div>'
    scEl.innerHTML=flHtml+(h||'<div class="em" style="padding:30px;text-align:center;color:rgba(255,255,255,.15);font-size:.82rem">无结果</div>')
}

var dz=document.getElementById('dz')
// 点击与拖拽
dz.addEventListener('click',function(){fi.click()})
dz.addEventListener('dragover',function(e){e.preventDefault();dz.classList.add('dragover')})
dz.addEventListener('dragleave',function(){dz.classList.remove('dragover')})
dz.addEventListener('drop',function(e){
    e.preventDefault();dz.classList.remove('dragover')
    if(e.dataTransfer.files.length){fi.files=e.dataTransfer.files;fi.dispatchEvent(new Event('change'))}
})
var dzText=document.querySelector('.dz-text')
fi.addEventListener('change',async function(e){
    const files=Array.from(e.target.files)
    if(!files.length)return
    dzText.style.opacity='0'
    setTimeout(function(){dzText.innerHTML='已选择 <strong>'+files[0].name+'</strong>';dzText.style.opacity='1'},250)
    dz.style.opacity='.4';dz.style.pointerEvents='none'
    pb.style.display='block'
    pf.style.width='0%'
    const found=[]
    try{
        const CHUNK=8*1024*1024,OVERLAP=64*1024 // 重叠窗口需大于任何真实 URL 长度,防止跨块截断丢 URL
        for(let i=0;i<files.length;i++){
            const f=files[i]
            const size=f.size
            let off=0
            while(off<size){
                const s=Math.max(0,off-OVERLAP)
                const e=Math.min(size,off+CHUNK)
                const buf=await f.slice(s,e).arrayBuffer()
                const d=new Uint8Array(buf)
                const urls=findUrls(d,e<size)
                for(const u of urls){
                    found.push({name:f.name,cat:catFor(u.url),ext:extOf(u.url),url:u.url})
                }
                pf.style.width=(100*((i+e/size)/files.length)).toFixed(1)+'%'
                off+=CHUNK
            }
        }
        const seen=new Set();results=[]
        for(const x of found){
            const k=x.url.replace(/\/+$/,'').split('?')[0]
            if(!seen.has(k)){seen.add(k);results.push(x)}
        }
        if(!results.length){
            st.textContent='❌ 未找到资源，换个文件试试'
            pb.style.display='none'
            dz.style.opacity="1";dz.style.pointerEvents="auto"
            return
        }
        // 更新仪表盘
        const vi=results.filter(function(x){return x.cat==='video'}).length
        const im=results.filter(function(x){return x.cat==='image'}).length
        const ot=results.length-vi-im
        dv.textContent=vi;di.textContent=im;do_.textContent=ot
        document.querySelectorAll('.di .d').forEach(function(d){d.className='d g'})
        renderResults()

        // 再执行动画展开
        topEl.className='top sm'
        botEl.className='bot on'
        pb.style.display='none'
        st.style.opacity='0'
        setTimeout(function(){st.innerHTML='✧ 发现 <span class="n">'+results.length+'</span> 个资源';st.style.opacity='1'},250)
        dash.style.opacity='1'

        dz.style.opacity="1";dz.style.pointerEvents="auto"
        cl.style.opacity='1';cl.style.visibility='visible'
    }catch(err){
        console.error(err)
        st.textContent='❌ '+err.message
        pb.style.display='none'
        dz.style.opacity="1";dz.style.pointerEvents="auto"
    }
})

cl.addEventListener('click',function(){
    fi.value=''
    // 重置仪表盘计数与圆点颜色
    dv.textContent='0';di.textContent='0';do_.textContent='0'
    document.querySelectorAll('.di .d').forEach(function(d){d.className='d'})
    cl.style.opacity='0';cl.style.visibility='hidden'
    var bi=document.querySelector('.bi')
    bi.classList.add('fade')
    dash.style.opacity='0'
    st.style.opacity='0';dzText.style.opacity='0'
    setTimeout(function(){
        st.innerHTML='✧ 选择 data_1 开始解析'
        dzText.innerHTML='选择或拖拽 <strong>data_1</strong> 文件'
        st.style.opacity='1';dzText.style.opacity='1'
        topEl.className='top'
        botEl.className='bot'
        scEl.innerHTML=''
        results=[]
        bi.classList.remove('fade')
        dz.style.opacity='1';dz.style.pointerEvents='auto'
    },550)
})

function cpy(u){
    navigator.clipboard.writeText(u).then(function(){t('✧ 已复制')})['catch'](function(){
        var e=document.createElement('textarea')
        e.value=u;document.body.appendChild(e);e.select()
        document.execCommand('copy');document.body.removeChild(e)
        t('✧ 已复制')
    })
}
function t(m){ts.textContent=m;ts.className='ts s';clearTimeout(ts._t);ts._t=setTimeout(function(){ts.className='ts'},1800)}

// 初始入场动画
(function(){
    var ct=document.getElementById('ct')
    if(ct){
        var children=ct.children
        for(var i=0;i<children.length;i++){
            if(children[i].id==='dash')continue
            children[i].classList.add('enter')
        }
    }
    topEl.classList.add('init')
    setTimeout(function(){topEl.classList.remove('init')},1500)
})();

// 生成星空
(function(){
    var el=document.getElementById('stars'),h=''
    var colors=['#fff','#f0f5ff','#ffe8cc','#e0f0ff','#fff5e6']
    for(var i=0;i<70;i++){
        var x=Math.random()*100,y=Math.random()*100,sz=.4+Math.random()*1.4
        var cls='s',ci=Math.floor(Math.random()*colors.length)
        if(Math.random()<.08){cls+=' bright';sz+=.4}
        else if(Math.random()<.2){cls+=' faint'}
        var glow=sz*5
        var o1=.1+Math.random()*.3,o2=.6+Math.random()*.4,o3=.15+Math.random()*.3
        var s1=.4+Math.random()*.4,s2=.8+Math.random()*.4,s3=.5+Math.random()*.4
        var r1=-15+Math.random()*30,r2=-5+Math.random()*10,r3=-10+Math.random()*20
        var dur=2+Math.random()*5,delay=Math.random()*6
        h+='<div class="'+cls+'" style="left:'+x+'%;top:'+y+'%;font-size:'+sz+'rem;color:'+colors[ci]+';--glow:'+glow+'px;--o1:'+o1+';--o2:'+o2+';--o3:'+o3+';--s1:'+s1+';--s2:'+s2+';--s3:'+s3+';--r1:'+r1+'deg;--r2:'+r2+'deg;--r3:'+r3+'deg;animation:shimmer '+dur+'s ease-in-out '+delay+'s infinite backwards">✦</div>'
    }
    el.innerHTML=h
    // 流星 - 同时生成1~3颗
    function spawnMeteor(){
        var m=document.createElement('div')
        m.className='meteor'
        // 多种方向来源
        var dirType=Math.floor(Math.random()*4)
        var x,y,angle,fromLeft
        if(dirType===0){
            x=Math.random()*18;y=Math.random()*25
            angle=5+Math.random()*50;fromLeft=true
        }else if(dirType===1){
            x=82+Math.random()*18;y=Math.random()*25
            angle=125+Math.random()*50;fromLeft=false
        }else if(dirType===2){
            x=Math.random()*6;y=5+Math.random()*70
            angle=-20+Math.random()*40;fromLeft=true
        }else{
            x=5+Math.random()*90;y=Math.random()*8
            angle=55+Math.random()*60;fromLeft=Math.random()>.5
        }
        var rad=angle*Math.PI/180
        var dist=300+Math.random()*400
        var tx=Math.cos(rad)*dist,ty=Math.sin(rad)*dist
        var dur=4+Math.random()*3
        var tailDir=fromLeft?'right':'left'
        if(dirType===3)dur*=1.3
        if(dirType===3&&Math.random()>.5){tailDir='bottom'}
        var star=document.createElement('span')
        star.className='s'
        star.textContent='✦'
        star.style.cssText='font-size:'+(10+Math.random()*6)+'px'
        m.appendChild(star)
        m.style.cssText='left:'+x+'%;top:'+y+'%;--tx:'+tx+'px;--ty:'+ty+'px;--dur:'+dur+'s'
        el.appendChild(m)
        setTimeout(function(){m.remove()},dur*1000+200)
    }
    // 定时生成流星
    spawnMeteor()
    setInterval(function(){
        var n=1+Math.floor(Math.random()*3) // 每次1~3颗
        for(var i=0;i<n;i++)setTimeout(spawnMeteor,i*400)
    },2000+Math.random()*3000)
})()
