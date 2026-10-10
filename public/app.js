import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {renderMarkdown,renderPlain} from './format.js';
const configResponse=await fetch('/api/config');const config=await configResponse.json();
if(!configResponse.ok||!config.supabaseUrl||!config.supabaseAnonKey){document.body.textContent='Setup required: configure Supabase environment variables in Netlify.';throw Error('Missing Supabase configuration')}
const supabase=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id),store='aihub-v1';let authenticated=false,busy=false,editingIndex=null,syncQueue=Promise.resolve(),pendingFiles=[];let usageAgg=[],usageError=null,usageLogWarn=false,currentUserId=null,userSettings={limits:{},plain:false},liveModels={},usageTimer=null,viewOverride=new WeakMap(),tokenScope=localStorage.getItem('aihub-token-scope')||'model';try{if(localStorage.getItem('aihub-plain')==='1')userSettings.plain=true}catch{};
let state;try{state=JSON.parse(localStorage.getItem(store))}catch{}if(!state||!Array.isArray(state.chats))state={chats:[],active:null,provider:'groq',models:{},theme:'dark',folders:[],activeFolder:null,crossChatMemory:false};
state.folders ||= [];state.activeFolder ??= null;state.crossChatMemory ||= false;state.categories ||= [{id:'general',name:'General',icon:'✦',color:'#5865f2',size:'large',shape:'rounded',folderId:null},{id:'gfx',name:'Graphics',icon:'🎨',color:'#c45be8',size:'medium',shape:'rounded',folderId:null},{id:'study',name:'Study',icon:'📚',color:'#2c9c91',size:'medium',shape:'rounded',folderId:null},{id:'research',name:'Research',icon:'🔎',color:'#d58a37',size:'medium',shape:'rounded',folderId:null},{id:'fav',name:'Favourites',icon:'★',color:'#d8a529',size:'small',shape:'pill',folderId:null},{id:'custom',name:'Custom',icon:'＋',color:'#697586',size:'small',shape:'square',folderId:null}];state.selectedItems ||= [];state.homeOrder ||= state.categories.map(c=>c.id);
const presets={
groq:['openai/gpt-oss-120b','openai/gpt-oss-20b','llama-3.3-70b-versatile','llama-3.1-8b-instant','qwen/qwen3.6-27b','groq/compound','groq/compound-mini'],
gemini:['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3-flash-preview','gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite'],
openrouter:['openrouter/free','nvidia/nemotron-3-ultra-550b-a55b:free','nvidia/nemotron-3-super-120b-a12b:free','nvidia/nemotron-3.5-lightning:free','thinkingmachines/inkling:free','thinkingmachines/inkling-small:free','poolside/laguna-s-2.1:free','poolside/laguna-xs-2.1:free','cohere/north-mini-code:free','google/gemma-4-31b-it:free','google/gemma-4-26b-a4b-it:free','qwen/qwen3.8-27b:free','apodex/apodex-1.1-mini:free','inclusionai/ling-3.1-flash','inclusionai/ling-3.0-flash-sante:free','dots-studio/dots-3-note-preview:free','liquid/lfm-2.5-2.6b:free','stealth/space-bunny-alpha'],
cerebras:['gpt-oss-120b','qwen-3.8-27b'],
openai:[]};
const knownLimits={'groq/llama-3.1-8b-instant':{day:500000},'groq/llama-3.3-70b-versatile':{day:100000},'groq/openai/gpt-oss-120b':{day:200000},'groq/openai/gpt-oss-20b':{day:200000},'groq/qwen/qwen3.6-27b':{day:200000},'cerebras/gpt-oss-120b':{day:1000000},'cerebras/qwen-3.8-27b':{day:1000000}};
function supportsImages(p,id){if(p==='gemini'||p==='openai')return true;if(p==='openrouter'){const lm=(liveModels.openrouter||[]).find(x=>x.id===id);return lm?lm.vision:(id==='openrouter/free'||/gemma-4/.test(id)?true:null)}return false}
const save=()=>localStorage.setItem(store,JSON.stringify({...state,chats:[]}));const current=()=>state.chats.find(c=>c.id===state.active);const folderName=id=>state.folders.find(f=>f.id===id)?.name||'Unfiled';
const aiToolCatalog=[
{cat:'Study & Learning',name:'Google Gemini',desc:'Explanations, revision plans and worked examples.',provider:'gemini',model:'gemini-3.8-flash',kind:'model'},
{cat:'Study & Learning',name:'ChatGPT',desc:'Open ChatGPT website. API access is separate from a ChatGPT subscription.',url:'https://chatgpt.com/',kind:'external'},
{cat:'Study & Learning',name:'Groq',desc:'Fast chat models for tutoring and practice questions.',provider:'groq',model:'openai/gpt-oss-120b',kind:'model'},
{cat:'Writing & Assignments',name:'Google Gemini',desc:'Drafting, rewriting, grammar and assignment planning.',provider:'gemini',model:'gemini-3.8-flash',kind:'model'},
{cat:'Writing & Assignments',name:'Mistral',desc:'Open Mistral chat website; API integration can be configured separately.',url:'https://chat.mistral.ai/',kind:'external'},
{cat:'Writing & Assignments',name:'Groq',desc:'Fast drafting, outlines and proofreading.',provider:'groq',model:'openai/gpt-oss-120b',kind:'model'},
{cat:'Research & Citations',name:'Perplexity',desc:'Web research with linked sources and citations.',url:'https://www.perplexity.ai/',kind:'external'},
{cat:'Research & Citations',name:'Google Gemini',desc:'Analyze provided sources and structure research notes.',provider:'gemini',model:'gemini-3.8-flash',kind:'model'},
{cat:'Research & Citations',name:'OpenRouter',desc:'Choose from available models through your OpenRouter key.',provider:'openrouter',model:'openrouter/free',kind:'model'},
{cat:'Lecture & Note-Taking',name:'Google Gemini',desc:'Turn supported text/PDF files into summaries and notes.',provider:'gemini',model:'gemini-3.8-flash',kind:'model'},
{cat:'Lecture & Note-Taking',name:'Groq',desc:'Convert transcripts into concise notes and revision points.',provider:'groq',model:'openai/gpt-oss-120b',kind:'model'},
{cat:'Coding & STEM',name:'Google Gemini',desc:'Explain code, solve STEM problems and inspect supported files.',provider:'gemini',model:'gemini-3.8-flash',kind:'model'},
{cat:'Coding & STEM',name:'GitHub Copilot',desc:'AI coding assistant for supported editors and GitHub workflows.',url:'https://github.com/features/copilot',kind:'external'},
{cat:'Coding & STEM',name:'Groq',desc:'Debug code, generate tests and explain algorithms.',provider:'groq',model:'openai/gpt-oss-120b',kind:'model'},
{cat:'Coding & STEM',name:'Cerebras',desc:'Very fast open-weight models on a free daily token allowance.',provider:'cerebras',model:'gpt-oss-120b',kind:'model'},
{cat:'Coding & STEM',name:'Mistral',desc:'Mistral coding assistant on its website.',url:'https://chat.mistral.ai/',kind:'external'},
{cat:'Presentations & Design',name:'Canva AI',desc:'Design presentations, graphics and visual assets.',url:'https://www.canva.com/',kind:'external'},
{cat:'Presentations & Design',name:'Gamma',desc:'Generate presentations and polished visual documents.',url:'https://gamma.app/',kind:'external'},
{cat:'Image Generation',name:'Google Gemini',desc:'Use Gemini for image-related prompts.',provider:'gemini',model:'gemini-3.8-flash',kind:'model'},
{cat:'Image Generation',name:'OpenRouter',desc:'Browse image-generation models.',url:'https://openrouter.ai/models?output_modalities=image',kind:'external'},
{cat:'Image Editing',name:'Clipdrop',desc:'Background removal, cleanup, relighting and image tools.',url:'https://clipdrop.co/',kind:'external'},
{cat:'Image Editing',name:'Neural.Love',desc:'AI image enhancement and creative image tools.',url:'https://neural.love/',kind:'external'},
{cat:'Video Editing',name:'Runway',desc:'AI video generation and editing tools.',url:'https://runwayml.com/',kind:'external'},
{cat:'Video Editing',name:'Google Gemini',desc:'Use Gemini for video understanding where supported.',provider:'gemini',model:'gemini-3.8-flash',kind:'model'}
];
function isSelected(type,id){return state.selectedItems.some(x=>x.type===type&&x.id===id)}
function toggleSelected(type,id){const i=state.selectedItems.findIndex(x=>x.type===type&&x.id===id);if(i>=0)state.selectedItems.splice(i,1);else state.selectedItems.push({type,id});save();sidebar()}
function updateBulkBar(){$('bulkBar').hidden=!state.selectedItems.length;$('selectionCount').textContent=state.selectedItems.length+' selected'}
async function moveChats(ids,folderId){for(const id of ids){const c=state.chats.find(x=>x.id===id);if(!c)continue;c.folder_id=folderId;await syncChat(c).catch(e=>alert(e.message))}state.selectedItems=[];save();render()}
$('bulkMove').onclick=()=>{const ids=state.selectedItems.filter(x=>x.type==='chat').map(x=>x.id);if(!ids.length)return alert('Select one or more chats to move.');const opts=['Unfiled',...state.folders.map(f=>f.name)];const v=prompt('Move selected chats to:\n'+opts.map((x,i)=>`${i}: ${x}`).join('\n'),'0');if(v===null)return;const n=Number(v);if(!Number.isInteger(n)||n<0||n>=opts.length)return alert('Invalid destination');moveChats(ids,n===0?null:state.folders[n-1].id)};
$('bulkDelete').onclick=async()=>{const ids=state.selectedItems.filter(x=>x.type==='chat').map(x=>x.id);const fids=state.selectedItems.filter(x=>x.type==='folder').map(x=>x.id);if(!ids.length&&!fids.length)return;if(!confirm(`Delete ${ids.length} chats and ${fids.length} folders?`))return;for(const id of ids){state.chats=state.chats.filter(c=>c.id!==id);await deleteCloudChat(id)}for(const id of fids){const f=state.folders.find(x=>x.id===id);if(f)await removeFolder(f)}if(ids.includes(state.active))state.active=state.chats[0]?.id||null;state.selectedItems=[];save();render()};$('clearSelection').onclick=()=>{state.selectedItems=[];save();sidebar()};
function renderHome(){const grid=$('categoryGrid');grid.replaceChildren();const ordered=[...state.categories].sort((a,b)=>state.homeOrder.indexOf(a.id)-state.homeOrder.indexOf(b.id));for(const cat of ordered){const tile=document.createElement('div');tile.className=`categoryTile size-${cat.size||'medium'} shape-${cat.shape||'rounded'}`;tile.style.setProperty('--tile-color',cat.color||'#5865f2');tile.draggable=true;tile.dataset.catId=cat.id;tile.innerHTML=`<span class="tileIcon"></span><strong></strong><span class="tileSub"></span><button class="tileEdit" title="Customize category">⋯</button>`;tile.querySelector('.tileIcon').textContent=cat.icon||'✦';tile.querySelector('strong').textContent=cat.name;tile.querySelector('.tileSub').textContent='Open workspace';tile.addEventListener('click',async e=>{if(e.target.closest('.tileEdit'))return;let f=state.folders.find(x=>x.id===cat.folderId);if(!f){const {data,error}=await supabase.from('chat_folders').insert({name:cat.name}).select('id,name,updated_at').single();if(error)return alert('Could not create workspace folder: '+error.message);f=data;state.folders.push(f);cat.folderId=f.id;save()}state.activeFolder=f.id;state.active=null;state.showHome=false;save();render()});tile.querySelector('.tileEdit').onclick=e=>{e.stopPropagation();editCategory(cat)};tile.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/aihub-category',cat.id);e.dataTransfer.effectAllowed='move'});tile.addEventListener('dragover',e=>{e.preventDefault();tile.classList.add('tileDrop')});tile.addEventListener('dragleave',()=>tile.classList.remove('tileDrop'));tile.addEventListener('drop',e=>{e.preventDefault();tile.classList.remove('tileDrop');const id=e.dataTransfer.getData('text/aihub-category');if(!id||id===cat.id)return;const from=state.homeOrder.indexOf(id),to=state.homeOrder.indexOf(cat.id);if(from<0||to<0)return;state.homeOrder.splice(from,1);state.homeOrder.splice(to,0,id);save();renderHome()});grid.append(tile)}
const cat=$('toolCatalog');cat.replaceChildren();for(const group of [...new Set(aiToolCatalog.map(x=>x.cat))]){const h=document.createElement('h3');h.textContent=group;h.className='catalogGroup';cat.append(h);const row=document.createElement('div');row.className='toolGrid';for(const item of aiToolCatalog.filter(x=>x.cat===group)){const card=document.createElement('article');card.className='toolCard';const title=document.createElement('strong');title.textContent=item.name;const desc=document.createElement('p');desc.textContent=item.desc;const badge=document.createElement('span');badge.className='toolKind';badge.textContent=item.kind==='model'?'In AI Hub · '+item.provider:'External website';const b=document.createElement('button');b.textContent=item.kind==='model'?'Use in chat ↗':'Open website ↗';b.onclick=()=>{if(item.kind==='model'){state.provider=item.provider;state.models[item.provider]=item.model;$('provider').value=item.provider;models();state.active=null;state.showHome=false;newChat()}else window.open(item.url,'_blank','noopener,noreferrer')};card.append(title,badge,desc,b);row.append(card)}cat.append(row)} }
let editingCategoryId=null;function editCategory(cat){editingCategoryId=cat?.id||null;$('categoryDialogTitle').textContent=cat?'Customize category':'Add category';$('categoryName').value=cat?.name||'';$('categoryIcon').value=cat?.icon||'✦';$('categoryColor').value=cat?.color||'#5865f2';$('categorySize').value=cat?.size||'medium';$('categoryShape').value=cat?.shape||'rounded';const sel=$('categoryFolder');sel.replaceChildren();const none=document.createElement('option');none.value='';none.textContent='Create a folder automatically';sel.append(none);for(const f of state.folders){const o=document.createElement('option');o.value=f.id;o.textContent=f.name;sel.append(o)}sel.value=cat?.folderId||'';$('deleteCategory').hidden=!cat;$('categoryDialog').showModal()}
$('addCategory').onclick=()=>editCategory(null);$('closeCategory').onclick=()=>$('categoryDialog').close();$('saveCategory').onclick=()=>{const name=$('categoryName').value.trim();if(!name)return alert('Enter a category name.');const old=state.categories.find(c=>c.id===editingCategoryId);const item={id:old?.id||crypto.randomUUID(),name,icon:$('categoryIcon').value.trim()||'✦',color:$('categoryColor').value,size:$('categorySize').value,shape:$('categoryShape').value,folderId:$('categoryFolder').value||null};if(old)Object.assign(old,item);else{state.categories.push(item);state.homeOrder.push(item.id)}save();$('categoryDialog').close();renderHome()};$('deleteCategory').onclick=()=>{if(!editingCategoryId)return;if(!confirm('Remove this home-screen category?'))return;state.categories=state.categories.filter(c=>c.id!==editingCategoryId);state.homeOrder=state.homeOrder.filter(id=>id!==editingCategoryId);save();$('categoryDialog').close();renderHome()};$('resetHome').onclick=()=>{if(!confirm('Reset home screen layout?'))return;state.categories=[{id:'general',name:'General',icon:'✦',color:'#5865f2',size:'large',shape:'rounded',folderId:null},{id:'gfx',name:'Graphics',icon:'🎨',color:'#c45be8',size:'medium',shape:'rounded',folderId:null},{id:'study',name:'Study',icon:'📚',color:'#2c9c91',size:'medium',shape:'rounded',folderId:null},{id:'research',name:'Research',icon:'🔎',color:'#d58a37',size:'medium',shape:'rounded',folderId:null},{id:'fav',name:'Favourites',icon:'★',color:'#d8a529',size:'small',shape:'pill',folderId:null},{id:'custom',name:'Custom',icon:'＋',color:'#697586',size:'small',shape:'square',folderId:null}];state.homeOrder=state.categories.map(c=>c.id);save();renderHome()};
for(const el of [$('scroll'),$('compose'),$('attachmentList')]){el.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();el.classList.add('fileDrop')}});el.addEventListener('dragleave',()=>el.classList.remove('fileDrop'));el.addEventListener('drop',async e=>{el.classList.remove('fileDrop');if(!e.dataTransfer.files?.length)return;e.preventDefault();for(const file of [...e.dataTransfer.files])await addPending(file)})}
async function showSession(){const {data:{user}}=await supabase.auth.getUser();authenticated=!!user;$('loginScreen').hidden=authenticated;$('app').hidden=!authenticated;if(authenticated){currentUserId=user.id;await loadCloud();await loadUserSettings();render();loadUsage();loadLiveModels();startUsagePolling()}return authenticated}$('loginForm').onsubmit=async e=>{e.preventDefault();const err=$('loginError');err.textContent='';const id=$('username').value.trim(),email=id.toLowerCase()===String(config.adminUsername).toLowerCase()?config.adminEmail:id;if(!email.includes('@')){err.textContent='Invalid login';return}const {error}=await supabase.auth.signInWithPassword({email,password:$('password').value});if(error){err.textContent='Invalid login';return}await showSession()};$('logout').onclick=async()=>{await supabase.auth.signOut();clearInterval(usageTimer);usageAgg=[];usageError=null;currentUserId=null;state.chats=[];state.folders=[];state.active=null;await showSession()};
async function loadCloud(){const [cr,fr]=await Promise.all([supabase.from('chats').select('id,title,messages,updated_at,folder_id').order('updated_at',{ascending:false}),supabase.from('chat_folders').select('id,name,updated_at').order('name')]);if(cr.error){alert('Could not load cloud history: '+cr.error.message);return}if(fr.error){alert('Could not load folders. '+fr.error.message);return}state.chats=cr.data||[];state.folders=fr.data||[];if(!state.chats.some(c=>c.id===state.active))state.active=state.chats[0]?.id||null;if(state.showHome===undefined)state.showHome=!state.active;if(state.activeFolder&&!state.folders.some(f=>f.id===state.activeFolder))state.activeFolder=null;save()}
function syncChat(chat){if(!authenticated)return Promise.resolve();const snapshot={id:chat.id,title:chat.title,messages:structuredClone(chat.messages),folder_id:chat.folder_id||null,updated_at:new Date().toISOString()};syncQueue=syncQueue.catch(()=>{}).then(async()=>{const {error}=await supabase.from('chats').upsert(snapshot);if(error)throw error});syncQueue.catch(e=>{$('status').textContent='Sync failed: '+e.message});return syncQueue}
async function deleteCloudChat(id){const {error}=await supabase.from('chats').delete().eq('id',id);if(error)alert('Cloud deletion failed: '+error.message)}
async function api(path,opts={}){const {data:{session}}=await supabase.auth.getSession();return fetch('/api/'+path,{...opts,headers:{...(opts.headers||{}),Authorization:'Bearer '+(session?.access_token||'')}})}
function modelOptions(p){const live=liveModels[p];const base=p==='openrouter'&&live?.length?live.map(m=>m.id):(presets[p]||[]);const sel=state.models[p];return [...new Set([...base,...(sel?[sel]:[])])]}
function models(){const p=$('provider').value;$('model').replaceChildren();const options=modelOptions(p);for(const id of options){const o=document.createElement('option');o.value=id;o.textContent=id+(supportsImages(p,id)===true?'  👁':'');$('model').append(o)}if(options.length)$('model').value=options.includes(state.models[p])?state.models[p]:options[0];updateUploadHint();renderTokenUsage()}
function button(label,title,fn,cls='mini'){const b=document.createElement('button');b.textContent=label;b.title=title;b.className=cls;b.onclick=fn;return b}
function sidebar(){const q=$('search').value.trim().toLowerCase(),scope=$('searchScope').value,active=current();$('folders').replaceChildren();const all=button('All chats', 'Show all chats',()=>{state.activeFolder=null;switchView('home');state.active=state.chats[0]?.id||null;save();render()},'folderrow'+(state.activeFolder===null&&state.showHome===false?' selected':''));$('folders').append(all);
for(const f of state.folders){const row=document.createElement('div');row.className='folderrow'+(state.activeFolder===f.id?' selected':'')+(isSelected('folder',f.id)?' multiSelected':'');row.draggable=true;row.dataset.itemType='folder';row.dataset.itemId=f.id;row.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/aihub-item',JSON.stringify({type:'folder',id:f.id}));e.dataTransfer.effectAllowed='move'});row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('dropTarget')});row.addEventListener('dragleave',()=>row.classList.remove('dropTarget'));row.addEventListener('drop',e=>{e.preventDefault();row.classList.remove('dropTarget');try{const d=JSON.parse(e.dataTransfer.getData('text/aihub-item'));if(d.type==='chat')moveChats([d.id],f.id);else if(d.type==='folder')alert('Folders cannot be nested.')}catch{}});row.addEventListener('click',e=>{if(e.ctrlKey||e.metaKey||e.shiftKey){e.preventDefault();toggleSelected('folder',f.id);}});const open=button('▸ '+f.name,'Open folder',()=>{state.activeFolder=f.id;switchView('home');state.active=state.chats.find(c=>c.folder_id===f.id)?.id||null;save();render()},'folderopen');const rename=button('✎','Rename folder',()=>renameFolder(f),'mini');const del=button('×','Delete folder',()=>removeFolder(f),'mini');row.append(open,rename,del);$('folders').append(row)}$('chats').replaceChildren();let list=state.chats.filter(c=>q&&scope==='all'?true:(state.activeFolder===null||c.folder_id===state.activeFolder));if(scope==='current')list=list.filter(c=>c.id===state.active);if(q)list=list.filter(c=>c.title.toLowerCase().includes(q)||c.messages.some(m=>String(m.content||'').toLowerCase().includes(q)));
for(const c of list){const row=document.createElement('div');row.className='chatrow'+(c.id===state.active?' active':'')+(isSelected('chat',c.id)?' selected':'');row.draggable=true;row.dataset.itemType='chat';row.dataset.itemId=c.id;row.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/aihub-item',JSON.stringify({type:'chat',id:c.id}));e.dataTransfer.effectAllowed='move'});row.addEventListener('click',e=>{if(e.ctrlKey||e.metaKey||e.shiftKey){e.preventDefault();toggleSelected('chat',c.id);return}});const open=button(c.title,'Open chat',()=>{state.active=c.id;switchView('chat');save();render();$('sidebar').classList.remove('show')},'openchat');const menu=button('⋯','Chat options',()=>chatOptions(c),'mini');row.append(open,menu);$('chats').append(row)}if(!list.length){const empty=document.createElement('p');empty.className='muted small';empty.textContent=q?'No matching chats or messages.':'No chats in this view.';$('chats').append(empty)}updateBulkBar()}
function chatOptions(c){const action=prompt('Type an action: rename, move, delete');if(!action)return;if(action.toLowerCase()==='rename'){const title=prompt('New chat title',c.title)?.trim();if(title){c.title=title;syncChat(c).then(()=>{save();render()})}}else if(action.toLowerCase()==='move'){const options=['Unfiled',...state.folders.map(f=>f.name)];const choice=prompt('Move to folder:\n'+options.map((x,i)=>`${i}: ${x}`).join('\n'),'0');if(choice===null)return;const n=Number(choice);if(!Number.isInteger(n)||n<0||n>=options.length)return alert('Invalid folder');c.folder_id=n===0?null:state.folders[n-1].id;syncChat(c).then(()=>{save();render()})}else if(action.toLowerCase()==='delete'&&confirm('Permanently delete this chat?')){state.chats=state.chats.filter(x=>x.id!==c.id);if(state.active===c.id)state.active=state.chats[0]?.id||null;save();render();deleteCloudChat(c.id)}}
async function renameFolder(f){const name=prompt('Rename folder',f.name)?.trim();if(!name||name===f.name)return;const {error}=await supabase.from('chat_folders').update({name,updated_at:new Date().toISOString()}).eq('id',f.id);if(error)return alert(error.message);f.name=name;save();render()}
async function removeFolder(f){if(!confirm(`Delete folder “${f.name}”? Chats will be moved to Unfiled.`))return;const {error}=await supabase.from('chats').update({folder_id:null}).eq('folder_id',f.id);if(error)return alert(error.message);const {error:fe}=await supabase.from('chat_folders').delete().eq('id',f.id);if(fe)return alert(fe.message);state.chats.forEach(c=>{if(c.folder_id===f.id)c.folder_id=null});state.folders=state.folders.filter(x=>x.id!==f.id);if(state.activeFolder===f.id)state.activeFolder=null;save();render()}
$('newFolder').onclick=async()=>{const name=prompt('Folder name')?.trim();if(!name)return;const {data,error}=await supabase.from('chat_folders').insert({name}).select('id,name,updated_at').single();if(error)return alert('Could not create folder: '+error.message);state.folders.push(data);state.activeFolder=data.id;save();render()};
function render(keep){sidebar();const box=$('messages');box.replaceChildren();const c=current();const onHome=state.showHome!==false&&(!state.active||!c);if(onHome){switchView('home');renderHome()}else{switchView('chat')}if(!c||!c.messages.length){const w=document.createElement('div');w.className='welcome';w.textContent='What can I help with?';const s=document.createElement('span');s.textContent='Choose a provider and model to begin';w.append(s);box.append(w)}else for(const m of c.messages){const d=document.createElement('div');d.className='msg '+m.role;if(m.role==='assistant'){const meta=document.createElement('div');meta.className='meta';meta.textContent=m.model||'Assistant';d.append(meta)}const body=document.createElement('div');paintMessage(body,m);if(m.images?.length){const gal=document.createElement('div');gal.className='msgImages';for(const im of m.images){const img=document.createElement('img');img.src=im.src;img.alt=im.name||'image';gal.append(img)}d.append(gal)}d.append(body);if(m.role==='assistant'){const tg=button(viewLabel(m),'Show this message as plain text or formatted',()=>{viewOverride.set(m,body.classList.contains('plain')?'rich':'plain');paintMessage(body,m);tg.textContent=viewLabel(m)},'mini');tg.classList.add('fmtmsg');d.append(tg)}if(m.role==='user'&&!m.files?.length&&!m.images?.length){const edit=button('Edit & retry','Edit this message and regenerate the answer',()=>{if(busy)return;editingIndex=c.messages.indexOf(m);$('prompt').value=m.content;$('prompt').focus();$('send').textContent='↻';},'mini');edit.classList.add('editmsg');d.append(edit)}if(m.files?.length){const fs=document.createElement('div');fs.className='filechips';fs.textContent='Attachments: '+m.files.map(f=>f.name).join(', ');d.append(fs)}box.append(d)}if(!keep)$('scroll').scrollTop=$('scroll').scrollHeight;$('crossChatMemory').checked=!!state.crossChatMemory}
function newChat(){state.showHome=false;const c={id:crypto.randomUUID(),title:'New conversation',messages:[],folder_id:state.activeFolder||null};state.chats.unshift(c);state.active=c.id;save();render();syncChat(c)}
$('new').onclick=newChat;$('homeBtn').onclick=()=>{state.showHome=true;state.active=null;save();render()};$('search').oninput=sidebar;$('searchScope').onchange=sidebar;$('provider').value=state.provider||'groq';models();$('provider').onchange=()=>{state.provider=$('provider').value;models();save()};$('model').onchange=()=>{state.models[state.provider]=$('model').value;save();renderTokenUsage()};$('crossChatMemory').onchange=()=>{state.crossChatMemory=$('crossChatMemory').checked;save()};
function terms(text){return [...new Set((text.toLowerCase().match(/[a-z0-9_]{3,}/g)||[]).filter(x=>!['the','and','for','that','this','with','you','your','are','was','were','from','have','has','what','when','where','how','can','could','would','should','into','about','then','them','they','our','out','use','using'].includes(x)))]}
function crossChatContext(prompt,c){if(!state.crossChatMemory)return '';const keys=terms(prompt);if(!keys.length)return '';const candidates=[];for(const other of state.chats){if(other.id===c.id)continue;if((other.folder_id||null)!==(c.folder_id||null))continue;for(const m of other.messages){const content=String(m.content||'');if(!content||m.role==='system')continue;const words=terms(content);const score=keys.reduce((n,k)=>n+(words.includes(k)?1:0),0);if(score>0)candidates.push({score,chat:other.title,role:m.role,content:content.slice(0,1200)})}}candidates.sort((a,b)=>b.score-a.score);const top=candidates.slice(0,6);if(!top.length)return '';return 'Relevant excerpts from other chats:\n'+top.map(x=>`[Chat: ${x.chat} | ${x.role}] ${x.content}`).join('\n\n')}
const MAX_UPLOAD=100*1024*1024,MAX_CHARS=40000,IMAGE_NAME=/\.(png|jpe?g|webp|gif|bmp)$/i;
function loadImage(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);res(i)};i.onerror=()=>{URL.revokeObjectURL(u);rej(Error('Could not decode image'))};i.src=u})}
function shrink(img,maxDim,q){const s=Math.min(1,maxDim/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*s)),h=Math.max(1,Math.round(img.naturalHeight*s)),c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(img,0,0,w,h);return c.toDataURL('image/jpeg',q)}
async function readUpload(file){const textTypes=/\.(txt|md|csv|json|js|ts|html|css|xml|py|java|sql|log)$/i;const name=file.name||'file';if(file.size>MAX_UPLOAD)throw Error('File exceeds 100 MB');
if(file.type.startsWith('image/')||IMAGE_NAME.test(name)){const img=await loadImage(file);let dataUrl=shrink(img,1280,.82);return {name,kind:'image',dataUrl,stored:shrink(img,640,.6),text:''}}
if(textTypes.test(name)){const raw=await file.slice(0,400000).text();return {name,kind:'text',text:raw.slice(0,MAX_CHARS)}}
throw Error('Unsupported file type')}
async function addPending(file,nameOverride){try{if(pendingFiles.length>=4)throw Error('Max 4 files per message.');const item=await readUpload(file);if(nameOverride)item.name=nameOverride;pendingFiles.push(item);renderAttachments()}catch(err){alert(err.message)}}
$('attach').onclick=()=>$('fileInput').click();$('fileInput').onchange=async e=>{for(const file of [...e.target.files])await addPending(file);e.target.value=''};function renderAttachments(){$('attachmentList').replaceChildren();pendingFiles.forEach((f,i)=>{const b=button('×','Remove',()=>{pendingFiles.splice(i,1);renderAttachments()},'mini');const s=document.createElement('span');s.className='attachment';s.textContent=f.name+' ';s.append(b);$('attachmentList').append(s)})}

