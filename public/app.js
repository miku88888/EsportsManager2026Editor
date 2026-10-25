import {createLibraryUI} from './library.js';
import {createCalendarUI} from './calendar.js';
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>Number(v||0).toLocaleString('zh-CN');
const state={page:'Players',listPage:1,sort:'Skill',dir:'desc',search:'',filters:{},selected:new Set(),rid:null,focusRid:null,detailTab:'basic',draft:null,original:null,dirty:false,mediaType:'Players',mediaPage:1,mediaSearch:'',request:0};
let boot,toastTimer,searchTimer,mediaTimer;
async function api(p,data){const headers={'X-Editor-Workspace':boot?.workspace?.id||'main'};const r=await fetch('/api/'+p,data===undefined?{headers}:{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Editor-Token':boot.token},body:JSON.stringify(data)});const b=await r.json();if(!r.ok)throw Error(b.error||'操作失败');if(b.summary&&typeof b.summary.revision==='number')Object.assign(boot,b.summary);return b;}
const libraryUI=createLibraryUI({api,esc,toast,guard,fileBase64,chooseFile,heading,boot:()=>boot,refresh:async()=>{await refreshBoot();updateStatus();},changed:async page=>{state.dirty=false;state.rid=null;state.draft=null;resetRecordDialog();await refreshBoot();await navigate(page);}});
const calendarUI=createCalendarUI({api,esc,toast,heading,fileBase64,boot:()=>boot,refresh:refreshBoot,openExport:()=>navigate('export')});
function toast(message,error=false){const e=$('#toast');e.textContent=message;e.className='show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.className='',error?7000:4000);}
function pic(r,cls='portrait'){const label=r?.Nick||r?.Name||r?.CompanyName||'?';return r?._image?`<img class="${cls}" src="${esc(r._image)}" alt="${esc(label)}" title="${esc(r._imageSource||'')}" data-initials="${esc(label.slice(0,2))}" loading="lazy">`:`<span class="${cls} avatar-fallback">${esc(label.slice(0,2))}</span>`;}
function score(v){if(v==='')return '<span class="muted">—</span>';return `<span class="score ${+v<8?'low':+v<15?'mid':''}">${esc(v)}</span>`;}
function shell(){
 const nav=[['overview','▦','工作台'],...Object.entries(boot.tables).map(([n,t])=>[n,t.icon,t.label]),['calendar','▤','模组赛历'],['library','▣','数据库与图片'],['merge','⇄','两库合并 / 冲突'],['media','▧','图片资源'],['issues','⊙','数据检查'],['changes','≋','修改记录'],['export','↗','导出与使用'],['settings','⚙','设置']];
 queueMicrotask(()=>{const open=$('.sidebarbottom [data-action="open"]');if(open){open.dataset.nav='library';delete open.dataset.action;open.textContent='导入数据库 / 图片 · 切换副本';const append=document.createElement('button');append.className='small';append.dataset.action='merge-import';append.textContent='＋ 追加数据（新增 / 更新）';open.after(append);}const local=$('.localstatus');if(local)local.innerHTML='<span class="dot"></span><span id="workspace-label">'+esc(boot.workspace?.name||'本地工作副本')+'</span>';});
 $('#app').innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><div class="brandmark">EM</div><div><b>电竞经理<br>2026</b><span>DATABASE EDITOR</span></div></div><div class="navlabel">工作空间</div><nav>${nav.map(([n,i,l],idx)=>`${idx===1?'<div class="navlabel">数据库</div>':idx===7?'<div class="navlabel">工具</div>':''}<button class="navbutton ${state.page===n?'active':''}" data-nav="${n}"><span class="symbol">${i}</span>${l}${n==='calendar'?`<span class="count">${number(boot.calendar?.fixed2026||0)}</span>`:boot.counts[n]!==undefined?`<span class="count">${number(boot.counts[n])}</span>`:''}</button>`).join('')}</nav><div class="sidebarbottom"><div class="localstatus"><span class="dot"></span>本地工作副本</div><div>EMDB v${boot.formatVersion} · 原格式读写<br>数据仅保存在这台电脑</div><button class="small" data-action="open">打开 .emdb 文件</button></div></aside><main class="workspace"><header class="topbar"><div class="breadcrumbs">ESPORTS MANAGER 2026 <strong>/ 当前数据库</strong></div><div class="topactions"><span class="saved" id="saved">● 本地副本已保存</span><button class="small" id="undo" data-action="undo" ${!boot.undo?'disabled':''} title="${esc(boot.undo||'本次启动暂无修改')}">↶ 撤销</button><button class="small" id="redo" data-action="redo" ${!boot.redo?'disabled':''}>↷ 重做</button><button class="primary" data-nav="export">导出数据库 ↗</button></div></header><div id="main"></div></main></div>`;
}
function metrics(){return `<div class="metrics">${Object.entries(boot.tables).map(([n,t])=>`<div class="metric ${state.page===n?'selected':''}" data-nav="${n}" role="button" tabindex="0"><div><div class="label">${t.label}</div><div class="num">${number(boot.counts[n])}</div></div><span class="metricicon">${t.icon}</span></div>`).join('')}</div>`;}
function heading(title,subtitle,actions='',suffix=''){return `<div class="heading"><div><div class="eyebrow">ESPORTS MANAGER 2026 / LOCAL WORKSPACE</div><h1>${title}${suffix?`<span class="muted">${suffix}</span>`:''}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;}
function updateStatus(){
 const crumb=$('.breadcrumbs strong');if(crumb){crumb.textContent='/ '+(boot.workspace?.name||'当前数据库');crumb.title=boot.workFile||'';}
 const workspace=$('#workspace-label');if(workspace)workspace.textContent=(boot.workspace?.name||'本地工作副本')+(boot.workspace?.review?.pending?' · '+boot.workspace.review.pending+' 项待处理':'');
 $('#undo').disabled=!boot.undo;$('#redo').disabled=!boot.redo;$('#undo').title=boot.undo||'本次启动暂无修改';
 $('#saved').textContent=state.dirty?'● 表单尚未保存':'● 本地副本已保存';$('#saved').style.color=state.dirty?'#d8c27e':'';
 Object.keys(boot.counts).forEach(n=>{const e=$(`[data-nav="${n}"] .count`);if(e)e.textContent=number(boot.counts[n]);});
 const calendarCount=$('[data-nav="calendar"] .count');if(calendarCount)calendarCount.textContent=number(boot.calendar?.fixed2026||0);
}
function query(extra={}){return new URLSearchParams({table:state.page,page:state.listPage,sort:state.sort,dir:state.dir,search:state.search,...state.filters,...extra}).toString();}
function updateSortControls(){const select=$('#sort-select'),button=$('[data-action="sort-dir"]');if(select)select.value=state.sort;if(button){const label=state.sort==='CreatedAt'?(state.dir==='desc'?'最新在前 ↓':'最早在前 ↑'):(state.dir==='desc'?'↓':'↑');button.textContent=label;button.title=state.sort==='CreatedAt'?(state.dir==='desc'?'当前最新在前，点击切换为最早在前':'当前最早在前，点击切换为最新在前'):'切换排序方向';button.setAttribute('aria-label',state.sort==='CreatedAt'?label:'切换排序方向');}}
async function guard(){if(!state.dirty)return true;return ask('尚有未保存的表单修改','离开会放弃当前表单中的修改。也可以关闭此窗口，先保存当前记录。','放弃并继续');}
async function navigate(page){if(!await guard())return;resetRecordDialog();state.page=page;state.rid=null;state.focusRid=null;state.selected.clear();state.dirty=false;state.draft=null;state.detailTab='basic';state.listPage=1;state.search='';state.filters={};state.sort=page==='Players'?'Skill':boot.tables[page]?.display||'';state.dir=page==='Players'?'desc':'asc';shell();await renderPage();updateStatus();}
async function renderPage(){
 if(boot.tables[state.page])return renderEditor();
 if(state.page==='overview')return renderOverview();
 if(state.page==='media')return renderMedia();
 if(state.page==='calendar')return calendarUI.render();
 if(state.page==='issues')return renderIssues();
 if(state.page==='changes')return renderChanges();
 if(state.page==='export')return renderExport();
 if(state.page==='settings')return renderSettings();
 if(state.page==='library')return libraryUI.renderLibrary();
 if(state.page==='merge')return libraryUI.renderMerge();
}
async function renderEditor(){
 resetRecordDialog();
 document.body.dataset.editMode=boot.preferences?.editMode||'dialog';
 const t=boot.tables[state.page];
 if(!t.fields.some(f=>f.name===state.sort))state.sort=t.fields.some(f=>f.name==='Skill')?'Skill':t.key;
 const filterFields=['Country','Team','Role','Gender','Tier','Type'].filter(h=>t.fields.some(f=>f.name===h));
 $('#main').innerHTML=heading(`${t.label}数据库`,'筛选记录，编辑完整资料与属性。保存时自动更新工作副本。',`<button data-action="csv-menu">CSV 导入 / 导出</button><button data-action="add">＋ 新增${t.label}</button>`,`${number(boot.counts[state.page])} 条记录`)+metrics()+`<div class="editor-layout"><section class="listpane"><div class="toolbar"><div class="search"><span>⌕</span><input id="search" aria-label="搜索数据库" placeholder="搜索昵称、名字、ID、战队或任意字段…" value="${esc(state.search)}"></div><select id="sort-select" aria-label="排序字段">${t.fields.filter(f=>f.type!=='textarea').map(f=>`<option value="${esc(f.name)}" ${state.sort===f.name?'selected':''}>${esc(f.label)}</option>`).join('')}</select><button data-action="sort-dir" title="切换排序方向">${state.dir==='desc'?'↓':'↑'}</button></div><div class="filters"><span class="filterlabel">筛选</span>${filterFields.map(h=>{const f=t.fields.find(x=>x.name===h);let choices=f.choices||[...new Set(['MALE','FEMALE'])];if(h==='Team')choices=boot.tables.Teams.fields.find(x=>x.name==='Nick')?.choices||t.fields.find(x=>x.name==='Team').choices;return `<select data-filter="${h}" aria-label="筛选${esc(f.label)}"><option value="">全部${esc(f.label)}</option>${h==='Team'?'<option value="__empty">自由人员 / 无战队</option>':''}${choices.map(x=>`<option value="${esc(x)}" ${state.filters[h]===x?'selected':''}>${esc(x)}</option>`).join('')}</select>`;}).join('')}<label class="checkbox-label"><input type="checkbox" id="missing-image" ${state.filters.missingImage?'checked':''}>缺少图片</label><button class="ghost small" data-action="clear-filters">重置</button></div><div id="bulk"></div><div id="records"><div class="empty">正在读取…</div></div></section><aside class="detail" id="detail"><div class="empty">选择一条记录开始编辑</div></aside></div>`;
 const detail=$('#detail');if(dialogMode()){
  const dialog=$('#record-dialog');dialog.innerHTML='<div class="editor-closebar"><span>完整资料编辑</span><button class="ghost small" data-action="close-editor" aria-label="关闭记录编辑器">× 关闭</button></div>';dialog.append(detail);
 }
 const intro=$('.heading p');if(intro)intro.textContent=dialogMode()?'双击记录展开编辑；单击选中记录。导入只新增或更新同 ID 角色。':'单击记录，在右侧编辑完整资料。可在设置中切换为双击展开。';
 await loadRows(!dialogMode());
}
const columns={Players:['Country','Team','Skill','Potential','Role1'],Staff:['Country','Team','Role','Skill'],Teams:['Country','Rating','ERS','Academy'],Sponsors:['Tier','Type'],Tournaments:['Tier','Type','Country','Prizefund']};
async function loadRows(auto=false){
 updateSortControls();
 const current=++state.request,name=state.page;if(!boot.tables[name])return;
 const data=await api('rows?'+query());if(current!==state.request||state.page!==name)return;
 state.rows=data.rows;state.total=data.total;const t=boot.tables[name],cols=columns[name].filter(h=>t.fields.some(f=>f.name===h));
 $('#records').innerHTML=`<div class="tablewrap"><table><thead><tr><th><input type="checkbox" id="select-page" aria-label="选择本页全部记录" ${data.rows.length&&data.rows.every(r=>state.selected.has(r._rid))?'checked':''}></th><th data-sort="${t.display}">${t.label} ${state.sort===t.display?(state.dir==='asc'?'↑':'↓'):''}</th>${cols.map((h,i)=>`<th data-sort="${h}" class="${i>3?'tableextra':''}">${esc(t.fields.find(f=>f.name===h)?.label||h)} ${state.sort===h?(state.dir==='asc'?'↑':'↓'):''}</th>`).join('')}</tr></thead><tbody>${data.rows.map(r=>`<tr data-rid="${esc(r._rid)}" class="${state.rid===r._rid?'active':''}"><td><input type="checkbox" data-check="${esc(r._rid)}" aria-label="选择 ${esc(r[t.display])}" ${state.selected.has(r._rid)?'checked':''}></td><td><div class="personcell">${pic(r)}<div><b>${esc(r[t.display])}</b><small>${esc(name==='Players'||name==='Staff'?[r.Name,r.Surname].filter(Boolean).join(' '):name==='Teams'?r.Name:name==='Sponsors'?'#'+r.Num:r.City||r.id)}</small></div></div></td>${cols.map((h,i)=>`<td class="${i>3?'tableextra':''}">${['Skill','Potential','Rating'].includes(h)?score(r[h]):h==='Team'?`<span class="teamtag">${esc(r[h]||'自由人员')}</span>`:h.startsWith('Role')||h==='Tier'||h==='Type'?`<span class="role">${esc(r[h]||'—')}</span>`:h==='Earnings'||h==='Prizefund'?number(r[h]):`<span class="country">${esc(r[h]||'—')}</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table>${!data.rows.length?'<div class="empty">没有找到匹配记录。试试调整搜索或筛选条件。</div>':''}</div><div class="pagination"><span class="pageinfo">共 ${number(data.total)} 条 · 每页 50 条</span><button class="small" data-action="prev" ${state.listPage<=1?'disabled':''}>←</button><span>${state.listPage} / ${Math.max(1,Math.ceil(data.total/50))}</span><button class="small" data-action="next" ${state.listPage*50>=data.total?'disabled':''}>→</button><input id="jump-page" type="number" min="1" max="${Math.max(1,Math.ceil(data.total/50))}" placeholder="页码" aria-label="跳转页码" style="width:63px;padding:4px 6px"><button class="small" data-action="jump">跳转</button></div>`;
 document.querySelectorAll('tr[data-rid]').forEach(row=>{row.tabIndex=0;row.title=dialogMode()?'双击展开完整资料':'单击在侧边面板编辑';});
 renderBulk();if(auto&&data.rows.length&&!dialogMode()){await selectRecord(data.rows[0]._rid,false);}else markActive();
}
function dialogMode(){return (boot.preferences?.editMode||'dialog')==='dialog';}
function resetRecordDialog(){const d=$('#record-dialog');if(d?.open)d.close();d?.replaceChildren();}
async function closeRecordEditor(){if(!await guard())return;state.dirty=false;state.draft=null;state.rid=null;$('#record-dialog').close();updateStatus();markActive();}
function markActive(){document.querySelectorAll('tr[data-rid]').forEach(e=>e.classList.toggle('active',e.dataset.rid===(dialogMode()?state.focusRid:state.rid)));}
function renderBulk(){const el=$('#bulk');if(!el)return;el.innerHTML=state.selected.size?`<div class="bulkbar"><b>${state.selected.size} 条已选</b><button class="small" data-action="select-all">选中全部 ${number(state.total)} 条筛选结果</button><span class="spacer"></span><button class="small" data-action="export-selected">导出所选</button><button class="small" data-action="batch">批量修改</button><button class="danger small" data-action="delete-selected">删除</button><button class="ghost small" data-action="clear-selected">×</button></div>`:'';}
async function selectRecord(rid,check=true){if(check&&!await guard())return;const data=await api('record?'+new URLSearchParams({table:state.page,rid}));state.rid=rid;state.focusRid=rid;state.original={...data.record};state.draft={...data.record};state.detailData=data;state.dirty=false;renderDetail();if(dialogMode()&&!$('#record-dialog').open)$('#record-dialog').showModal();markActive();updateStatus();}
function sectionTitle(text){return `<div class="formsection">${text}</div>`;}
function renderField(f,options={}){
 const value=state.draft[f.name]??'', changed=value!==state.original[f.name],id=(options.prefix||'field')+'-'+f.name.replaceAll(' ','_'), attrs=`data-field="${esc(f.name)}" id="${esc(id)}" class="${changed?'changed':''}"`, choices=f.choices;
 let input;
 if(f.type==='textarea')input=`<textarea ${attrs} rows="5">${esc(value)}</textarea>`;
 else if(f.type==='boolean')input=`<select ${attrs}>${[['','留空（保留游戏默认）'],['1','是 · 1'],['0','否 · 0'],...(value&&!['0','1'].includes(value)?[[value,value]]:[])].map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${l}</option>`).join('')}</select>`;
 else if(f.type==='gender')input=`<select ${attrs}>${[['','留空'],['MALE','男性 · MALE'],['FEMALE','女性 · FEMALE']].map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${l}</option>`).join('')}</select>`;
 else input=`<input ${attrs} type="${f.type==='number'?'number':'text'}" ${f.type==='number'?'step="any"':''} value="${esc(value)}" ${choices?`list="options-${esc(f.name)}"`:''} ${f.name==='Birthdate'?'placeholder="DD.MM.YYYY"':''}>${choices?`<datalist id="options-${esc(f.name)}">${choices.map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist>`:''}`;
 return `<div class="field ${f.type==='textarea'||['PhotoUrl','HLTV','Liquipedia','Faceit','CreatedBy','CreatedAt'].includes(f.name)||options.full?'full':''}"><label for="${esc(id)}">${esc(f.label)}<small>${esc(f.name)}${f.key?' ◇':''}</small></label>${input}${f.name==='Birthdate'?'<div class="fieldhint">格式：09.11.2000（日.月.年）</div>':''}${f.name==='BgColor'?`<div class="fieldhint"><span style="display:inline-block;width:12px;height:12px;background:${/^#[a-f0-9]{6,8}$/i.test(value)?value:'#888'};border-radius:3px;vertical-align:middle"></span> #RRGGBB / #RRGGBBAA</div>`:''}</div>`;
}
function renderDetail(){
 const r=state.draft,t=boot.tables[state.page],f=t.fields,tab=state.detailTab,stats=f.filter(x=>x.attribute),hasRoster=state.page==='Teams';
 if(!r)return;
 queueMicrotask(()=>{
  if(state.rid!==r._rid)return;
  const hero=$('#detail .detailhero');if(!hero)return;
  const binding=document.createElement('div');binding.className='imagebinding';
  binding.innerHTML=`<span>头像绑定</span><code title="导入时按数据库 ID 自动命名">${esc(r._imageName||'未找到图片')}</code><small>${esc(r._imageSource||'本地无图，数据库也无可用图片链接')}</small><small>导入自动命名 · ID 更改时跟随</small>`;
  hero.lastElementChild.append(binding);
  const image=hero.querySelector('.detailphoto');image.style.cursor='pointer';image.title='点击更换头像，自动按 ID 命名';image.onclick=()=>imagePicker().catch(e=>toast(e.message,true));
  const button=$('#detail [data-action="choose-image"]');button.textContent='▧ 绑定 / 更换头像';
 });
 let content='';
 if(tab==='roster'&&hasRoster){
  const roster=state.detailData.roster||[];content=`<p class="muted" style="font-size:11px;margin-top:0">前 5 位作为首发顺序，其余列为替补。可使用 ↑ ↓ 调整，转会请修改选手的所属战队。</p>${roster.length?roster.map((p,i)=>`<div class="rosteritem"><span class="index">${i+1}</span><div class="personcell" data-open-player="${p._rid}">${pic(p)}<div><b>${esc(p.Nick)}</b><small>${esc(p.Role1||'未设置角色')} · ${esc(p.Skill||'—')}</small></div></div>${i>=5?'<span class="reserve">替补</span>':''}<button data-roster-index="${i}" data-move="-1" ${i===0?'disabled':''}>↑</button><button data-roster-index="${i}" data-move="1" ${i===roster.length-1?'disabled':''}>↓</button></div>`).join(''):'<div class="empty">此战队暂无选手</div>'}${sectionTitle('战队职员')} ${(state.detailData.staff||[]).map(p=>`<div class="rosteritem" data-open-staff="${p._rid}"><div class="personcell">${pic(p)}<div><b>${esc(p.Nick)}</b><small>${esc(p.Role)}</small></div></div></div>`).join('')||'<p class="muted">暂无职员</p>'}`;
 }else if(tab==='attributes'&&stats.length){
  content=sectionTitle('能力属性 · 空白值保持为空')+stats.map(x=>`<div class="attributerow"><label for="attr-${esc(x.name)}">${esc(x.label)} <small class="muted">${x.name==='PR'?' /100':''}</small></label><div class="attributebar"><span style="width:${Math.min(100,Math.max(0,+r[x.name]/(x.name==='PR'?100:20)*100))}%"></span></div><input type="number" id="attr-${esc(x.name)}" data-field="${esc(x.name)}" min="0" max="${x.name==='PR'?100:20}" step="1" value="${esc(r[x.name])}" class="${r[x.name]!==state.original[x.name]?'changed':''}"></div>`).join('')+'<p class="fieldhint">除 PR 使用 0–100 外，其余属性使用 0–20。原数据库中的留空值不会被自动填充。</p>';
 }else if(tab==='all')content=sectionTitle(`全部原始字段 · ${f.length} 列`)+`<div class="formgrid">${f.map(x=>renderField(x)).join('')}</div>`;
 else{
  const basic=f.filter(x=>!x.attribute&&!['Bio','Description','PhotoUrl','HLTV','Liquipedia','Faceit','CreatedBy','CreatedAt'].includes(x.name));
  const attr=f.filter(x=>['Skill','Potential','Rating'].includes(x.name));const links=f.filter(x=>['PhotoUrl','HLTV','Liquipedia','Faceit'].includes(x.name));const long=f.filter(x=>['Bio','Description'].includes(x.name));
  content=sectionTitle('基本资料')+`<div class="formgrid">${[...basic,...attr.filter(x=>!basic.includes(x))].map(x=>renderField(x)).join('')}</div>`+(long.length?sectionTitle('人物 / 组织介绍')+`<div class="formgrid">${long.map(x=>renderField(x)).join('')}</div>`:'')+(links.length?`<details style="margin-top:20px"><summary class="muted" style="cursor:pointer;font-size:11px">外部链接与图片 URL</summary><div class="formgrid" style="margin-top:15px">${links.map(x=>renderField(x)).join('')}</div></details>`:'');
 }
 $('#detail').innerHTML=`<div class="detail-inner"><div class="detailhero">${pic(r,'detailphoto')}<div><span class="pill">${esc(state.page==='Players'?r.Role1||'PLAYER':state.page==='Staff'?r.Role||'STAFF':t.label)}</span><h2>${esc(r[t.display])}</h2><div class="fullname">${esc(state.page==='Players'||state.page==='Staff'?[r.Name,r.Surname].join(' '):r.Name||r.Country||'')}</div><div class="id">ID / ${esc(r[t.key])}</div></div></div><div class="detailtools"><button class="small" data-action="choose-image">▧ 更换图片</button><button class="small ghost" data-action="clone">复制记录</button><button class="small ghost" data-action="delete-record">删除</button></div><div class="tabs"><button data-tab="basic" class="${tab==='basic'?'active':''}">基本资料</button>${stats.length?`<button data-tab="attributes" class="${tab==='attributes'?'active':''}">能力属性</button>`:''}${hasRoster?`<button data-tab="roster" class="${tab==='roster'?'active':''}">阵容 (${state.detailData.roster?.length||0})</button>`:''}<button data-tab="all" class="${tab==='all'?'active':''}">全部 ${f.length} 字段</button></div><div class="detailbody">${content}</div><div class="formerror" id="form-error"></div><div class="detailfooter"><small id="dirty-label">${state.dirty?'有未保存修改':'已保存到本地副本'}</small><button data-action="discard" class="small ghost" ${state.dirty?'':'disabled'}>还原表单</button><button class="primary" data-action="save" ${state.dirty?'':'disabled'}>保存修改</button></div></div>`;
}
async function saveRecord(){if(!state.dirty)return;try{const changes=Object.fromEntries(boot.tables[state.page].fields.filter(f=>state.draft[f.name]!==state.original[f.name]).map(f=>[f.name,state.draft[f.name]]));await api('update',{table:state.page,rid:state.rid,changes});state.dirty=false;await selectRecord(state.rid,false);await loadRows();toast('修改已保存，关联数据已同步更新');}catch(e){$('#form-error').textContent=e.message;toast(e.message,true);}}
function showModal(title,body,buttons=[]){const d=$('#modal');if(d.open)d.close();d.innerHTML=`<div class="modalhead"><h2>${esc(title)}</h2><button class="ghost small" data-close-modal>×</button></div><div class="modalbody">${body}</div>${buttons.length?`<div class="modalfooter">${buttons.map((b,i)=>`<button class="${b.primary?'primary':b.danger?'danger':''}" data-modal-button="${i}">${esc(b.label)}</button>`).join('')}</div>`:''}`;d.showModal();d.querySelector('[data-close-modal]').onclick=()=>d.close();d.querySelectorAll('[data-modal-button]').forEach(e=>e.onclick=async()=>{try{await buttons[+e.dataset.modalButton].fn();}catch(err){let box=d.querySelector('.errorbox');if(!box){box=document.createElement('div');box.className='errorbox';d.querySelector('.modalbody').append(box);}box.textContent=err.message;}});return d;}
function ask(title,message,label='继续'){return new Promise(resolve=>{const d=showModal(title,`<p>${esc(message)}</p>`,[{label:'取消',fn:()=>d.close()},{label,primary:true,fn:()=>{resolve(true);d.close();}}]);d.addEventListener('close',()=>resolve(false),{once:true});});}
function chooseFile(accept,onFile,onCancel){const el=document.createElement('input');el.type='file';el.hidden=true;el.accept=accept;([...document.querySelectorAll('dialog[open]')].at(-1)||document.body).append(el);el.onchange=async()=>{try{if(el.files[0])await onFile(el.files[0]);else onCancel?.();}catch(e){toast(e.message,true);}finally{el.remove();}};el.oncancel=()=>{el.remove();onCancel?.();};el.click();}
async function fileBase64(file){return new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(String(f.result).split(',')[1]);f.onerror=reject;f.readAsDataURL(file);});}
async function newRecord(clone=false){
 if(!await guard())return;
 const t=boot.tables[state.page],key=t.key,from=clone?state.original:null;
 const needed=[key,...[t.display,'Name','Surname','Country','Team','Role','Role1','Skill','Potential','Gender','Tier','Type'].filter(h=>h!==key&&t.fields.some(f=>f.name===h))].filter((x,i,a)=>a.indexOf(x)===i);
 const defaults=from?Object.fromEntries(t.fields.map(f=>[f.name,from[f.name]])):{};
 if(from){defaults[key]+='_copy';if(t.display!==key)defaults[t.display]+=' 副本';}
 const oldDraft=state.draft,oldOriginal=state.original;state.draft=defaults;state.original={};
 const form=needed.map(h=>renderField(t.fields.find(x=>x.name===h),{prefix:'new-record'})).join('');state.draft=oldDraft;state.original=oldOriginal;
 const d=showModal(`${clone?'复制':'新增'}${t.label}`,`<p>唯一 ID 必须与其他记录不同。其余字段可在创建后继续编辑。</p><div class="formgrid">${form}</div>`,[{label:'取消',fn:()=>d.close()},{label:'创建记录',primary:true,fn:async()=>{const values=Object.fromEntries([...d.querySelectorAll('[data-field]')].map(e=>[e.dataset.field,e.value]));const result=await api('add',{table:state.page,values,cloneRid:clone?state.rid:null});d.close();await loadRows();await selectRecord(result.rid,false);toast('记录已创建');}}]);
}
async function deleteRecords(rids){if(!rids.length)return;if(!await ask(`删除 ${rids.length} 条${boot.tables[state.page].label}`,state.page==='Teams'?'删除战队会将所属选手和职员设为自由人员，并清理青训、阵容引用。可在本次运行中撤销。':'删除记录会同时清理对应阵容、首发指挥引用。可在本次运行中撤销。','删除所选记录'))return;await api('delete',{table:state.page,rids});state.selected.clear();state.dirty=false;if(rids.includes(state.rid)){state.rid=null;state.draft=null;$('#detail').innerHTML='<div class="empty">记录已删除</div>';}await loadRows(!state.rid);updateStatus();toast('记录已删除，可使用撤销恢复');}
function batchDialog(){const t=boot.tables[state.page];const d=showModal('批量修改',`<p>将修改当前选中的 <b class="accent">${state.selected.size}</b> 条记录。操作一次生效，可撤销。</p><label class="muted">修改字段</label><select id="batch-field">${t.fields.filter(f=>!f.key).map(f=>`<option value="${esc(f.name)}">${esc(f.label)} · ${esc(f.name)}</option>`).join('')}</select><label class="muted">操作方式</label><select id="batch-mode"><option value="set">设置为（空值会清空字段）</option><option value="add">数值增加（支持负数）</option><option value="multiply">数值乘以</option></select><label class="muted">值</label><input id="batch-value" placeholder="输入新值或数值"><div class="fieldhint">日期使用 DD.MM.YYYY；战队填写数据库里的战队昵称；属性遵守原范围。</div>`,[{label:'取消',fn:()=>d.close()},{label:'应用批量修改',primary:true,fn:async()=>{await api('batch',{table:state.page,rids:[...state.selected],field:$('#batch-field').value,mode:$('#batch-mode').value,value:$('#batch-value').value});d.close();state.dirty=false;if(state.rid)await selectRecord(state.rid,false);await loadRows();toast('批量修改已保存');}}]);}
function csvMenu(){
 const t=boot.tables[state.page];const d=showModal(`${t.label} · 导入与导出`,'<p>合并导入支持 EMDB、CSV 和 JSON。相同 ID 更新，新 ID 追加，文件里没出现的角色全部保留。CSV 可以只提供 ID 和需要修改的几列。</p>',[
  {label:'导出完整 CSV',fn:async()=>{const r=await api('export-csv',{table:state.page});d.close();window.location.assign(r.url);toast('CSV 已生成：'+r.path);}},
  {label:'合并导入…',primary:true,fn:async()=>{d.close();await mergeImportDialog();}}
 ]);
}
async function mergeImportDialog(){
 if(!await guard())return;
 const table=boot.tables[state.page]?state.page:'Players';
 const d=showModal('合并导入 · 新增 / 更新',`<div class="notice blue">未导入的记录全部保留。相同唯一 ID 覆盖更新，新 ID 额外增加。导入前会显示预览，并备份工作副本。</div><p>支持 .emdb、分号分隔 CSV、JSON 记录包。EMDB 会自动识别数据表；CSV 和单表 JSON 使用下面的目标表。</p><label for="import-target" class="muted">CSV / 单表 JSON 目标数据表</label><select id="import-target">${Object.entries(boot.tables).map(([n,t])=>`<option value="${n}" ${n===table?'selected':''}>${t.label} · 按 ${t.key} 匹配</option>`).join('')}</select><p class="muted">同名但 ID 不同会作为不同角色；仅凭昵称不覆盖，避免同名选手被误合并。</p>`,[
  {label:'取消',fn:()=>d.close()},
  {label:'选择导入文件',primary:true,fn:()=>{const target=$('#import-target').value;chooseFile('.emdb,.csv,.json',async file=>{
   const format=file.name.split('.').at(-1).toLowerCase();if(!['emdb','csv','json'].includes(format))throw Error('请选择 .emdb、.csv 或 .json 文件');
   const payload={format,table:target,overwriteEmpty:false};if(format==='emdb')payload.base64=await fileBase64(file);else payload.text=await file.text();
   await importPreview(payload,file.name);
  });}}
 ]);
}
async function importPreview(payload,filename){
 const preview=await api('import-preview',payload),labels={added:'新增',updated:'更新',unchanged:'保持不变'};
 const selected=payload.tables||Object.keys(preview.available);
 const d=showModal('确认合并导入',`<p class="import-filename">${esc(filename)}</p><div class="import-summary"><span><b>${preview.totals.added}</b> 新增</span><span><b>${preview.totals.updated}</b> 更新</span><span><b>${preview.totals.unchanged}</b> 相同记录</span></div><div class="notice blue">其余记录保持原样。缺少的字段不会被清空；新增或转会的选手会同步更新阵容关联。</div><div class="import-tables">${Object.entries(preview.available).map(([n,count])=>`<label><input type="checkbox" data-import-table="${n}" ${selected.includes(n)?'checked':''}>${boot.tables[n].label} <span class="muted">${count} 条</span></label>`).join('')}</div><label class="checkbox-label" style="margin:16px 0"><input id="import-empty" type="checkbox" ${payload.overwriteEmpty?'checked':''}>导入文件中的空白值也覆盖旧值（可清空字段）</label>${preview.errors.length?`<div class="errorbox">${preview.errors.slice(0,12).map(e=>`${esc(boot.tables[e.table].label)} / ${esc(e.id||'空 ID')}：${esc(e.message)}`).join('<br>')}</div>`:''}<div class="import-records">${preview.records.slice(0,40).map(r=>`<div><span class="import-kind ${r.kind}">${labels[r.kind]}</span><b>${esc(r.label)}</b><small>${esc(r.id)} · ${boot.tables[r.table].label}${r.kind==='updated'?' · '+r.fields.length+' 个字段':''}</small></div>`).join('')||'<p class="muted">请选择至少一张数据表。</p>'}</div>${preview.totals.total>40?'<p class="fieldhint">预览展示前 40 条，导入会处理所选表的全部记录。</p>':''}`, [
  {label:'取消',fn:()=>d.close()},
  {label:`合并导入 ${preview.totals.total} 条`,primary:true,fn:async()=>{
   if(preview.errors.length||!selected.length)throw Error('请先修复导入错误或选择数据表');
   const result=await api('import-merge',{...payload,expectedRevision:preview.revision});d.close();state.dirty=false;state.rid=null;state.selected.clear();resetRecordDialog();await refreshBoot();shell();await renderPage();toast(`合并完成：新增 ${result.added}，更新 ${result.updated}，其余记录保留`);
  }}
 ]);
 const commit=d.querySelector('.modalfooter .primary');commit.disabled=preview.errors.length>0||!selected.length;
 const revise=async()=>{const tables=[...d.querySelectorAll('[data-import-table]:checked')].map(e=>e.dataset.importTable),overwriteEmpty=$('#import-empty').checked;await importPreview({...payload,tables,overwriteEmpty},filename);};
 d.querySelectorAll('[data-import-table],#import-empty').forEach(el=>el.onchange=()=>revise().catch(e=>toast(e.message,true)));
}
function renderSettings(){
 const p=boot.preferences||{};
 queueMicrotask(()=>{const advanced=$('.advanced-settings');if(advanced)advanced.innerHTML='<summary>数据库与图片工作副本</summary><p class="muted">导入 EMDB 并配上图片库，建立独立副本；可随时切回已有副本，也可选择两库合并后逐项处理冲突。</p><button data-nav="library">导入数据库 / 图片与切换副本</button> <button data-nav="merge">两库合并与冲突处理</button>';});
 $('#main').innerHTML=heading('设置','选择编辑方式与头像来源，设置保存在本地项目中。')+`<div class="pagecontent settings-page"><div class="card"><h3>打开选手 / 记录的方式</h3><label class="setting-option"><input type="radio" name="edit-mode" value="dialog" ${p.editMode!=='sidebar'?'checked':''}><span><b>双击展开完整资料（默认）</b><small>列表使用完整宽度，双击记录后在中央大窗口编辑。</small></span></label><label class="setting-option"><input type="radio" name="edit-mode" value="sidebar" ${p.editMode==='sidebar'?'checked':''}><span><b>单击 + 侧边面板（原版）</b><small>保留上一版的右侧编辑面板。</small></span></label></div><div class="card"><h3>图片来源与优先级</h3><label class="setting-option"><span><b>同 ID 图片首选来源</b><small>手动替换的图片始终保留；其余同 ID 图片按首选包读取，适用于选手、职员、战队和赛事。</small><select id="setting-image-priority"><option value="" ${!p.preferredImageSource?'selected':''}>当前副本固定绑定优先</option>${[{id:'world',name:'初始配套图片库'},...(boot.imageSources||[])].map(r=>`<option value="${esc(r.id)}" ${p.preferredImageSource===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></span></label><label class="setting-option"><input type="checkbox" id="setting-other-images" ${p.otherImagePacks?'checked':''}><span><b>读取其他已订阅图片包</b><small>本项目绑定 → 游戏 CustomAssets → 初始配套图片 → 其他创意工坊图片包。</small></span></label><label class="setting-option"><input type="checkbox" id="setting-remote-photos" ${p.remotePhotos?'checked':''}><span><b>本地无图时，使用数据库 PhotoUrl 补全</b><small>仅在显示图片时联网获取，并缓存到本机。图片站点失效时显示昵称缩写。</small></span></label><button class="small" data-action="refresh-images">重新扫描图片目录</button><details style="margin-top:15px"><summary class="muted">查看已连接图片目录</summary>${(boot.imageRoots||[]).map(r=>`<div class="pathrow"><span class="muted">${esc(r.source)}</span><code>${esc(r.path)}</code></div>`).join('')}</details></div><button class="primary" data-action="save-settings">保存设置</button><details class="card advanced-settings"><summary>高级：整体切换数据库</summary><p class="muted">下面的功能会把工作副本整体切换为另一个完整数据库。添加几个角色请使用“合并导入”。操作前会备份当前副本。</p><button data-action="open">选择完整 .emdb 整体替换…</button></details></div>`;
}
async function saveSettings(){
 await api('preferences',{editMode:$('input[name="edit-mode"]:checked').value,otherImagePacks:$('#setting-other-images').checked,remotePhotos:$('#setting-remote-photos').checked,preferredImageSource:$('#setting-image-priority').value});toast('设置已保存，下次打开数据表立即生效');renderSettings();
}
async function refreshBoot(){const b=await api('bootstrap');boot=b;updateStatus();}
async function renderOverview(){
 const total=Object.values(boot.counts).reduce((a,b)=>a+b,0),images=Object.values(boot.coverage).reduce((a,b)=>a+b.assets,0);
 $('#main').innerHTML=heading('你的数据库工作台','编辑已导入的数据库，将每一次改动保存成可被游戏读取的文件。',`<button data-nav="Players">开始编辑选手 →</button>`)+metrics()+`<div class="pagecontent"><div class="twocol"><div class="card"><h3>已连接 · ${esc(boot.workspace?.name||'当前数据库')}</h3><div style="display:flex;gap:45px;margin:20px 0 10px"><div><div class="large-label">${number(total)}</div><span class="muted">数据记录</span></div><div><div class="large-label">${number(images)}</div><span class="muted">本地配套图片</span></div><div><div class="large-label">${Object.values(boot.tables).reduce((sum,t)=>sum+t.fields.length,0)}</div><span class="muted">原始字段</span></div></div><div class="pathrow"><span class="muted">原始数据库</span><code>${esc(boot.source)}</code><button class="small ghost" data-reveal="${esc(boot.source)}">在资源管理器中显示 ↗</button></div><div class="pathrow"><span class="muted">初始配套图片</span><code>${esc(boot.imageRoot)}</code><button class="small ghost" data-reveal="${esc(boot.imageRoot)}">查看图片目录 ↗</button></div><div class="pathrow"><span class="muted">自动保存的工作副本</span><code>${esc(boot.workFile)}</code><button class="small ghost" data-reveal="${esc(boot.workFile)}">查看工作副本 ↗</button></div><div class="pathrow"><span class="muted">原数据库备份</span><code>${esc(boot.backup)}</code></div></div><div><div class="card"><h3>配套图片匹配情况</h3><p class="muted" style="font-size:11px">按游戏 ID 匹配本地图片，缺图记录仍可正常编辑。</p>${Object.entries(boot.coverage).map(([n,c])=>`<div class="coverage"><span>${boot.tables[n].label}</span><div class="bar"><span style="width:${c.matched/c.total*100}%"></span></div><span class="num">${c.matched} / ${c.total}</span></div>`).join('')}<button class="small" data-nav="media">浏览图片资源 →</button></div><div class="card" style="margin-top:18px"><h3>游戏当前使用的创意工坊库</h3><p class="accent">${esc(boot.activeDatabase?.title||'未发现启用记录')}</p><p class="muted" style="font-size:12px">这里显示游戏保存的启用记录。编辑完成后，在游戏数据库页面导入你导出的 .emdb，再新建生涯使用。</p><button class="small" data-nav="export">导出和使用说明 →</button></div></div></div></div>`;
}
async function renderMedia(){
 $('#main').innerHTML=heading('图片资源','真实名与游戏替代名自动对应。可将图片固定绑定到当前数据库 ID，手动更换的图片优先保留。',`<button class="primary" data-action="repair-image-bindings">修复图片 ID 绑定</button>`)+`<div class="pagecontent"><div id="image-repair-result"></div><div class="gallery-toolbar"><select id="media-type">${Object.entries(boot.tables).map(([n,t])=>`<option value="${n}" ${state.mediaType===n?'selected':''}>${t.label}图片</option>`).join('')}</select><div class="search"><span>⌕</span><input id="media-search" aria-label="搜索图片" placeholder="搜索图片文件名…" value="${esc(state.mediaSearch)}"></div><span class="muted" id="media-total"></span></div><div class="gallery" id="gallery"></div><div class="pagination" id="media-pages"></div></div>`;await loadMedia();
}
async function loadMedia(){const data=await api('media?'+new URLSearchParams({table:state.mediaType,page:state.mediaPage,search:state.mediaSearch}));$('#media-total').textContent=data.total+' 张图片';$('#gallery').innerHTML=data.images.map(x=>`<div class="imagecard" data-preview="${esc(x.url)}" data-filename="${esc(x.name)}"><img src="${esc(x.url)}" alt="${esc(x.name)}" loading="lazy"><div class="filename">${esc(x.name)}</div>${x.custom?'<span class="badgetiny">本地自定义</span>':''}</div>`).join('')||'<div class="empty">没有匹配的图片</div>';$('#media-pages').innerHTML=`<span class="pageinfo">按 ID 命名 · PNG / JPG / WEBP</span><button data-action="media-prev" ${state.mediaPage===1?'disabled':''}>←</button><span>${state.mediaPage} / ${Math.max(1,Math.ceil(data.total/60))}</span><button data-action="media-next" ${state.mediaPage*60>=data.total?'disabled':''}>→</button>`;}
async function imagePicker(){
 if(!await guard())return;let page=1,search='';const name=state.page,rid=state.rid;
 const d=showModal('更换配套图片',`<p>为 <b class="accent">${esc(state.original[boot.tables[name].display])}</b> 选择新头像，已有头像也会被替换。程序自动按当前记录的游戏 ID 命名，导出完整游戏包时一起打包。</p><button id="upload-image">上传本地图片（PNG / JPG / WEBP）</button><div class="fieldhint">支持最多 12 MB。选定后立即保存并显示，无需再点“保存修改”。</div><div class="search" style="margin-top:17px"><span>⌕</span><input id="picker-search" placeholder="按文件名搜索配套图片…"></div><div id="picker-gallery" class="gallery"></div><div id="picker-pages" class="pagination"></div>`);
 const load=async()=>{const result=await api('media?'+new URLSearchParams({table:name,page,search}));if(!d.open)return;$('#picker-gallery').innerHTML=result.images.map(x=>`<div class="imagecard" data-assign="${esc(x.name)}"><img src="${esc(x.url)}" alt="${esc(x.name)}" loading="lazy"><div class="filename">${esc(x.name)}</div></div>`).join('');$('#picker-pages').innerHTML=`<span class="pageinfo">${result.total} 张 · ${page} / ${Math.max(1,Math.ceil(result.total/60))}</span><button id="picker-prev" ${page===1?'disabled':''}>←</button><button id="picker-next" ${page*60>=result.total?'disabled':''}>→</button>`;$('#picker-prev').onclick=()=>{page--;load().catch(e=>toast(e.message,true));};$('#picker-next').onclick=()=>{page++;load().catch(e=>toast(e.message,true));};d.querySelectorAll('[data-assign]').forEach(e=>e.onclick=async()=>{try{await api('image-assign',{table:name,rid,name:e.dataset.assign});d.close();await selectRecord(rid,false);await loadRows();toast('图片已关联，导出完整游戏包即可使用');}catch(e){toast(e.message,true);}});};
 $('#picker-search').oninput=e=>{search=e.target.value;page=1;clearTimeout(mediaTimer);mediaTimer=setTimeout(()=>load().catch(e=>toast(e.message,true)),200);};
 $('#upload-image').onclick=()=>chooseFile('.png,.jpg,.jpeg,.webp',async file=>{await api('image-upload',{table:name,rid,base64:await fileBase64(file)});d.close();await selectRecord(rid,false);await loadRows();toast('新头像已替换并保存');});
 await load();
}
async function renderIssues(){const data=await api('issues'),errors=data.issues.filter(x=>x.level==='error').length;$('#main').innerHTML=heading('数据检查',`共 ${data.issues.length} 项检查提示 · ${errors} 项阻止导出的 ID 错误。`)+`<div class="pagecontent"><div class="notice blue">检查结果包含订阅原库已有的问题。提示不会自动修改原数据；黄色提示可保留，红色唯一 ID 错误需要修复后导出。缺图情况可在各数据表使用“缺少图片”筛选查看。</div><div class="card">${data.issues.map(x=>`<div class="issue"><span class="warninglabel ${x.level}">${x.level==='error'?'错误':'提示'}</span><div class="issuebody"><b>${esc(x.label)} <span class="muted">· ${boot.tables[x.table].label}</span></b><p>${esc(x.message)}</p></div>${x.rid?`<button class="small" data-edit-table="${x.table}" data-edit-rid="${x.rid}">查看记录 →</button>`:''}</div>`).join('')||'<div class="empty">检查通过，未发现关联或 ID 问题。</div>'}</div></div>`;}
async function renderChanges(){const data=await api('diff');$('#main').innerHTML=heading('修改记录',`与当前订阅的 World Updated 原数据库对比 · ${data.changes.length} 条记录存在差异。`)+`<div class="pagecontent"><div class="notice blue">本页对比数据库字段。阵容顺序保存在 roster_order.json；自定义图片独立保存在项目 Images 目录。本次启动的操作支持最多 60 步撤销与重做，关闭程序后工作副本继续保留。</div><div class="twocol"><div class="card"><h3>数据库差异</h3>${data.changes.map(x=>`<div class="issue"><span class="warninglabel">${x.kind}</span><div class="issuebody"><b>${esc(x.label)} <span class="muted">· ${boot.tables[x.table].label}</span></b><div class="change-fields">${x.fields.map(f=>`<span title="${esc(f.before)} → ${esc(f.after)}">${esc(boot.tables[x.table].fields.find(z=>z.name===f.field)?.label||f.field)}: <del>${esc(f.before.slice(0,45)||'空')}</del> → <ins>${esc(f.after.slice(0,45)||'空')}</ins></span>`).join('')}</div></div>${x.rid?`<button class="small" data-edit-table="${x.table}" data-edit-rid="${x.rid}">编辑</button>`:''}</div>`).join('')||'<div class="empty">工作副本与原数据库字段一致。</div>'}</div><div class="card"><h3>本次启动的操作</h3>${boot.log.map(x=>`<div class="logitem"><span>${esc(x.label)}</span><time>${new Date(x.at).toLocaleTimeString('zh-CN')}</time></div>`).join('')||'<p class="muted">暂无操作</p>'}</div></div></div>`;}
async function renderExport(){
 queueMicrotask(()=>restoreModExport().catch(()=>{}));
 queueMicrotask(()=>{const review=boot.workspace?.review;if(review?.pending)$('#main .pagecontent')?.insertAdjacentHTML('afterbegin',`<div class="notice blue">当前合并副本还有 ${review.pending} 项待处理冲突。导出会使用当前合并结果，未处理项初始保留 A 值。<button class="small" data-nav="merge">继续处理冲突</button></div>`);});
 queueMicrotask(()=>{const paths=document.querySelectorAll('#main .pathrow code');if(paths[1]&&boot.customAssets)paths[1].textContent=boot.customAssets;});
 $('#main').innerHTML=heading('导出与使用','生成游戏原生 .emdb 数据库，或连同所有配套图片导出完整游戏包。')+`<div class="pagecontent"><div class="exportoptions"><div class="exportoption"><span class="pill">完整 BepInEx 整合包</span><h3>一键导出游戏同结构 ZIP</h3><p>以原模组和皮肤目录为底，带上当前数据库、图片优先级结果及完整赛历。解压后只需整体复制 BepInEx 文件夹。</p><button class="primary" data-action="export-mod" ${boot.integration?.configured?'':'disabled'}>导出完整整合包 ZIP ↗</button><div id="mod-export-state" role="status"></div></div><div class="exportoption"><span class="pill">NATIVE DATABASE</span><h3>导出 .emdb 数据库</h3><p>包含全部五张数据表、阵容顺序和原包附加文件。使用与游戏一致的 AES-GCM + ZIP 格式，保留 EMDB 版本。</p><button class="primary" data-action="export-db">导出 .emdb ↗</button></div><div class="exportoption"><span class="pill">DATABASE + IMAGES</span><h3>导出完整游戏包</h3><p>包含 .emdb、已识别的配套图片及本地替换图片，分别生成数据库包和图片包目录。</p><button class="primary" data-action="export-package">导出数据库 + 图片 ↗</button></div></div><div id="export-result"></div><div class="twocol" style="margin-top:22px"><div class="card"><h3>在游戏中使用</h3><div class="steps"><div class="step">保存编辑记录，点击上方导出按钮，得到 .emdb 文件路径。</div><div class="step">返回《电竞经理 2026》主菜单，打开数据库页面，使用导入数据库功能选择导出的 .emdb。</div><div class="step">使用修改后的数据库新建生涯。已有生涯含独立数据快照，不会随外部数据库自动更新。</div><div class="step">若更换了图片，导出完整游戏包。将 ImagesPack 内对应分类文件夹复制至游戏的 CustomAssets 目录，或使用游戏图片包功能。</div></div><div class="pathrow"><span class="muted">游戏当前记录启用</span><code>${esc(boot.activeDatabase?.title||'暂无记录')}</code></div><div class="pathrow"><span class="muted">游戏自定义图片目录</span><code>${esc(boot.customAssets)}</code></div></div><div class="card"><h3>保存和备份</h3><p class="muted">每次保存会重新校验生成的 EMDB，并使用临时文件原子替换工作副本。</p><div class="pathrow"><span class="muted">当前工作副本</span><code>${esc(boot.workFile)}</code><button class="small" data-reveal="${esc(boot.workFile)}">显示工作副本</button></div><div class="pathrow"><span class="muted">原始文件备份</span><code>${esc(boot.backup)}</code></div><p class="muted" style="font-size:11px;margin-top:20px">写回订阅目录可能被 Steam 更新覆盖。写回前会额外备份当时的原文件。</p><button class="danger small" data-action="overwrite">高级：写回原订阅数据库…</button></div></div></div>`;
}
async function exportFile(pack){
 const button=$(`[data-action="${pack?'export-package':'export-db'}"]`);button.disabled=true;button.textContent=pack?'正在复制图片与打包…':'正在生成…';
 try{const r=await api('export',{package:pack});$('#export-result').innerHTML=`<div class="card" style="margin-top:20px;border-color:#2b6654"><h3 class="accent">✓ 导出完成 · 已重新解码校验</h3><div class="resultpath">${esc(r.path)}</div><p class="muted" style="font-size:11px">数据库 ${number(r.size)} 字节 · ${r.warnings} 项数据检查提示 · SHA-256 ${esc(r.sha256)}</p><button data-copy="${esc(r.path)}">复制数据库路径</button> <button data-reveal="${esc(r.packagePath||r.path)}">在资源管理器显示 ↗</button>${r.url?` <button data-download="${esc(r.url)}">另存下载</button>`:''}${r.imagePath?`<div class="resultpath">图片包：${esc(r.imagePath)}</div>`:''}</div>`;toast('数据库已导出，可在游戏中导入');}
 finally{button.disabled=false;button.textContent=pack?'导出数据库 + 图片 ↗':'导出 .emdb ↗';}
}
let modExportJob=null;
async function restoreModExport(){const job=await api('mod-export-status'),node=$('#mod-export-state');if(!node)return;if(job.status==='complete')node.innerHTML=`<p class="accent">✓ 最近的整合包：${(job.result.size/1048576).toFixed(1)} MB</p><div class="resultpath">${esc(job.result.path)}</div><button data-download="${esc(job.result.url)}">下载一个 ZIP</button> <button data-reveal="${esc(job.result.path)}">查看导出文件</button>`;else if(job.status==='running'){modExportJob=job.id;node.textContent=`正在打包 ${job.completed} / ${job.total} 个文件；点击上方按钮查看进度。`;}}
async function exportModPackage(){
 const button=$('[data-action="export-mod"]');if(button)button.disabled=true;
 try{if(!modExportJob){const job=await api('export-mod',{});modExportJob=job.id;}
  for(;;){const job=await api('mod-export-status?id='+encodeURIComponent(modExportJob)),node=$('#mod-export-state');if(job.status==='error')throw Error(job.error);
   if(job.status==='complete'){if(node)node.innerHTML=`<p class="accent">✓ 整合包已完成 · ${job.result.files.toLocaleString('zh-CN')} 个文件 · ${(job.result.size/1048576).toFixed(1)} MB</p><div class="resultpath">${esc(job.result.path)}</div><button data-download="${esc(job.result.url)}">下载一个 ZIP</button> <button data-reveal="${esc(job.result.path)}">查看导出文件</button>`;toast('完整整合包已导出，整体复制 BepInEx 文件夹即可');modExportJob=null;break;}
   if(node)node.textContent=`正在打包 ${job.completed.toLocaleString('zh-CN')} / ${job.total.toLocaleString('zh-CN')} 个文件…`;await new Promise(resolve=>setTimeout(resolve,1200));
  }
 }catch(error){modExportJob=null;throw error;}finally{if(button?.isConnected)button.disabled=false;}
}
function overwriteDialog(){const filename=boot.source.split(/[\\/]/).at(-1);const d=showModal('写回原订阅数据库',`<p>将工作副本写入下面的原订阅文件。程序会先备份当前文件；Steam 后续更新可能再次覆盖它。</p><div class="resultpath">${esc(boot.source)}</div><label class="muted">输入文件名 <b>${esc(filename)}</b> 确认写回</label><input id="overwrite-confirm" autocomplete="off">`,[{label:'取消',fn:()=>d.close()},{label:'备份并写回',danger:true,fn:async()=>{const r=await api('overwrite-source',{confirm:$('#overwrite-confirm').value});d.close();toast('已写回，原文件备份于 '+r.backup);}}]);}
document.addEventListener('input',e=>{
 const el=e.target;
 if(el.dataset.field&&!el.closest('#modal')){
  state.draft[el.dataset.field]=el.value;state.dirty=boot.tables[state.page].fields.some(f=>state.draft[f.name]!==state.original[f.name]);el.classList.toggle('changed',el.value!==state.original[el.dataset.field]);
  const bar=el.closest('.attributerow')?.querySelector('.attributebar span');if(bar)bar.style.width=Math.min(100,Math.max(0,+el.value/(el.dataset.field==='PR'?100:20)*100))+'%';
  $('#dirty-label').textContent=state.dirty?'有未保存修改':'已保存到本地副本';$('[data-action="save"]').disabled=!state.dirty;$('[data-action="discard"]').disabled=!state.dirty;updateStatus();
 }
 if(el.id==='search'){state.search=el.value;state.listPage=1;clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadRows().catch(e=>toast(e.message,true)),220);}
 if(el.id==='media-search'){state.mediaSearch=el.value;state.mediaPage=1;clearTimeout(mediaTimer);mediaTimer=setTimeout(()=>loadMedia().catch(e=>toast(e.message,true)),220);}
});
document.addEventListener('change',async e=>{try{const el=e.target;if(el.dataset.filter){state.filters[el.dataset.filter]=el.value;state.listPage=1;await loadRows();}if(el.id==='missing-image'){state.filters.missingImage=el.checked?'1':'';state.listPage=1;await loadRows();}if(el.id==='sort-select'){state.sort=el.value;if(state.sort==='CreatedAt')state.dir='desc';state.listPage=1;await loadRows();}if(el.dataset.check){el.checked?state.selected.add(el.dataset.check):state.selected.delete(el.dataset.check);renderBulk();}if(el.id==='select-page'){state.rows.forEach(r=>el.checked?state.selected.add(r._rid):state.selected.delete(r._rid));await loadRows();}if(el.id==='media-type'){state.mediaType=el.value;state.mediaPage=1;await loadMedia();}}catch(err){toast(err.message,true);}});
document.addEventListener('click',async e=>{
 try{
  const el=e.target.closest('button,[data-nav],[data-rid],[data-sort],[data-preview],[data-reveal],[data-edit-table],[data-copy],[data-download],[data-open-player],[data-open-staff]');if(!el)return;
  if(e.target.closest('#modal'))return;
  if(el.dataset.nav)return await navigate(el.dataset.nav);
  if(el.dataset.tab){state.detailTab=el.dataset.tab;renderDetail();return;}
  if(el.dataset.check||e.target.matches('input'))return;
  if(el.dataset.sort){state.dir=state.sort===el.dataset.sort&&state.dir==='asc'?'desc':'asc';state.sort=el.dataset.sort;return await loadRows();}
  if(el.dataset.rid){if(dialogMode()){state.focusRid=el.dataset.rid;markActive();return;}return await selectRecord(el.dataset.rid);}
  if(el.dataset.reveal)return await api('reveal',{path:el.dataset.reveal});
  if(el.dataset.copy){await navigator.clipboard.writeText(el.dataset.copy);return toast('路径已复制');}
  if(el.dataset.download){window.location.assign(el.dataset.download);return;}
  if(el.dataset.editTable){const name=el.dataset.editTable,rid=el.dataset.editRid;await navigate(name);return await selectRecord(rid);}
  if(el.dataset.openPlayer){const rid=el.dataset.openPlayer;await navigate('Players');return await selectRecord(rid);}
  if(el.dataset.openStaff){const rid=el.dataset.openStaff;await navigate('Staff');return await selectRecord(rid);}
  if(el.dataset.preview){showModal(el.dataset.filename,`<img src="${esc(el.dataset.preview)}" style="max-width:100%;height:400px;display:block;margin:auto;object-fit:contain" alt="${esc(el.dataset.filename)}">`);return;}
  if(el.dataset.rosterIndex!==undefined){if(!await guard())return;const roster=state.detailData.roster.map(x=>x.Id),i=+el.dataset.rosterIndex,j=i+ +el.dataset.move;[roster[i],roster[j]]=[roster[j],roster[i]];await api('roster',{team:state.original.Nick,ids:roster});await selectRecord(state.rid,false);toast('阵容顺序已保存');return;}
  switch(el.dataset.action){
   case 'save':await saveRecord();break;
   case 'discard':state.draft={...state.original};state.dirty=false;renderDetail();updateStatus();break;
   case 'prev':state.listPage--;await loadRows();break;
   case 'next':state.listPage++;await loadRows();break;
   case 'jump':state.listPage=Math.min(Math.max(1,+$('#jump-page').value||1),Math.max(1,Math.ceil(state.total/50)));await loadRows();break;
   case 'sort-dir':state.dir=state.dir==='asc'?'desc':'asc';state.listPage=1;await loadRows();break;
   case 'clear-filters':if(await guard()){state.filters={};state.search='';state.listPage=1;state.dirty=false;await renderEditor();}break;
   case 'clear-selected':state.selected.clear();await loadRows();break;
   case 'select-all':{const d=await api('rows?'+query({ids:'1'}));state.selected=new Set(d.ids);await loadRows();break;}
   case 'batch':if(await guard())batchDialog();break;
   case 'delete-selected':if(await guard())await deleteRecords([...state.selected]);break;
   case 'delete-record':if(await guard()){await deleteRecords([state.rid]);if(dialogMode()&&!state.rid)$('#record-dialog').close();}break;
   case 'add':await newRecord();break;
   case 'clone':await newRecord(true);break;
   case 'csv-menu':csvMenu();break;
   case 'merge-import':await mergeImportDialog();break;
   case 'save-settings':await saveSettings();break;
   case 'refresh-images':await api('refresh-images',{});await refreshBoot();renderSettings();toast('已重新扫描全部图片来源');break;
   case 'repair-image-bindings':{el.disabled=true;el.textContent='正在修复图片绑定…';try{const r=await api('repair-image-bindings',{expectedRevision:boot.revision});await refreshBoot();await renderMedia();$('#image-repair-result').innerHTML=`<div class="notice blue">已按当前 ID 固定绑定 ${r.count} 张图片，保留 ${r.preserved} 个已有自定义绑定。${r.missing?`还有 ${r.missing} 条记录没有可用本地图，可通过 PhotoUrl 或手动上传补全。`:''}${r.errors.length?` ${r.errors.length} 条需检查文件名或图片内容。`:''}<br>${Object.entries(r.byTable).map(([n,count])=>`${esc(boot.tables[n].label)} ${count}`).join(' · ')}</div>`;toast('图片绑定已修复，手动修改的图片已保留');}finally{if(el.isConnected){el.disabled=false;el.textContent='修复图片 ID 绑定';}}break;}
   case 'close-editor':await closeRecordEditor();break;
   case 'export-selected':{const result=await api('export-selection',{table:state.page,rids:[...state.selected]});window.location.assign(result.url);toast(`已导出 ${result.count} 条记录，可合并导入其他工作副本`);break;}
   case 'choose-image':await imagePicker();break;
   case 'undo':case 'redo':if(await guard()){const r=await api(el.dataset.action,{});libraryUI.clearAutomaticResult();state.dirty=false;state.rid=null;await refreshBoot();await renderPage();toast((el.dataset.action==='undo'?'已撤销：':'已重做：')+r.label);}break;
   case 'media-prev':state.mediaPage--;await loadMedia();break;
   case 'media-next':state.mediaPage++;await loadMedia();break;
   case 'export-mod':await exportModPackage();break;
   case 'export-db':await exportFile(false);break;
   case 'export-package':await exportFile(true);break;
   case 'overwrite':overwriteDialog();break;
   case 'open':await navigate('library');break;
  }
  updateStatus();
 }catch(err){toast(err.message,true);}
});
document.addEventListener('keydown',async e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(state.dirty)await saveRecord();}if(e.key==='Enter'&&e.target.id==='jump-page')$('[data-action="jump"]').click();});
document.addEventListener('dblclick',async e=>{const row=e.target.closest('tr[data-rid]');if(!row||!dialogMode()||e.target.closest('input,button'))return;try{await selectRecord(row.dataset.rid);}catch(err){toast(err.message,true);}});
document.addEventListener('keydown',async e=>{const row=e.target.closest('tr[data-rid]');if(e.key==='Enter'&&row&&e.target===row&&dialogMode()){e.preventDefault();try{await selectRecord(row.dataset.rid);}catch(err){toast(err.message,true);}}});
$('#record-dialog').addEventListener('cancel',e=>{e.preventDefault();closeRecordEditor().catch(err=>toast(err.message,true));});
document.addEventListener('error',e=>{const img=e.target;if(img.tagName!=='IMG'||!img.dataset.initials)return;const fallback=document.createElement('span');fallback.className=img.className+' avatar-fallback';fallback.textContent=img.dataset.initials;fallback.title='图片站点不可用或链接已失效';img.replaceWith(fallback);},true);
window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
try{boot=await api('bootstrap');shell();await renderPage();}catch(err){$('#app').innerHTML=`<div class="empty"><h2>数据库打开失败</h2><p>${esc(err.message)}</p><p>检查 settings.json 路径，然后重启程序。</p></div>`;}