function fmt(n){return Math.round(n).toLocaleString()}function compact(n){return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(Math.round(n))}
function scopeKey(sc){return sc==='all'?'all':sc==='provider'?'provider:'+$('provider').value:'model:'+$('provider').value+'/'+$('model').value}
function scopeName(sc){return sc==='all'?'All providers':sc==='provider'?'Provider · '+$('provider').value:'Model · '+$('provider').value+' / '+$('model').value}
function usageFor(sc,period){const p=$('provider').value,m=$('model').value;const o={input:0,output:0,total:0,requests:0,est:0};for(const r of usageAgg){if(r.period!==period)continue;if(sc==='provider'&&r.provider!==p)continue;if(sc==='model'&&(r.provider!==p||r.model!==m))continue;o.input+=+r.input_tokens;o.output+=+r.output_tokens;o.total+=+r.total_tokens;o.requests+=+r.requests}return o}
function limitsFor(sc){const mine=userSettings.limits?.[scopeKey(sc)]||{},known=sc==='model'?(knownLimits[$('provider').value+'/'+$('model').value]||{}):{},out={custom:false,known:false};for(const k of ['day','week','month']){if(Number.isFinite(mine[k])&&mine[k]>0){out[k]=mine[k];out.custom=true}else if(known[k]){out[k]=known[k];out.known=true}else out[k]=null}return out}
function usageLevel(pct){return pct>=100?'full':pct>=85?'high':pct>=60?'mid':'low'}
function renderTokenUsage(){const sc=tokenScope;$('tokenScope').value=sc;$('tokenScopeLabel').textContent=scopeName(sc);const lim=limitsFor(sc),box=$('tokenPeriods');box.replaceChildren();let worst=null,todayText='';
for(const [period,label] of [['day','Today'],['week','This week'],['month','This month']]){const u=usageFor(sc,period),limit=lim[period];const row=document.createElement('div');row.className='tokenRow';const head=document.createElement('div');head.className='tokenRowHead';const l=document.createElement('span');l.textContent=label;const v=document.createElement('strong');head.append(l,v);const bar=document.createElement('div');bar.className='tokenBar';const fill=document.createElement('i');bar.append(fill);const meta=document.createElement('div');meta.className='tokenMeta';
if(limit){const pct=u.total/limit*100;row.dataset.level=usageLevel(pct);v.textContent=`${fmt(u.total)} / ${fmt(limit)}`;fill.style.width=Math.min(100,pct)+'%';if(worst===null||pct>worst)worst=pct;if(period==='day')todayText='Today '+Math.round(pct)+'%'}
else{row.dataset.level='unknown';v.textContent=fmt(u.total)+' used';fill.style.width='100%';if(period==='day')todayText='Today '+compact(u.total)}
row.append(head,bar,meta);box.append(row)}
$('tokenDot').dataset.level=worst===null?'unknown':usageLevel(worst);$('tokenCompact').textContent=usageError?'unavailable':todayText;}
$('tokenScope').onchange=()=>{tokenScope=$('tokenScope').value;localStorage.setItem('aihub-token-scope',tokenScope);renderTokenUsage()};
function parseLimit(str){const t=String(str||'').trim().toLowerCase().replace(/[,_\s]/g,'');if(!t)return null;const m=t.match(/^(\d*\.?\d+)([kmb]?)$/);return m?Math.round(parseFloat(m[1])*({'':1,k:1e3,m:1e6,b:1e9}[m[2]])):NaN}
$('tokenLimits').onclick=()=>{const mine=userSettings.limits?.[scopeKey(tokenScope)]||{};$('limitsScope').textContent='For: '+scopeName(tokenScope);$('limitDay').value=mine.day||'';$('limitWeek').value=mine.week\vert{}\vert{}'';$('limitMonth').value=mine.month||'';$('limitsDialog').showModal()};$('closeLimits').onclick=()=>$('limitsDialog').close();$('saveLimits').onclick=async()=>{const vals={};for(const [k,id] of [['day','limitDay'],['week','limitWeek'],['month','limitMonth']]){const v=parseLimit($(id).value);if(Number.isNaN(v))return alert('Invalid number.');if(v)vals[k]=v}userSettings.limits={...userSettings.limits};if(Object.keys(vals).length)userSettings.limits[scopeKey(tokenScope)]=vals;else delete userSettings.limits[scopeKey(tokenScope)];$('limitsDialog').close();renderTokenUsage();await saveUserSettings(true)};
$('clearLimits').onclick=async()=>{userSettings.limits={...userSettings.limits};delete userSettings.limits[scopeKey(tokenScope)];$('limitsDialog').close();renderTokenUsage();await saveUserSettings(true)};
function periodStarts(){const n=new Date(),day=new Date(n.getFullYear(),n.getMonth(),n.getDate()),week=new Date(day);week.setDate(day.getDate()-((day.getDay()+6)%7));return {day,week,month:new Date(n.getFullYear(),n.getMonth(),1)}}
async function loadUsage(){if(!authenticated)return;const st=periodStarts();const {data,error}=await supabase.rpc('token_usage_totals',{day_start:st.day.toISOString(),week_start:st.week.toISOString(),month_start:st.month.toISOString()});if(error){usageError=error.message;usageAgg=[]}else{usageError=null;usageAgg=data||[]}renderTokenUsage()}
function startUsagePolling(){clearInterval(usageTimer);usageTimer=setInterval(()=>{if(!document.hidden)loadUsage()},30000)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadUsage()});window.addEventListener('focus',loadUsage);
async function loadUserSettings(){const {data}=await supabase.from('user_settings').select('settings').maybeSingle();const s=data?.settings||{};userSettings={limits:s.limits||{},plain:data?!!s.plain:userSettings.plain};updatePlainBtn()}
async function saveUserSettings(){if(!authenticated||!currentUserId)return;await supabase.from('user_settings').upsert({user_id:currentUserId,settings:{limits:userSettings.limits,plain:userSettings.plain},updated_at:new Date().toISOString()})}
async function loadLiveModels(){try{const r=await api('models?provider=openrouter');if(!r.ok)return;const d=await r.json();if(Array.isArray(d.models)&&d.models.length){liveModels.openrouter=d.models;if($('provider').value==='openrouter')models()}}catch{}}

function viewIsPlain(m){const o=viewOverride.get(m);return o?o==='plain':userSettings.plain}function viewLabel(m){return viewIsPlain(m)?'Show formatted':'Show plain'}
function paintMessage(body,m){const plain=viewIsPlain(m);body.className=plain?'plain':'md';body.innerHTML=plain?renderPlain(m.content):renderMarkdown(m.content)}
function updatePlainBtn(){$('plainBtn').textContent='Aa '+(userSettings.plain?'Plain':'Rich');$('plainBtn').classList.toggle('on',userSettings.plain)}$('plainBtn').onclick=()=>{userSettings.plain=!userSettings.plain;viewOverride=new WeakMap();updatePlainBtn();render(true);saveUserSettings()};updatePlainBtn();

document.addEventListener('paste',async e=>{if(!authenticated||(e.target instanceof Element&&e.target.closest('dialog')))return;const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/')||/\.(txt|md|csv|json|pdf|png|jpe?g|webp|gif)$/i.test(f.name));if(!files.length\vert{}\vert{}e.clipboardData.getData('text/plain'))return;e.preventDefault();for(const f of files){await addPending(f)}$('prompt').focus()});
document.addEventListener('click',e=>{const t=e.target;if(!(t instanceof Element))return;const cp=t.closest('.copyCode');if(cp){const code=cp.closest('.codeBlock')?.querySelector('code')?.textContent||'';navigator.clipboard?.writeText(code).then(()=>{cp.textContent='Copied';setTimeout(()=>cp.textContent='Copy',1200)}).catch(()=>{});return}const img=t.closest('.msgImages img,.mdImg');if(img){$('imgDialogImg').src=img.src;$('imgDialog').showModal()}});$('imgDialog').onclick=()=>$('imgDialog').close();

$('tokenToggle').onclick=()=>{const collapsed=$('tokenWidget').classList.toggle('collapsed');$('tokenToggle').textContent=collapsed?'Expand':'Collapse'};
$('tokenHide').onclick=()=>{$('tokenWidget').hidden=true;$('tokenShow').hidden=false};$('tokenShow').onclick=()=>{$('tokenWidget').hidden=false;$('tokenShow').hidden=true};
renderTokenUsage();

function updateUploadHint(){const provider=$('provider').value,model=$('model').value;$('uploadHint').textContent=`Selected: ${provider} · ${model}.`}
$('provider').addEventListener('change',updateUploadHint);$('model').addEventListener('change',updateUploadHint);updateUploadHint();

$('compose').onsubmit=async e=>{e.preventDefault();if(busy)return;const promptText=$('prompt').value.trim();if(!promptText&&!pendingFiles.length)return;if(!current())newChat();const c=current(),p=$('provider').value,m=$('model').value;const files=pendingFiles.slice(0,4),textFiles=files.filter(f=>f.kind!=='image'),imgFiles=files.filter(f=>f.kind==='image');
const fullText=promptText+(textFiles.length?'\n\n'+textFiles.map(f=>`--- File: ${f.name} ---\n${f.text}`).join('\n\n'):'');const displayText=promptText+(textFiles.length?'\n\n[Attached files]':'');
const userMsg={role:'user',content:displayText,files:textFiles.map(f=>({name:f.name}))};if(imgFiles.length)userMsg.images=imgFiles.map(f=>({name:f.name,src:f.stored}));
c.messages.push(userMsg);$('prompt').value='';pendingFiles=[];renderAttachments();save();render();
try{const r=await api('chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:p,model:m,messages:c.messages})});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');c.messages.push({role:'assistant',content:data.content||'(Empty)',model:p+' · '+m});save();await syncChat(c);loadUsage()}catch(err){alert(err.message)}finally{render()}};

// ==========================================
// VIEW SWITCHER & MODULES (Dashboard & Models)
// ==========================================
function switchView(viewName) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
  const homeView = $('homeView');
  const messages = $('messages');
  if (homeView) homeView.hidden = true;
  if (messages) messages.hidden = true;

  if (viewName === 'home') {
    if (homeView) homeView.hidden = false;
  } else if (viewName === 'chat') {
    if (messages) messages.hidden = false;
  } else if (viewName === 'models') {
    const modelsView = $('models-view');
    if (modelsView) modelsView.classList.remove('hidden');
    loadModelsView();
  } else if (viewName === 'dashboard') {
    const dashView = $('dashboard-view');
    if (dashView) dashView.classList.remove('hidden');
    loadDashboardData();
  }
}

async function loadModelsView() {
  const container = $('models-container');
  if (!container) return;
  container.innerHTML = '<p class="text-gray-400">Loading models...</p>';
  try {
    const res = await fetch('/api/models');
    const models = await res.json();
    container.innerHTML = models.map(m => `
      <div class="model-card border p-4 rounded-lg bg-[#161b22] border-[#30363d] flex flex-col justify-between">
        <div>
          <div class="flex justify-between items-start mb-2">
            <h3 class="font-semibold text-white">${m.name}</h3>
            <span class="text-xs px-2 py-1 rounded bg-[#21262d] text-cyan-400 font-mono">${m.id}</span>
          </div>
          <p class="text-sm text-gray-400 mb-4 line-clamp-2">${m.description || 'No description provided.'}</p>
        </div>
        <div class="flex justify-between items-center text-xs text-gray-500 border-t border-[#30363d] pt-3">
          <span>Context: ${((m.context_length || 0) / 1000).toFixed(0)}k tokens</span>
        </div>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<p class="text-red-400">Failed to load models list.</p>';
  }
}

async function loadDashboardData() {
  const reqsEl = $('dash-total-reqs');
  const tokensEl = $('dash-total-tokens');
  const provsEl = $('dash-providers-count');
  const logsEl = $('dash-logs-container');

  try {
    const {data:{session}} = await supabase.auth.getSession();
    const res = await fetch(supabase.supabaseUrl + '/rest/v1/token_usage?select=*', {
      headers: { apikey: supabase.supabaseKey, Authorization: 'Bearer ' + (session?.access_token || '') }
    });
    if (!res.ok) throw new Error('Failed to fetch usage logs');
    const logs = await res.json();

    let totalTokens = logs.reduce((acc, curr) => acc + (curr.total_tokens || 0), 0);
    let uniqueProviders = new Set(logs.map(l => l.provider)).size;

    if (reqsEl) reqsEl.textContent = logs.length;
    if (tokensEl) tokensEl.textContent = totalTokens.toLocaleString();
    if (provsEl) provsEl.textContent = uniqueProviders;

    if (!logs.length) {
      if (logsEl) logsEl.innerHTML = '<p class="text-gray-500">No requests logged yet.</p>';
      return;
    }

    if (logsEl) {
      logsEl.innerHTML = logs.slice(-10).reverse().map(l => `
        <div class="flex justify-between items-center bg-[#21262d] p-3 rounded border border-[#30363d]">
          <div>
            <span class="text-cyan-400 font-mono text-xs uppercase">${l.provider}</span>
            <span class="text-white ml-2">${l.model}</span>
          </div>
          <div class="text-gray-400 text-xs">
            <span>${l.total_tokens || 0} tokens</span> · <span class="text-gray-500">${new Date(l.created_at || Date.now()).toLocaleTimeString()}</span>
          </div>
        </div>
      `).join('');
    }
  } catch {
    if (logsEl) logsEl.innerHTML = '<p class="text-red-400">Could not load dashboard telemetry.</p>';
  }
}

// Bind navbar navigation buttons
document.getElementById('homeBtn')?.addEventListener('click', () => { state.showHome = true; state.active = null; save(); render(); });
document.getElementById('dashboardBtn')?.addEventListener('click', () => switchView('dashboard'));
document.getElementById('modelsBtn')?.addEventListener('click', () => switchView('models'));

showSession();
