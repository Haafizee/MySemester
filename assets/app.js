console.log('MySemester app.js v1.4 (Development Mode + high performance) loaded');
let idToken = null;
let devToken = null;

function getConfig() {
  if (typeof window !== 'undefined' && window.MYSEMESTER_CONFIG) return window.MYSEMESTER_CONFIG;
  if (typeof MYSEMESTER_CONFIG !== 'undefined') return MYSEMESTER_CONFIG;
  return {};
}

const LOGIN_MODE = String(getConfig().LOGIN_MODE || 'manual').toLowerCase();
let rolePreviewStarting = false;
let currentUser = null;
let authenticatedUser = null;
let currentClass = null;
let adminData = null;
let selectedAdminClassId = null;
let activeRoleTest = null;
let roleMatrixData = null;
let roleTestContextData = null;
let activeTestSemesterId = null;
let activeRoleLabTab = 'dashboard';
let roleLabEditing = null;

const $ = (selector) => document.querySelector(selector);
function show(selector, visible) {
  const el=$(selector);
  if(el) el.classList.toggle('hidden', !visible);
}
function setError(message) { $('#loginError').textContent = message || ''; }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

let toastTimer = null;
function showToast(message, type = 'ok', duration = 3500) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast ' + (type === true ? 'error' : (type === false ? 'ok' : type));
  show('#toast', true);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { show('#toast', false); }, duration);
}

function initializeGoogleSignIn() {
  if (!window.google || !google.accounts || !google.accounts.id) {
    setError('Google Sign-In belum dimuatkan. Sila refresh halaman.');
    return;
  }
  const config = getConfig();
  if (!config.GOOGLE_CLIENT_ID || config.GOOGLE_CLIENT_ID.includes('PASTE_')) {
    setError('Google Client ID belum dikonfigurasikan dalam config.js.');
    return;
  }
  google.accounts.id.initialize({
    client_id: config.GOOGLE_CLIENT_ID,
    callback: onGoogleCredential,
    auto_select: false
  });
  google.accounts.id.renderButton($('#googleButton'), {
    theme: 'outline', size: 'large', shape: 'pill',
    text: 'continue_with', width: 260
  });
}
window.addEventListener('load', () => {
  const manual=LOGIN_MODE==='manual';
  show('#manualLoginForm',manual);
  show('#googleLoginPanel',!manual);
  if(manual) return; // Google Identity Services is not even requested in manual development mode.
  const script=document.createElement('script');
  script.src='https://accounts.google.com/gsi/client';
  script.async=true;script.defer=true;
  script.onload=initializeGoogleSignIn;
  script.onerror=()=>setError('Tidak dapat memuatkan Google Sign-In. Semak sambungan internet.');
  document.head.appendChild(script);
});

async function completeLogin(result) {
  currentUser=result.user;
  authenticatedUser=result.user;
  $('#welcomeName').textContent='Selamat datang, '+(currentUser.name||'pengguna');
  $('#welcomeEmail').textContent=currentUser.email;
  $('#profile').textContent=currentUser.email+(result.isSystemAdmin?' • SYSTEM ADMIN':'');
  show('#loginView',false);
  show('#appView',true);
  if(result.isSystemAdmin || result.workspace==='system_admin') {
    show('#adminView',true);
    show('#studentView',false);
    $('#adminWelcomeName').textContent=currentUser.name||currentUser.email;
    $('#adminWelcomeEmail').textContent=currentUser.email;
    await loadAdminDashboard();
  } else {
    show('#adminView',false);
    show('#studentView',true);
    if(result.classes && result.classes.length) {
      currentClass=result.classes[0];
      $('#className').textContent=currentClass.className;
      $('#classCode').textContent='Kod kelas: '+currentClass.classCode;
      show('#classArea',true);show('#noClass',false);
    } else {
      show('#noClass',true);show('#classArea',false);
    }
  }
}
async function onGoogleCredential(response) {
  idToken=response.credential;
  setError('');
  $('#googleButton').classList.add('disabled');
  try { await completeLogin(await api('bootstrap',{})); }
  catch(error) { idToken=null;setError(error.message||'Log masuk gagal.'); }
  finally { $('#googleButton').classList.remove('disabled'); }
}
$('#manualLoginForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const button=$('#manualLoginBtn');
  button.disabled=true;button.textContent='Mengesahkan...';setError('');
  try {
    const result=await api('devLogin',{username:$('#manualUsername').value.trim(),password:$('#manualPassword').value});
    devToken=result.devToken;
    $('#manualPassword').value='';
    if (result.user && (result.isSystemAdmin || result.workspace === 'system_admin')) {
      await completeLogin(result);
    } else {
      await completeLogin(await api('bootstrap',{}));
    }
  } catch(error) {
    devToken=null;setError(error.message||'Log masuk pembangunan gagal.');
  } finally {
    button.disabled=false;button.textContent='Log masuk Development Mode';
  }
});

function api(action,data={},testSessionToken) {
  if(action!=='devLogin' && !idToken && !devToken) return Promise.reject(new Error('Sila log masuk terlebih dahulu.'));
  const config=getConfig();
  const apiUrl=config.APPS_SCRIPT_URL;
  if(!apiUrl||!apiUrl.endsWith('/exec')) return Promise.reject(new Error('URL Apps Script tidak ditemui atau tidak sah dalam config.js. Pastikan menggunakan URL Web App (/exec).'));
  const requestId='r'+Date.now().toString(36)+Math.random().toString(36).slice(2,15);
  const payload={
    action,
    data:data||{},
    idToken:idToken||'',
    devToken:devToken||'',
    requestId,
    origin:(typeof window!=='undefined'&&window.location&&window.location.origin)?window.location.origin:''
  };
  if(testSessionToken) payload.testSessionToken=testSessionToken;

  return new Promise((resolve,reject)=>{
    let finished=false;
    let timeoutId;

    // Use a unique isolated iframe per request to eliminate concurrency collisions
    const iframeId='apiFrame_'+requestId;
    const iframe=document.createElement('iframe');
    iframe.name=iframeId;
    iframe.id=iframeId;
    iframe.style.display='none';
    document.body.appendChild(iframe);

    const cleanup=()=>{
      window.removeEventListener('message',onMessage);
      window.clearTimeout(timeoutId);
      setTimeout(()=>{
        try{iframe.remove();}catch(e){}
      },500);
    };

    const onMessage=(event)=>{
      const message=event.data;
      if(!message||message.type!=='MYSTER_POST_RESPONSE'||message.requestId!==requestId)return;
      finished=true;cleanup();
      const result=message.result||{};
      if(result.ok)resolve(result);
      else{
        const err=result.error||'MySemester API returned an error.';
        if(/token verification failed/i.test(err)){idToken=null;reject(new Error('Sesi Google tamat. Sila log masuk semula.'));}
        else reject(new Error(err));
      }
    };
    window.addEventListener('message',onMessage);
    timeoutId=window.setTimeout(()=>{
      if(finished)return;finished=true;cleanup();
      reject(new Error('Tiada respons daripada Apps Script dalam 30 saat. Semak sambungan internet dan status Web App.'));
    },30000);

    const form=document.createElement('form');
    form.method='POST';form.action=apiUrl;form.target=iframeId;form.style.display='none';
    const field=document.createElement('input');
    field.type='hidden';field.name='payload';field.value=JSON.stringify(payload);
    form.appendChild(field);document.body.appendChild(form);
    try{form.submit();}
    catch(error){finished=true;cleanup();reject(new Error('Gagal menghantar permintaan: '+error.message));}
    finally{form.remove();}
  });
}

/* ---------------- SYSTEM ADMIN WORKSPACE ---------------- */
async function loadAdminDashboard() {
  $('#adminLoading').textContent='Memuatkan data pentadbiran...';
  show('#adminLoading',true);
  try {
    adminData=await api('adminDashboard',{});
    renderAdminStats();
    renderAdminClasses();
    renderAdminUsers();
    show('#adminLoading',false);
    show('#adminContent',true);
    if(selectedAdminClassId) renderSelectedAdminClass();
  } catch(error) {
    $('#adminLoading').textContent='Gagal memuatkan dashboard: '+error.message;
  }
}
function renderAdminStats() {
  const s=adminData.stats||{};
  $('#adminStats').innerHTML=[
    ['Jumlah kelas',s.totalClasses||0,'layers'],
    ['Kelas aktif',s.activeClasses||0,'check-circle'],
    ['Pengguna berdaftar',s.totalUsers||0,'users'],
    ['Keahlian kelas',s.activeMembers||0,'user-check']
  ].map(x=>`<article class="admin-stat"><span>${x[0]}</span><b>${x[1]}</b></article>`).join('');
}
function renderAdminClasses() {
  const classes=adminData.classes||[];
  $('#adminClassList').innerHTML=classes.length?classes.map(c=>`
    <tr>
      <td><strong>${escapeHtml(c.className)}</strong><small>${escapeHtml(c.programme||'')} ${escapeHtml(c.cohort||'')}</small></td>
      <td><code>${escapeHtml(c.classCode)}</code></td>
      <td><span class="status ${c.status==='active'?'active':'draft'}">${escapeHtml(c.status)}</span></td>
      <td>${c.semesterCount}/15</td><td>${c.memberCount}</td>
      <td><button class="btn btn-small btn-light" data-manage-class="${escapeHtml(c.classId)}">Urus</button></td>
    </tr>`).join(''):'<tr><td colspan="6" class="muted">Belum ada kelas. Cipta kelas pertama.</td></tr>';
}
function renderAdminUsers() {
  const users=adminData.users||[];
  $('#adminUserList').innerHTML=users.length?users.map(u=>`
    <tr><td>${escapeHtml(u.fullName||'—')}</td><td>${escapeHtml(u.email)}</td>
    <td><span class="status ${u.accountStatus==='active'?'active':'draft'}">${escapeHtml(u.accountStatus)}</span></td>
    <td>${escapeHtml(u.lastLogin||'—')}</td></tr>`).join(''):'<tr><td colspan="4">Belum ada pengguna.</td></tr>';
}

/* SYSTEM ADMIN DATA CRUD */
let adminDataSchema=null, adminDataRows=[], adminDataSelected=null, adminDataMode='none';
function adminDataMessage(message,isError=false){
  const el=$('#adminDataMessage'); if(el){el.textContent=message||'';el.classList.toggle('error',!!isError);}
}
function renderAdminDataRows(){
  const body=$('#adminDataList'); if(!body)return;
  body.innerHTML=adminDataRows.length?adminDataRows.map(row=>{
    const id=String(row[adminDataSchema.key]??'');
    const summary=Object.entries(row).filter(([k,v])=>k!==adminDataSchema.key && v!=='' && v!==null && v!==undefined).slice(0,3).map(([k,v])=>`${k}: ${String(v).slice(0,70)}`).join(' · ');
    return `<tr><td><code>${escapeHtml(id)}</code></td><td>${escapeHtml(summary||'—')}</td>
      <td><button class="btn btn-small btn-light" type="button" data-admin-data-open="${escapeHtml(id)}">Buka</button></td></tr>`;
  }).join(''):'<tr><td colspan="3" class="muted">Tiada rekod ditemui.</td></tr>';
  $('#adminDataCount').textContent=`${adminDataRows.length} rekod dipaparkan daripada ${adminDataSchema?.total||0}`;
}
async function loadAdminDataTable(){
  const table=$('#adminDataTable')?.value; if(!table)return;
  adminDataMessage('Memuatkan rekod...');
  try{
    adminDataSchema=await api('adminListData',{table,search:$('#adminDataSearch')?.value||'',limit:250});
    adminDataRows=adminDataSchema.records||[];
    adminDataSelected=null; adminDataMode='none';
    $('#adminDataJson').value='';
    $('#adminDataMode').textContent='Tiada pilihan';
    $('#adminDataDelete').disabled=true;
    $('#adminDataEditorHint').textContent=`Kunci utama: ${adminDataSchema.key}. Medan tersedia: ${adminDataSchema.columns.join(', ')}`;
    renderAdminDataRows(); adminDataMessage('Data berjaya dimuatkan.');
  }catch(e){adminDataMessage(e.message,true);}
}
function startAdminDataNew(){
  if(!adminDataSchema){adminDataMessage('Muatkan jadual dahulu.',true);return;}
  const blank={}; adminDataSchema.columns.forEach(c=>blank[c]='');
  $('#adminDataJson').value=JSON.stringify(blank,null,2);
  adminDataSelected=null; adminDataMode='create';
  $('#adminDataMode').textContent='Rekod baharu';
  $('#adminDataDelete').disabled=true;
  $('#adminDataEditorHint').textContent=`Isi ${adminDataSchema.key} dan medan yang diperlukan.`;
  adminDataMessage('Mod cipta rekod baharu.');
}
async function saveAdminDataRecord(){
  if(!adminDataSchema)return;
  let record;
  try{record=JSON.parse($('#adminDataJson').value);}catch(e){adminDataMessage('JSON tidak sah: '+e.message,true);return;}
  if(!record||Array.isArray(record)||typeof record!=='object'){adminDataMessage('Rekod mesti objek JSON.',true);return;}
  try{
    if(adminDataMode==='create'){
      await api('adminCreateData',{table:adminDataSchema.table,record});
      adminDataMessage('Rekod berjaya dicipta.');
    }else if(adminDataMode==='edit' && adminDataSelected){
      const patch={...record}; delete patch[adminDataSchema.key];
      await api('adminUpdateData',{table:adminDataSchema.table,id:adminDataSelected[adminDataSchema.key],patch});
      adminDataMessage('Rekod berjaya dikemas kini.');
    }else{adminDataMessage('Pilih rekod atau tekan Rekod baharu.',true);return;}
    await loadAdminDataTable();
  }catch(e){adminDataMessage(e.message,true);}
}
async function deleteAdminDataRecord(){
  if(!adminDataSchema||!adminDataSelected)return;
  const id=adminDataSelected[adminDataSchema.key];
  if(!confirm(`Padam rekod ${id} daripada ${adminDataSchema.table}? Tindakan ini kekal.`))return;
  try{await api('adminDeleteData',{table:adminDataSchema.table,id});adminDataMessage('Rekod berjaya dipadam.');await loadAdminDataTable();}
  catch(e){adminDataMessage(e.message,true);}
}
function selectedClass() {
  return (adminData?.classes||[]).find(c=>c.classId===selectedAdminClassId)||null;
}
function renderSelectedAdminClass() {
  const c=selectedClass();
  if(!c){show('#adminClassDetail',false);return;}
  show('#adminClassDetail',true);
  $('#selectedClassTitle').textContent=c.className;
  $('#selectedClassMeta').textContent=`${c.classCode} • ${c.status} • ${c.memberCount} ahli`;
  $('#semesterList').innerHTML=(c.semesters||[]).map(s=>`
    <div class="semester-row"><div><strong>${escapeHtml(s.semesterName)}</strong>
    <small>${escapeHtml(s.academicSession||'')} • Semester ${escapeHtml(s.semesterNumber)}</small></div>
    <span class="status ${s.status==='active'?'active':'draft'}">${escapeHtml(s.status)}</span></div>`).join('')||'<p class="muted">Belum ada semester.</p>';
  const canActivate=c.semesterCount>=3&&c.semesterCount<=15&&c.status!=='active';
  $('#activateClassBtn').disabled=!canActivate;
  $('#activateClassHint').textContent=c.status==='active'?'Kelas telah diaktifkan.':`Perlu sekurang-kurangnya 3 semester sebelum diaktifkan (${c.semesterCount}/3).`;
  $('#createInviteBtn').disabled=c.status!=='active';
}
async function refreshAdmin() {
  await loadAdminDashboard();
}
$('#createClassForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const data={
    className:$('#newClassName').value.trim(),
    programme:$('#newClassProgramme').value.trim(),
    institution:$('#newClassInstitution').value.trim(),
    cohort:$('#newClassCohort').value.trim(),
    description:$('#newClassDescription').value.trim()
  };
  $('#createClassMessage').textContent='Mencipta kelas...';
  try {
    const r=await api('createClass',data);
    $('#createClassMessage').textContent=`Kelas berjaya dicipta. Kod kelas: ${r.classCode}. Tambah sekurang-kurangnya 3 semester.`;
    e.target.reset();await refreshAdmin();
    selectedAdminClassId=r.classId;renderSelectedAdminClass();
  } catch(err){$('#createClassMessage').textContent=err.message;}
});
$('#adminClassList').addEventListener('click',e=>{
  const b=e.target.closest('[data-manage-class]');
  if(!b)return;
  selectedAdminClassId=b.dataset.manageClass;
  renderSelectedAdminClass();
});
$('#createSemesterForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!selectedAdminClassId)return;
  const c=selectedClass();
  if(c&&c.semesterCount>=15){$('#semesterMessage').textContent='Had maksimum 15 semester telah dicapai.';return;}
  const data={
    classId:selectedAdminClassId,
    semesterName:$('#semesterName').value.trim(),
    academicSession:$('#semesterSession').value.trim(),
    semesterNumber:Number($('#semesterNumber').value),
    startDate:$('#semesterStart').value,
    endDate:$('#semesterEnd').value
  };
  $('#semesterMessage').textContent='Menyimpan semester...';
  try{await api('createSemester',data);$('#semesterMessage').textContent='Semester berjaya ditambah.';e.target.reset();await refreshAdmin();renderSelectedAdminClass();}
  catch(err){$('#semesterMessage').textContent=err.message;}
});
$('#activateClassBtn').addEventListener('click',async()=>{
  if(!selectedAdminClassId)return;
  $('#activateClassHint').textContent='Mengaktifkan kelas...';
  try{const r=await api('activateClass',{classId:selectedAdminClassId});$('#activateClassHint').textContent=r.message;await refreshAdmin();renderSelectedAdminClass();}
  catch(err){$('#activateClassHint').textContent=err.message;}
});
$('#createInviteForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!selectedAdminClassId)return;
  const data={classId:selectedAdminClassId,expiresAt:$('#inviteExpiry').value,maxUses:Number($('#inviteMaxUses').value||0)};
  $('#inviteMessage').textContent='Menjana kod...';
  try{
    const r=await api('adminCreateInvitation',data);
    $('#inviteMessage').textContent='Kod jemputan: '+r.inviteCode+' — salin dan edarkan kepada pelajar.';
    $('#inviteMessage').classList.add('invite-result');
    await refreshAdmin();renderSelectedAdminClass();
  }catch(err){$('#inviteMessage').textContent=err.message;}
});
$('#assignRoleForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!selectedAdminClassId)return;
  const data={classId:selectedAdminClassId,email:$('#assignEmail').value.trim(),memberRole:$('#assignRole').value};
  $('#assignRoleMessage').textContent='Mengemaskini peranan...';
  try{const r=await api('adminAssignClassRole',data);$('#assignRoleMessage').textContent=r.message;e.target.reset();await refreshAdmin();renderSelectedAdminClass();}
  catch(err){$('#assignRoleMessage').textContent=err.message;}
});
document.querySelectorAll('[data-admin-tab]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('[data-admin-tab]').forEach(x=>x.classList.toggle('active',x===btn));
    document.querySelectorAll('.admin-tab-panel').forEach(x=>x.classList.add('hidden'));
    $('#admin-panel-'+btn.dataset.adminTab).classList.remove('hidden');
    if(btn.dataset.adminTab==='data') loadAdminDataTable();
    if(btn.dataset.adminTab==='preview' && !roleMatrixData) loadRolePreviewConfig();
  });
});
$('#adminDataLoad')?.addEventListener('click',loadAdminDataTable);
$('#adminDataRefresh')?.addEventListener('click',loadAdminDataTable);
$('#adminDataTable')?.addEventListener('change',loadAdminDataTable);
$('#adminDataSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadAdminDataTable();}});
$('#adminDataNew')?.addEventListener('click',startAdminDataNew);
$('#adminDataSave')?.addEventListener('click',saveAdminDataRecord);
$('#adminDataDelete')?.addEventListener('click',deleteAdminDataRecord);
$('#adminDataClear')?.addEventListener('click',()=>{adminDataSelected=null;adminDataMode='none';$('#adminDataJson').value='';$('#adminDataMode').textContent='Tiada pilihan';$('#adminDataDelete').disabled=true;adminDataMessage('Editor dikosongkan.');});
$('#adminDataList')?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-admin-data-open]'); if(!btn)return;
  const row=adminDataRows.find(x=>String(x[adminDataSchema.key])===btn.dataset.adminDataOpen); if(!row)return;
  adminDataSelected=row;adminDataMode='edit';$('#adminDataJson').value=JSON.stringify(row,null,2);
  $('#adminDataMode').textContent='Edit rekod';$('#adminDataDelete').disabled=false;
  $('#adminDataEditorHint').textContent=`ID rekod: ${row[adminDataSchema.key]}. Jangan ubah kunci utama.`;
  adminDataMessage('Rekod dimuatkan ke editor.');
});


/* ---------------- SYSTEM ADMIN: PERMISSION MATRIX + TEMPORARY ROLE TEST ---------------- */
const ROLE_LABELS = {
  student:'Student / Pelajar',
  pic:'PIC',
  lecturer:'Lecturer / Pensyarah',
  ko:'KO / Class Coordinator',
  class_admin:'Class Admin'
};

async function loadRolePreviewConfig() {
  try {
    roleMatrixData=await api('getRoleMatrix',{});
    renderPermissionMatrix();
    populatePreviewClasses();
    renderRoleCards();
    await loadRoleTestHistory();
  } catch(error) {
    const msg=$('#matrixMessage');
    if(msg) msg.textContent='Gagal memuatkan matriks: '+error.message;
  }
}
function populatePreviewClasses() {
  const select=$('#previewClass');
  if(!select) return;
  const classes=adminData?.classes||[];
  const previous=select.value;
  select.innerHTML=classes.map(c=>`<option value="${escapeHtml(c.classId)}">${escapeHtml(c.className)} (${escapeHtml(c.classCode)})</option>`).join('');
  if(previous && classes.some(c=>c.classId===previous)) select.value=previous;
  else if(selectedAdminClassId && classes.some(c=>c.classId===selectedAdminClassId)) select.value=selectedAdminClassId;
}
function renderRoleCards() {
  const target=$('#roleCards');
  if(!target) return;
  const roles=['student','pic','lecturer','ko','class_admin'];
  target.innerHTML=roles.map((role,i)=>`
    <label class="role-card">
      <input type="radio" name="previewRole" value="${role}" ${i===0?'checked':''}>
      <div><span>${ROLE_LABELS[role]}</span><small>Akaun ujian sementara</small></div>
    </label>`).join('');
  const switcher=$('#previewRoleSwitch');
  if(switcher) switcher.innerHTML=roles.map(role=>`<option value="${role}">${ROLE_LABELS[role]}</option>`).join('');
}
function renderPermissionMatrix() {
  const body=$('#permMatrix');
  if(!body || !roleMatrixData) return;
  const roles=roleMatrixData.roles||['student','pic','lecturer','ko','class_admin'];
  const groups={};
  (roleMatrixData.permissions||[]).forEach(p=>(groups[p.group||'Lain-lain'] ||= []).push(p));
  const values={};
  (roleMatrixData.matrix||[]).forEach(row=>{
    values[row.role]={};
    (row.permissions||[]).forEach(cell=>values[row.role][cell.permissionId]=!!cell.enabled);
  });
  body.innerHTML=Object.entries(groups).map(([group,permissions])=>`
    <tr class="perm-group"><td colspan="${roles.length+2}">${escapeHtml(group)}</td></tr>
    ${permissions.map(p=>`<tr>
      <td><strong>${escapeHtml(p.label)}</strong><small style="display:block;color:#60758e">${escapeHtml(p.description||'')} · ${p.implemented?'API tersedia':'Endpoint belum dibangunkan'}</small></td>
      ${roles.map(role=>`<td><input type="checkbox" aria-label="${escapeHtml(ROLE_LABELS[role]+' - '+p.label)}" data-matrix-role="${role}" data-matrix-permission="${p.id}" ${values[role]?.[p.id]?'checked':''}></td>`).join('')}
      <td title="System Admin sentiasa mempunyai akses penuh">🔒 Penuh</td>
    </tr>`).join('')}`).join('');
}
async function savePermissionMatrix() {
  const cells=Array.from(document.querySelectorAll('[data-matrix-role][data-matrix-permission]')).map(el=>({
    role:el.dataset.matrixRole,permissionId:el.dataset.matrixPermission,enabled:el.checked
  }));
  $('#matrixMessage').textContent='Menyimpan matriks kebenaran...';
  try {
    const result=await api('saveRoleMatrix',{cells});
    $('#matrixMessage').textContent=result.message+' ('+result.updated+' tetapan).';
    await loadRolePreviewConfig();
  } catch(error) {
    $('#matrixMessage').textContent='Gagal menyimpan: '+error.message;
  }
}
function selectedPreviewRole() {
  return document.querySelector('input[name="previewRole"]:checked')?.value || 'student';
}
function selectedPreviewClass() {
  return (adminData?.classes||[]).find(c=>c.classId===$('#previewClass')?.value)||null;
}
async function startRolePreview(role) {
  if(rolePreviewStarting) return;
  rolePreviewStarting=true;
  const startButton=$('#startPreviewBtn'), roleSwitch=$('#previewRoleSwitch');
  if(startButton) startButton.disabled=true;
  if(roleSwitch) roleSwitch.disabled=true;
  const classId=$('#previewClass').value;
  const selectedRole=role||selectedPreviewRole();
  if(!classId) { $('#previewMessage').textContent='Sila pilih kelas terlebih dahulu.'; rolePreviewStarting=false;if(startButton)startButton.disabled=false;if(roleSwitch)roleSwitch.disabled=false;return; }
  $('#previewMessage').textContent='Mencipta akaun ujian sementara...';
  try {
    if(activeRoleTest) await stopActiveRoleTest(false);
    const result=await api('startRoleTest',{classId,role:selectedRole});
    activeRoleTest={
      sessionId:result.sessionId,token:result.testSessionToken,classId:result.classId,
      role:result.role,testUser:result.testUser,expiresAt:result.expiresAt
    };
    currentUser=result.testUser;
    currentClass=selectedPreviewClass()||{classId,className:'Kelas ujian',classCode:''};
    $('#adminView').classList.add('hidden');
    show('#studentView',true);
    show('#noClass',false);show('#classArea',true);
    show('#previewBanner',true);show('#previewTestConsole',false);show('#roleLabWorkspace',true);
    document.querySelectorAll('.tabs,.student-tab-content').forEach(el=>el.classList.add('hidden'));
    $('#welcomeName').textContent=result.testUser.name;
    $('#welcomeEmail').textContent=result.testUser.email;
    $('#className').textContent=currentClass.className;
    $('#classCode').textContent='Kod kelas: '+(currentClass.classCode||'')+' • DATA SANDBOX';
    $('#rolePill').textContent=ROLE_LABELS[selectedRole];
    $('#previewInfo').textContent='Kelas: '+currentClass.className+' • Peranan: '+ROLE_LABELS[selectedRole];
    $('#previewAccountId').textContent='ID sementara: '+result.testUser.id+' • Tamat: '+result.expiresAt;
    $('#testRoleMeta').textContent='Peranan: '+ROLE_LABELS[selectedRole];
    $('#testAccountMeta').textContent='ID: '+result.testUser.id;
    $('#testExpiryMeta').textContent='Luput: '+result.expiresAt;
    $('#previewRoleSwitch').value=selectedRole;
    activeRoleLabTab='dashboard';roleLabEditing=null;
    $('#previewMessage').textContent=result.message;
    await loadRoleTestContext();
    document.querySelectorAll('.student-tab').forEach((b,i)=>b.classList.toggle('active',i===0));
    document.querySelectorAll('.student-tab-content').forEach((el,i)=>el.classList.toggle('hidden',i!==0));
  } catch(error) {
    $('#previewMessage').textContent='Gagal memulakan ujian: '+error.message;
    if(!activeRoleTest) {
      show('#studentView',false);show('#previewBanner',false);show('#previewTestConsole',false);show('#roleLabWorkspace',false);show('#adminView',true);
    }
  } finally {
    rolePreviewStarting=false;
    if(startButton) startButton.disabled=false;
    if(roleSwitch) roleSwitch.disabled=false;
  }
}
async function loadRoleTestContext() {
  if(!activeRoleTest) return;
  try {
    const sessionSnapshot=activeRoleTest;
    const context=await api('roleTestContext',{},sessionSnapshot.token);
    if(!activeRoleTest || activeRoleTest.sessionId!==sessionSnapshot.sessionId) return;
    if(context.role!==activeRoleTest.role || context.sessionId!==activeRoleTest.sessionId) throw new Error('Role context mismatch. Sila mulakan semula sesi ujian.');
    roleTestContextData=context;
    if($('#roleLabAudit')) $('#roleLabAudit').innerHTML=(context.auditLogs||[]).map(log=>`<div class="test-audit-item"><strong>${escapeHtml(log.role||context.role)} / ${escapeHtml(log.action)}</strong> — ${escapeHtml(log.result)}<small>${escapeHtml(log.created_at||'')} • ${escapeHtml(log.entity_type||'')}</small></div>`).join('')||'Belum ada aktiviti.';
    if(!activeTestSemesterId || !(roleTestContextData.semesters||[]).some(x=>x.semester_id===activeTestSemesterId)) {
      activeTestSemesterId=roleTestContextData.semesters?.[0]?.semester_id||null;
    }
    renderRoleTestWorkspace();
  } catch(error) {
    $('#previewTestResult').textContent='Konteks ujian: '+error.message;
  }
}
function rolePermissionEnabled(permissionId) {
  if(!roleMatrixData || !activeRoleTest) return false;
  const roleRow=(roleMatrixData.matrix||[]).find(x=>x.role===activeRoleTest.role);
  const enabled=id=>!!roleRow?.permissions?.find(x=>x.permissionId===id)?.enabled;
  const dependencies={
    'semester.view':['class.view'],'semester.manage':['class.view'],
    'schedule.view':['class.view','semester.view'],
    'schedule.edit':['class.view','semester.view','schedule.view'],
    'schedule.verify':['class.view','semester.view','schedule.view'],
    'schedule.delete':['class.view','semester.view','schedule.view'],
    'pb.view':['class.view','semester.view'],'pb.create':['class.view','semester.view','pb.view'],
    'pb.edit':['class.view','semester.view','pb.view'],'pb.delete':['class.view','semester.view','pb.view'],
    'pb.progress.update':['class.view','semester.view','pb.view'],
    'pb.marks.manage':['class.view','semester.view','pb.view'],
    'resources.view':['class.view','semester.view'],'resources.manage':['class.view','semester.view','resources.view'],
    'resources.delete':['class.view','semester.view','resources.view'],
    'calendar.view':['class.view','semester.view'],'calendar.create':['class.view','semester.view','calendar.view'],
    'calendar.edit':['class.view','semester.view','calendar.view'],'calendar.delete':['class.view','semester.view','calendar.view'],
    'members.view':['class.view'],'members.roles.manage':['class.view','members.view'],
    'reports.view':['class.view'],'notifications.manage':['class.view']
  };
  return enabled(permissionId) && (dependencies[permissionId]||[]).every(enabled);
}

function roleLabAllowed(permission) { return rolePermissionEnabled(permission); }
function roleLabRoleLabel(role) { return ROLE_LABELS[role] || role; }
function roleLabSubjectName(semesterSubjectId) {
  const ctx=roleTestContextData||{};
  const ss=(ctx.semesterSubjects||[]).find(x=>x.semester_subject_id===semesterSubjectId)||{};
  const sub=(ctx.subjects||[]).find(x=>x.subject_id===ss.subject_id)||{};
  return `${sub.subject_code||''} ${sub.subject_name||'Subjek'}`.trim();
}
function roleLabTabConfig(role) {
  const base=[['dashboard','Ringkasan','class.view']];
  const all=[['schedule','Jadual','schedule.view'],['assignments','Penilaian PB','pb.view'],
    ['resources','Nota & sumber','resources.view'],['calendar','Kalendar','calendar.view'],
    ['members','Ahli kelas','members.view'],['reports','Laporan','reports.view']];
  const roleTabs={
    student:['schedule','assignments','resources','calendar'],
    pic:['schedule','assignments','resources','calendar','members','reports'],
    lecturer:['schedule','assignments','resources','calendar','members','reports'],
    ko:['schedule','assignments','resources','calendar','members','reports'],
    class_admin:['schedule','assignments','resources','calendar','members','reports']
  };
  return base.concat(all.filter(x=>(roleTabs[role]||[]).includes(x[0]) && roleLabAllowed(x[2])));
}
function renderRoleTestWorkspace() { renderRoleLabWorkspace(); }
function renderRoleLabWorkspace() {
  const ctx=roleTestContextData;
  if(!ctx || !activeRoleTest) return;
  const role=activeRoleTest.role, semesters=ctx.semesters||[];
  if(ctx.role!==role) return;
  const roleLabel=roleLabRoleLabel(role);
  $('#rolePill').textContent=roleLabel;
  $('#previewInfo').textContent='Kelas: '+(currentClass?.className||'Kelas ujian')+' • Peranan: '+roleLabel;
  $('#previewAccountId').textContent='ID sementara: '+activeRoleTest.testUser.id+' • Tamat: '+activeRoleTest.expiresAt;
  $('#testRoleMeta').textContent='Peranan: '+roleLabel;
  $('#testAccountMeta').textContent='ID: '+activeRoleTest.testUser.id;
  $('#welcomeName').textContent=activeRoleTest.testUser.name;
  $('#welcomeEmail').textContent=activeRoleTest.testUser.email;
  const semester=semesters.find(x=>x.semester_id===activeTestSemesterId)||semesters[0]||null;
  activeTestSemesterId=semester?.semester_id||null;
  const ss=(ctx.semesterSubjects||[]).filter(x=>!semester || x.semester_id===semester.semester_id);
  const subjectIds=ss.map(x=>x.subject_id);
  const subjects=(ctx.subjects||[]).filter(x=>subjectIds.includes(x.subject_id));
  const ssIds=ss.map(x=>x.semester_subject_id);
  const sessions=(ctx.sessions||[]).filter(x=>ssIds.includes(x.semester_subject_id) && x.status!=='cancelled');
  const assignments=(ctx.assignments||[]).filter(x=>ssIds.includes(x.semester_subject_id) && x.status!=='cancelled');
  const resources=(ctx.resources||[]).filter(x=>ssIds.includes(x.semester_subject_id) && x.visibility!=='personal' && x.visibility!=='archived');
  const events=(ctx.calendarEvents||[]).filter(x=>!semester || x.semester_id===semester.semester_id).filter(x=>x.visibility!=='archived');
  const members=ctx.members||[], ownProgress=ctx.ownProgress||[];
  const subjectsById=Object.fromEntries(subjects.map(x=>[x.subject_id,x]));
  const semSelect=$('#semesterSwitch');
  if(semSelect) {
    semSelect.classList.toggle('hidden',semesters.length<2);
    semSelect.innerHTML=semesters.map(x=>`<option value="${escapeHtml(x.semester_id)}">${escapeHtml(x.semester_name)}</option>`).join('');
    if(activeTestSemesterId) semSelect.value=activeTestSemesterId;
  }
  const roleTitles={student:'Ruang Pembelajaran Pelajar',pic:'Dashboard Penyelaras PIC',lecturer:'Dashboard Pensyarah',ko:'Dashboard Class Coordinator',class_admin:'Dashboard Pentadbir Kelas'};
  const descriptions={student:'Pantau jadual, tugasan PB, sumber pembelajaran dan kemajuan tugasan anda.',pic:'Pantau jadual kelas, cadangkan perubahan dan selaraskan maklumat kelas.',lecturer:'Urus PB, sumber pembelajaran, markah dan maklumat pengajaran.',ko:'Selaraskan semester, jadual, ahli kelas dan komunikasi kohort.',class_admin:'Urus operasi kelas, semester, peranan ahli dan pemantauan keseluruhan.'};
  $('#roleLabTitle').textContent=roleTitles[role]||'Dashboard peranan';
  $('#roleLabDescription').textContent=descriptions[role]||'Ruang kerja ujian peranan.';
  $('#roleLabRolePill').textContent=roleLabRoleLabel(role);
  $('#roleLabStats').innerHTML=[['Semester',semesters.length],['Subjek',subjects.length],['Sesi jadual',sessions.length],['Tugasan PB',assignments.length]]
    .map(x=>`<article class="role-lab-stat"><span>${x[0]}</span><strong>${x[1]}</strong></article>`).join('');
  const tabs=roleLabTabConfig(role);
  if(!tabs.some(x=>x[0]===activeRoleLabTab)) activeRoleLabTab='dashboard';
  $('#roleLabNav').innerHTML=tabs.map(x=>`<button type="button" class="role-lab-tab ${activeRoleLabTab===x[0]?'active':''}" data-role-tab="${x[0]}">${x[1]}</button>`).join('');
  const header=`<div class="role-lab-toolbar"><label>Semester aktif <select id="roleLabSemester">${semesters.map(x=>`<option value="${escapeHtml(x.semester_id)}" ${x.semester_id===activeTestSemesterId?'selected':''}>${escapeHtml(x.semester_name)}</option>`).join('')}</select></label><span class="role-lab-chip">Akaun ujian: ${escapeHtml(activeRoleTest.testUser.id)}</span></div>`;
  const subjectTable=ss.map(x=>{const sub=subjectsById[x.subject_id]||{};return `<tr><td>${escapeHtml(sub.subject_code||'—')}</td><td>${escapeHtml(sub.subject_name||'Subjek')}</td><td>${escapeHtml(x.lecturer_user_id||'—')}</td><td>${assignments.filter(a=>a.semester_subject_id===x.semester_subject_id).length}</td></tr>`;}).join('')||'<tr><td colspan="4">Tiada subjek dalam semester ini.</td></tr>';
  const upcoming=[...assignments.map(x=>({title:x.title,date:x.due_at,type:'PB'})),...events.map(x=>({title:x.title,date:x.start_at,type:x.event_category||'Acara'}))]
    .filter(x=>x.date).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(0,5);
  let content='';
  if(activeRoleLabTab==='dashboard') {
    content=`${header}<div class="role-lab-grid">
      <section class="role-lab-card role-lab-wide"><div class="role-lab-card-head"><h3>Subjek semester</h3><span class="muted small">${subjects.length} subjek</span></div><div class="table-wrap"><table><thead><tr><th>Kod</th><th>Subjek</th><th>Pensyarah</th><th>PB</th></tr></thead><tbody>${subjectTable}</tbody></table></div></section>
      <section class="role-lab-card"><h3>Tarikh penting seterusnya</h3>${upcoming.map(x=>`<div class="role-lab-list-row"><div><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.type)}</small></div><time>${escapeHtml(x.date)}</time></div>`).join('')||'<p class="muted small">Tiada tarikh akan datang direkodkan.</p>'}</section>
      <section class="role-lab-card"><h3>Status ruang kerja</h3><div class="role-lab-summary"><span>Peranan aktif</span><b>${escapeHtml(roleLabRoleLabel(role))}</b></div><div class="role-lab-summary"><span>PB aktif</span><b>${assignments.length}</b></div><div class="role-lab-summary"><span>Ahli kelas</span><b>${members.length}</b></div><p class="muted small">Data kelas dipaparkan bersama perubahan sandbox sesi ini.</p></section>
      ${roleLabAllowed('semester.manage')?`<section class="role-lab-card"><h3>Tambah semester</h3><form id="roleLabSemesterForm" class="role-lab-form"><label>Nama semester<input name="semesterName" required placeholder="Contoh: Semester 2"></label><label>Sesi akademik<input name="academicSession" placeholder="2026/2027"></label><label>Nombor semester<input name="semesterNumber" type="number" min="1" max="15" value="${semesters.length+1}"></label><label>Tarikh mula<input name="startDate" type="date"></label><label>Tarikh tamat<input name="endDate" type="date"></label><div class="btn-row"><button class="btn" type="submit">Cipta semester</button><span class="small form-message" id="roleLabSemesterMessage"></span></div></form></section>`:''}
      ${roleLabAllowed('class.activate')?`<section class="role-lab-card"><h3>Status kelas</h3><p class="muted small">Uji proses pengaktifan kelas menggunakan akaun sementara.</p><button class="btn" data-role-action="activate-class">Aktifkan kelas ujian</button></section>`:''}
      ${roleLabAllowed('notifications.manage')?`<section class="role-lab-card"><h3>Hebahan kelas</h3><form id="roleLabNotificationForm" class="role-lab-form"><label>Tajuk<input name="title" required></label><label>Mesej<textarea name="message" required rows="3"></textarea></label><div class="btn-row"><button class="btn" type="submit">Hantar hebahan ujian</button><span id="roleLabNotificationMessage" class="small form-message"></span></div></form></section>`:''}
    </div>`;
  } else if(activeRoleLabTab==='schedule') {
    content=`${header}<section class="role-lab-card"><div class="role-lab-card-head"><div><h3>Jadual kelas</h3><p class="muted small">Paparan sesi mengikut semester dipilih.</p></div>${roleLabAllowed('schedule.edit')?'<button class="btn btn-small" data-role-action="new-schedule">Tambah sesi</button>':''}</div><div class="role-lab-records">${sessions.map(x=>`<article class="role-lab-record"><div class="role-lab-record-main"><b>${escapeHtml(x.session_date||'Tarikh belum ditetapkan')} · ${escapeHtml(x.start_time||'')}–${escapeHtml(x.end_time||'')}</b><span>${escapeHtml(roleLabSubjectName(x.semester_subject_id))} · ${escapeHtml(x.room||'Lokasi belum ditetapkan')}</span><small>${escapeHtml(x.session_type||'Kuliah')} · ${escapeHtml(x.delivery_mode||'')} · Pengesahan: ${escapeHtml(x.verification_status||'PENDING')}</small></div><div class="role-lab-record-actions">${roleLabAllowed('schedule.edit')?`<button class="btn btn-light btn-small" data-role-action="edit-schedule" data-id="${escapeHtml(x.session_id)}">Edit</button>`:''}${roleLabAllowed('schedule.verify')?`<button class="btn btn-light btn-small" data-role-action="verify-schedule" data-id="${escapeHtml(x.session_id)}">Sahkan</button>`:''}${roleLabAllowed('schedule.delete')?`<button class="btn btn-danger-light btn-small" data-role-action="delete-schedule" data-id="${escapeHtml(x.session_id)}">Arkib</button>`:''}</div></article>`).join('')||'<p class="muted">Tiada sesi jadual direkodkan.</p>'}</div></section><div id="roleLabEditor"></div>`;
  } else if(activeRoleLabTab==='assignments') {
    content=`${header}<section class="role-lab-card"><div class="role-lab-card-head"><div><h3>Penilaian Berterusan</h3><p class="muted small">Setiap PB terikat kepada subjek dalam semester aktif.</p></div>${roleLabAllowed('pb.create')?'<button class="btn btn-small" data-role-action="new-pb">Tambah PB</button>':''}</div><div class="role-lab-records">${assignments.map(a=>{
      const progress=ownProgress.find(x=>x.assignment_id===a.assignment_id);
      const actions=role==='student'?`<button class="btn btn-light btn-small" data-role-action="progress-pb" data-id="${escapeHtml(a.assignment_id)}">Kemaskini kemajuan</button>`:`${roleLabAllowed('pb.edit')?`<button class="btn btn-light btn-small" data-role-action="edit-pb" data-id="${escapeHtml(a.assignment_id)}">Edit</button>`:''}${roleLabAllowed('pb.marks.manage')?`<button class="btn btn-light btn-small" data-role-action="mark-pb" data-id="${escapeHtml(a.assignment_id)}">Rekod markah</button>`:''}${roleLabAllowed('pb.delete')?`<button class="btn btn-danger-light btn-small" data-role-action="delete-pb" data-id="${escapeHtml(a.assignment_id)}">Arkib</button>`:''}`;
      return `<article class="role-lab-record"><div class="role-lab-record-main"><b>${escapeHtml(a.title||'Tugasan PB')}</b><span>${escapeHtml(roleLabSubjectName(a.semester_subject_id))} · ${escapeHtml(a.assignment_type||'PB')} · ${escapeHtml(a.marks_percentage||0)}%</span><small>Mula: ${escapeHtml(a.start_date||'—')} · Hantar: ${escapeHtml(a.due_at||'—')}</small>${role==='student'?`<div class="role-progress"><span>Kemajuan: ${Number(progress?.progress_percentage||0)}%</span><div><i style="width:${Math.max(0,Math.min(100,Number(progress?.progress_percentage||0)))}%"></i></div></div>`:''}</div><div class="role-lab-record-actions">${actions}</div></article>`;
    }).join('')||'<p class="muted">Tiada PB direkodkan.</p>'}</div></section><div id="roleLabEditor"></div>`;
  } else if(activeRoleLabTab==='resources') {
    content=`${header}<section class="role-lab-card"><div class="role-lab-card-head"><div><h3>Nota & sumber pembelajaran</h3><p class="muted small">Pautan dan sumber berkaitan subjek semester ini.</p></div>${roleLabAllowed('resources.manage')?'<button class="btn btn-small" data-role-action="new-resource">Tambah sumber</button>':''}</div><div class="role-lab-records">${resources.map(r=>`<article class="role-lab-record"><div class="role-lab-record-main"><b>${escapeHtml(r.resource_name||'Sumber pembelajaran')}</b><span>${escapeHtml(roleLabSubjectName(r.semester_subject_id))} · ${escapeHtml(r.resource_type||'resource')}</span><small>${escapeHtml(r.description||'')}</small>${r.storage_file_id?`<a href="${escapeHtml(r.storage_file_id)}" target="_blank" rel="noopener">Buka sumber ↗</a>`:''}</div><div class="role-lab-record-actions">${roleLabAllowed('resources.manage')?`<button class="btn btn-light btn-small" data-role-action="edit-resource" data-id="${escapeHtml(r.resource_id)}">Edit</button>`:''}${roleLabAllowed('resources.delete')?`<button class="btn btn-danger-light btn-small" data-role-action="delete-resource" data-id="${escapeHtml(r.resource_id)}">Arkib</button>`:''}</div></article>`).join('')||'<p class="muted">Tiada sumber pembelajaran direkodkan.</p>'}</div></section><div id="roleLabEditor"></div>`;
  } else if(activeRoleLabTab==='calendar') {
    content=`${header}<section class="role-lab-card"><div class="role-lab-card-head"><div><h3>Kalendar & tarikh penting</h3><p class="muted small">Tarikh PB dan acara kelas.</p></div>${roleLabAllowed('calendar.create')?'<button class="btn btn-small" data-role-action="new-event">Tambah acara</button>':''}</div><div class="role-lab-records">${events.map(e=>`<article class="role-lab-record"><div class="role-lab-record-main"><b>${escapeHtml(e.title)}</b><span>${escapeHtml(e.event_category||'Acara')} · ${escapeHtml(e.start_at||'')}</span><small>${escapeHtml(e.description||'')}</small></div><div class="role-lab-record-actions">${roleLabAllowed('calendar.edit')?`<button class="btn btn-light btn-small" data-role-action="edit-event" data-id="${escapeHtml(e.event_id)}">Edit</button>`:''}${roleLabAllowed('calendar.delete')?`<button class="btn btn-danger-light btn-small" data-role-action="delete-event" data-id="${escapeHtml(e.event_id)}">Arkib</button>`:''}</div></article>`).join('')||'<p class="muted">Tiada acara kalendar direkodkan.</p>'}</div></section><div id="roleLabEditor"></div>`;
  } else if(activeRoleLabTab==='members') {
    content=`${header}<section class="role-lab-card"><h3>Ahli kelas</h3><p class="muted small">Senarai ahli kelas dan peranan yang ditetapkan.</p><div class="role-lab-records">${members.map(m=>`<article class="role-lab-record"><div class="role-lab-record-main"><b>${escapeHtml(m.name||m.userId)}</b><span>${escapeHtml(m.email||'Akaun ujian')} · ${escapeHtml(m.status||'active')}</span><small>ID: ${escapeHtml(m.userId)}</small></div><div class="role-lab-record-actions">${roleLabAllowed('members.roles.manage') && m.userId!==activeRoleTest.testUser.id?`<select data-member-role="${escapeHtml(m.userId)}"><option value="student" ${m.role==='student'?'selected':''}>Student</option><option value="pic" ${m.role==='pic'?'selected':''}>PIC</option><option value="lecturer" ${m.role==='lecturer'?'selected':''}>Lecturer</option><option value="ko" ${m.role==='ko'?'selected':''}>KO</option></select><button class="btn btn-light btn-small" data-role-action="save-member-role" data-id="${escapeHtml(m.userId)}">Simpan</button>`:`<span class="pill">${escapeHtml(m.role)}</span>`}</div></article>`).join('')||'<p class="muted">Tiada data ahli.</p>'}</div></section>`;
  } else if(activeRoleLabTab==='reports') {
    const completed=ownProgress.filter(x=>x.progress_status==='completed').length;
    content=`${header}<section class="role-lab-card"><h3>Ringkasan pemantauan kelas</h3><div class="role-lab-stats"><article class="role-lab-stat"><span>Ahli kelas</span><strong>${members.length}</strong></article><article class="role-lab-stat"><span>PB aktif</span><strong>${assignments.length}</strong></article><article class="role-lab-stat"><span>Sesi jadual</span><strong>${sessions.length}</strong></article><article class="role-lab-stat"><span>Progress selesai (akaun ini)</span><strong>${completed}</strong></article></div><p class="muted small">Laporan menggunakan data kelas dan perubahan sandbox semasa.</p><button class="btn btn-light" data-role-action="export-report">Eksport ringkasan CSV</button></section>`;
  }
  $('#roleLabContent').innerHTML=content;
}
function roleLabEditor(title,fields,submitLabel='Simpan') {
  const fieldHtml=fields.map(f=>`<label>${f.label}${f.type==='select'?`<select name="${f.name}" ${f.required?'required':''}>${f.options}</select>`:f.type==='textarea'?`<textarea name="${f.name}" rows="3" ${f.required?'required':''}>${escapeHtml(f.value||'')}</textarea>`:`<input name="${f.name}" type="${f.type||'text'}" value="${escapeHtml(f.value||'')}" ${f.required?'required':''} ${f.min!==undefined?`min="${f.min}"`:''} ${f.max!==undefined?`max="${f.max}"`:''}>`}</label>`).join('');
  $('#roleLabEditor').innerHTML=`<section class="role-lab-card role-lab-editor"><div class="role-lab-card-head"><h3>${title}</h3><button type="button" class="btn btn-light btn-small" data-role-action="close-editor">Tutup</button></div><form id="roleLabCrudForm" class="role-lab-form">${fieldHtml}<div class="btn-row"><button class="btn" type="submit">${submitLabel}</button><span id="roleLabFormMessage" class="small form-message"></span></div></form></section>`;
}
function roleLabSelectOptions(items,value,labelFn) { return items.map(x=>`<option value="${escapeHtml(value(x))}">${escapeHtml(labelFn(x))}</option>`).join(''); }
function roleLabOpenEditor(action,id) {
  const ctx=roleTestContextData||{}, ss=(ctx.semesterSubjects||[]).filter(x=>x.semester_id===activeTestSemesterId);
  const sessions=ctx.sessions||[], assignments=ctx.assignments||[], resources=ctx.resources||[], events=ctx.calendarEvents||[];
  const subjectFields=[{name:'semesterSubjectId',label:'Subjek',type:'select',required:true,options:roleLabSelectOptions(ss,x=>x.semester_subject_id,x=>roleLabSubjectName(x.semester_subject_id))}];
  roleLabEditing={action,id:id||null};
  if(action.includes('schedule')) {
    const row=sessions.find(x=>x.session_id===id)||{};
    roleLabEditor(id?'Kemaskini sesi jadual':'Tambah sesi jadual',[
      ...(!id?subjectFields:[]),{name:'sessionDate',label:'Tarikh',type:'date',required:true,value:row.session_date},
      {name:'startTime',label:'Masa mula',type:'time',required:true,value:row.start_time},{name:'endTime',label:'Masa tamat',type:'time',required:true,value:row.end_time},
      {name:'room',label:'Bilik / pautan',value:row.room},{name:'deliveryMode',label:'Mod',type:'select',value:row.delivery_mode,options:'<option>Bersemuka</option><option>Dalam talian</option><option>Hibrid</option>'},
      {name:'sessionType',label:'Jenis',type:'select',value:row.session_type,options:'<option>Kuliah</option><option>Tutorial</option><option>Amali</option><option>Lain-lain</option>'},
      {name:'reason',label:'Sebab perubahan',value:'Ujian melalui Role Workspace'}
    ],'Simpan sesi');
  } else if(action==='progress-pb') {
    const row=assignments.find(x=>x.assignment_id===id)||{}, progress=(ctx.ownProgress||[]).find(x=>x.assignment_id===id)||{};
    roleLabEditor('Kemaskini kemajuan tugasan: '+(row.title||''),[
      {name:'progress_status',label:'Status',type:'select',value:progress.progress_status||'not_started',options:'<option value="not_started">Belum mula</option><option value="in_progress">Sedang dibuat</option><option value="nearly_done">Hampir siap</option><option value="completed">Selesai</option>'},
      {name:'progress_percentage',label:'Kemajuan (%)',type:'number',min:0,max:100,value:progress.progress_percentage||0},
      {name:'personal_due_at',label:'Sasaran peribadi',type:'date',value:progress.personal_due_at},
      {name:'personal_notes',label:'Catatan peribadi',type:'textarea',value:progress.personal_notes}
    ],'Simpan kemajuan');
  } else if(action==='mark-pb') {
    const row=assignments.find(x=>x.assignment_id===id)||{}, students=(ctx.members||[]).filter(x=>x.role==='student');
    roleLabEditor('Rekod markah rasmi: '+(row.title||''),[
      {name:'studentUserId',label:'Pelajar',type:'select',required:true,options:roleLabSelectOptions(students,x=>x.userId,x=>(x.name||x.userId)+' · '+x.userId)},
      {name:'recordedMark',label:'Markah (%)',type:'number',min:0,max:100,required:true,value:0},{name:'feedback',label:'Maklum balas',type:'textarea'}
    ],'Simpan markah');
  } else if(action.includes('pb')) {
    const row=assignments.find(x=>x.assignment_id===id)||{};
    roleLabEditor(id?'Kemaskini PB':'Cipta Penilaian Berterusan',[
      ...(!id?subjectFields:[]),{name:'title',label:'Tajuk PB',required:true,value:row.title},{name:'assignmentCode',label:'Kod PB',value:row.assignment_code},
      {name:'assignmentType',label:'Jenis tugasan',value:row.assignment_type},{name:'marksPercentage',label:'Pemberat (%)',type:'number',min:0,max:100,value:row.marks_percentage||0},
      {name:'startDate',label:'Tarikh mula',type:'date',value:row.start_date},{name:'dueAt',label:'Tarikh hantar',type:'date',value:row.due_at},
      {name:'submissionMethod',label:'Kaedah penghantaran',value:row.submission_method},{name:'description',label:'Arahan tugasan',type:'textarea',value:row.description}
    ],id?'Simpan perubahan':'Terbitkan PB');
  } else if(action.includes('resource')) {
    const row=resources.find(x=>x.resource_id===id)||{};
    roleLabEditor(id?'Kemaskini sumber':'Tambah sumber pembelajaran',[
      ...(!id?subjectFields:[]),{name:'resourceName',label:'Nama sumber',required:true,value:row.resource_name},
      {name:'url',label:'URL HTTPS',value:row.storage_file_id,required:!id},{name:'description',label:'Penerangan',type:'textarea',value:row.description}
    ],id?'Simpan sumber':'Tambah sumber');
  } else if(action.includes('event')) {
    const row=events.find(x=>x.event_id===id)||{};
    roleLabEditor(id?'Kemaskini acara kalendar':'Tambah acara kalendar',[
      {name:'title',label:'Nama acara',required:true,value:row.title},{name:'eventCategory',label:'Kategori',value:row.event_category||'academic'},
      {name:'startAt',label:'Tarikh / masa mula',type:'datetime-local',required:true,value:row.start_at},{name:'endAt',label:'Tarikh / masa tamat',type:'datetime-local',value:row.end_at},
      {name:'description',label:'Penerangan',type:'textarea',value:row.description}
    ],id?'Simpan acara':'Tambah acara');
  }
}
function roleLabExportReport() {
  const ctx=roleTestContextData||{}, rows=[['Jenis','Nama','Status / Tarikh']];
  (ctx.sessions||[]).forEach(x=>rows.push(['Jadual',x.session_date+' '+x.start_time,x.verification_status||x.status]));
  (ctx.assignments||[]).forEach(x=>rows.push(['PB',x.title,x.due_at]));
  (ctx.calendarEvents||[]).forEach(x=>rows.push(['Kalendar',x.title,x.start_at]));
  const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='MySemester-RoleTest-Report.csv';a.click();URL.revokeObjectURL(a.href);
}
async function stopActiveRoleTest(returnToAdmin=true) {
  if(!activeRoleTest) return;
  const old=activeRoleTest;
  try { await api('stopRoleTest',{sessionId:old.sessionId}); }
  catch(error) { console.warn('Unable to close role test session:',error); }
  let closedLogs=[];
  if(returnToAdmin) {
    try { const history=await api('roleTestStatus',{sessionId:old.sessionId}); closedLogs=history.logs||[]; }
    catch(error) { console.warn('Unable to load closed test audit:',error); }
  }
  activeRoleTest=null;roleTestContextData=null;activeTestSemesterId=null;
  currentUser=authenticatedUser;
  if(returnToAdmin) {
    show('#previewBanner',false);show('#previewTestConsole',false);
    show('#studentView',false);show('#adminView',true);
    $('#admin-panel-preview').classList.remove('hidden');
    document.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab==='preview'));
    document.querySelectorAll('.admin-tab-panel').forEach(p=>p.classList.toggle('hidden',p.id!=='admin-panel-preview'));
    $('#roleTestHistory').innerHTML=closedLogs.map(log=>`<div class="test-audit-item"><strong>${escapeHtml(log.role)} / ${escapeHtml(log.action)}</strong> — ${escapeHtml(log.result)}<small>${escapeHtml(log.created_at||'')}</small></div>`).join('')||'Sesi ujian ditamatkan. Tiada log tambahan.';
    await loadAdminDashboard();
  }
}
async function loadRoleTestHistory() {
  const target=$('#roleTestHistory');
  if(!target) return;
  try {
    const result=await api('listRoleTestSessions',{});
    target.innerHTML=(result.items||[]).map(item=>`
      <div class="test-audit-item">
        <strong>${escapeHtml(item.role.toUpperCase())}</strong> · ${escapeHtml(item.status)}
        <small>${escapeHtml(item.test_user_id)} · ${escapeHtml(item.created_at||'')} · Tamat: ${escapeHtml(item.expires_at||'')}</small>
        <div class="test-actions">
          <button type="button" class="btn btn-light btn-small" data-test-history="${escapeHtml(item.session_id)}">Lihat log</button>
          ${item.status==='active'?`<button type="button" class="btn btn-light btn-small" data-close-test-session="${escapeHtml(item.session_id)}">Tamatkan sesi</button>`:''}
          <button type="button" class="btn btn-light btn-small" data-clear-history-sandbox="${escapeHtml(item.session_id)}">Kosongkan sandbox</button>
        </div>
      </div>`).join('')||'Belum ada sesi ujian.';
  } catch(error) { target.textContent='Gagal memuatkan sejarah ujian: '+error.message; }
}
$('#roleTestHistory')?.addEventListener('click',async e=>{
  if(e.target.closest('[data-test-history-back]')) { loadRoleTestHistory(); return; }
  const closeButton=e.target.closest('[data-close-test-session]');
  if(closeButton) {
    if(!confirm('Tamatkan akaun ujian sementara ini?')) return;
    try { await api('stopRoleTest',{sessionId:closeButton.dataset.closeTestSession}); await loadRoleTestHistory(); }
    catch(error) { $('#matrixMessage').textContent=error.message; }
    return;
  }
  const clearButton=e.target.closest('[data-clear-history-sandbox]');
  if(clearButton) {
    if(!confirm('Padam semua rekod sandbox untuk sesi ini? Log audit akan dikekalkan.')) return;
    try { const result=await api('clearRoleTestData',{sessionId:clearButton.dataset.clearHistorySandbox}); $('#matrixMessage').textContent=result.message; await loadRoleTestHistory(); }
    catch(error) { $('#matrixMessage').textContent=error.message; }
    return;
  }
  const button=e.target.closest('[data-test-history]');
  if(!button) return;
  try {
    const result=await api('roleTestStatus',{sessionId:button.dataset.testHistory});
    $('#roleTestHistory').innerHTML=`<button type="button" class="btn btn-light btn-small" data-test-history-back>← Kembali ke senarai sesi</button>`+
      ((result.logs||[]).map(log=>`<div class="test-audit-item"><strong>${escapeHtml(log.role)} / ${escapeHtml(log.action)}</strong> — ${escapeHtml(log.result)}<small>${escapeHtml(log.created_at||'')} · ${escapeHtml(log.entity_type||'')} ${escapeHtml(log.entity_id||'')}</small></div>`).join('')||'<p>Tiada log untuk sesi ini.</p>');
    $('#matrixMessage').textContent='Memaparkan log bagi sesi '+button.dataset.testHistory;
  } catch(error) { $('#matrixMessage').textContent=error.message; }
});

async function refreshRoleTestAudit() {
  if(!activeRoleTest) return;
  try {
    const result=await api('roleTestStatus',{sessionId:activeRoleTest.sessionId});
    const auditHtml=(result.logs||[]).map(log=>`<div class="test-audit-item"><strong>${escapeHtml(log.role||activeRoleTest.role)} / ${escapeHtml(log.action)}</strong> — ${escapeHtml(log.result)}<small>${escapeHtml(log.created_at||'')} • ${escapeHtml(log.entity_type||'')} ${escapeHtml(log.entity_id||'')}</small></div>`).join('')||'Belum ada aktiviti.';
    $('#previewTestAudit').innerHTML=auditHtml;
    if($('#roleLabAudit')) $('#roleLabAudit').innerHTML=auditHtml;
    $('#roleTestHistory').innerHTML=(result.logs||[]).slice(0,12).map(log=>`<div class="test-audit-item"><strong>${escapeHtml(log.role)} / ${escapeHtml(log.action)}</strong> — ${escapeHtml(log.result)}<small>${escapeHtml(log.created_at||'')}</small></div>`).join('')||'Belum ada sejarah ujian.';
  } catch(error) { $('#previewTestAudit').textContent=error.message; }
}
function testPayloadExample(action) {
  const ctx=roleTestContextData||{};
  const sem=(ctx.semesters||[]).find(x=>x.semester_id===activeTestSemesterId)||(ctx.semesters||[])[0]||{};
  const ss=(ctx.semesterSubjects||[]).find(x=>x.semester_id===sem.semester_id)||(ctx.semesterSubjects||[])[0]||{};
  const session=(ctx.sessions||[])[0]||{};
  const assignment=(ctx.assignments||[])[0]||{};
  const resource=(ctx.resources||[])[0]||{};
  const event=(ctx.calendarEvents||[])[0]||{};
  const member=(ctx.members||[]).find(x=>x.role==='student') || (ctx.members||[])[0] || {};
  const commonClass={classId:activeRoleTest?.classId||''};
  const examples={
    roleTestContext:{},
    listSchedules:{...commonClass,semesterId:sem.semester_id||''},
    createScheduleSession:{semesterSubjectId:ss.semester_subject_id||'GANTIKAN_SEMESTER_SUBJECT_ID',sessionDate:'2026-11-25',startTime:'09:00',endTime:'11:00',room:'Bilik Ujian',deliveryMode:'Bersemuka',sessionType:'Kuliah'},
    updateSchedule:{sessionId:session.session_id||'GANTIKAN_SESSION_ID',changes:{room:'Bilik Ujian MySemester'},reason:'Ujian akaun sementara'},
    verifySchedule:{sessionId:session.session_id||'GANTIKAN_SESSION_ID',status:'VERIFIED',comment:'Ujian pengesahan'},
    listAssignments:{...commonClass,semesterId:sem.semester_id||''},
    createAssignment:{semesterSubjectId:ss.semester_subject_id||'GANTIKAN_SEMESTER_SUBJECT_ID',title:'PB Ujian MySemester',assignmentType:'Penulisan',marksPercentage:10,description:'Rekod sandbox ujian'},
    updateProgress:{assignmentId:assignment.assignment_id||'GANTIKAN_ASSIGNMENT_ID',progress:{progress_status:'in_progress',progress_percentage:25,personal_notes:'Ujian kemajuan akaun sementara'}},
    listResources:{...commonClass,semesterSubjectId:ss.semester_subject_id||''},
    createCalendarEvent:{semesterId:sem.semester_id||'GANTIKAN_SEMESTER_ID',title:'Acara Ujian MySemester',eventCategory:'Ujian',startAt:'2026-11-20T09:00:00',endAt:'2026-11-20T10:00:00'},
    createSemester:{...commonClass,semesterName:'Semester Ujian Sandbox',academicSession:'Ujian',semesterNumber:(semestersCount(ctx)+1)},
    activateClass:{...commonClass},
    updateAssignment:{assignmentId:assignment.assignment_id||'GANTIKAN_ASSIGNMENT_ID',changes:{title:'PB Ujian Dikemas Kini',description:'Ujian kemas kini PB'}},
    recordAssignmentMark:{assignmentId:assignment.assignment_id||'GANTIKAN_ASSIGNMENT_ID',studentUserId:member.userId||'GANTIKAN_STUDENT_USER_ID',recordedMark:85,feedback:'Markah ujian sandbox'},
    createResourceLink:{semesterSubjectId:ss.semester_subject_id||'GANTIKAN_SEMESTER_SUBJECT_ID',resourceName:'Nota Ujian',url:'https://example.com/nota-ujian',description:'Pautan ujian sandbox'},
    updateResource:{resourceId:resource.resource_id||'GANTIKAN_RESOURCE_ID',changes:{resource_name:'Nota Ujian Dikemas Kini',description:'Ujian metadata'}},
    updateCalendarEvent:{eventId:event.event_id||'GANTIKAN_EVENT_ID',changes:{title:'Acara Ujian Dikemas Kini',description:'Ujian kalendar'}},
    listClassMembers:{...commonClass},
    manageClassMemberRole:{...commonClass,targetUserId:member.userId||'GANTIKAN_USER_ID',memberRole:'student'},
    classReport:{...commonClass},
    createClassNotification:{...commonClass,title:'Notifikasi Ujian',message:'Ini notifikasi sandbox ujian.',notificationType:'announcement'}
  };
  return JSON.stringify(examples[action]||{},null,2);
}
function semestersCount(ctx){return (ctx.semesters||[]).length;}
$('#matrixSaveBtn')?.addEventListener('click',savePermissionMatrix);
$('#matrixReloadBtn')?.addEventListener('click',loadRolePreviewConfig);
$('#startPreviewBtn')?.addEventListener('click',()=>startRolePreview());
$('#previewThisClassBtn')?.addEventListener('click',()=>{
  populatePreviewClasses();
  if(selectedAdminClassId) $('#previewClass').value=selectedAdminClassId;
  document.querySelector('[data-admin-tab="preview"]')?.click();
});
$('#previewRoleSwitch')?.addEventListener('change',e=>startRolePreview(e.target.value));
$('#semesterSwitch')?.addEventListener('change',e=>{activeTestSemesterId=e.target.value;renderRoleTestWorkspace();});
$('#exitPreviewBtn')?.addEventListener('click',()=>stopActiveRoleTest(true));
$('#previewTestAction')?.addEventListener('change',e=>{$('#previewTestPayload').value=testPayloadExample(e.target.value);});
$('#fillTestPayloadBtn')?.addEventListener('click',()=>{$('#previewTestPayload').value=testPayloadExample($('#previewTestAction').value);});
$('#runPreviewTestBtn')?.addEventListener('click',async()=>{
  if(!activeRoleTest) return;
  let data;
  try { data=JSON.parse($('#previewTestPayload').value||'{}'); }
  catch(error) { $('#previewTestResult').textContent='JSON tidak sah: '+error.message;return; }
  const action=$('#previewTestAction').value;
  $('#previewTestResult').textContent='Menjalankan '+action+' sebagai '+activeRoleTest.role+'...';
  try {
    const result=await api(action,data,activeRoleTest.token);
    $('#previewTestOutput').textContent=JSON.stringify(result,null,2);
    $('#previewTestResult').textContent='Ujian berjaya. Sebarang perubahan direkodkan dalam sandbox sesi ini.';
    await loadRoleTestContext();
  } catch(error) {
    $('#previewTestOutput').textContent=error.stack||error.message;
    $('#previewTestResult').textContent='Ujian ditolak / gagal: '+error.message;
    await refreshRoleTestAudit();
  }
});
$('#clearTestSandboxBtn')?.addEventListener('click',async()=>{
  if(!activeRoleTest || !confirm('Kosongkan semua perubahan sandbox bagi sesi ini? Data produksi tidak terjejas.')) return;
  try {
    const result=await api('clearRoleTestData',{sessionId:activeRoleTest.sessionId});
    $('#previewTestResult').textContent=result.message;
    $('#previewTestOutput').textContent='Sandbox dikosongkan.';
    await loadRoleTestContext();
  } catch(error) { $('#previewTestResult').textContent=error.message; }
});
$('#refreshTestAuditBtn')?.addEventListener('click',refreshRoleTestAudit);


/* Role workspace forms: all writes use the active test-session token when previewing. */
function workspaceApi(action,data) {
  return api(action,data,activeRoleTest?.token||'');
}
$('#sessionForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const data={semesterSubjectId:$('#sessSubject').value,sessionDate:$('#sessDate').value,
    startTime:$('#sessStart').value,endTime:$('#sessEnd').value,room:$('#sessRoom').value,
    deliveryMode:$('#sessMode').value,sessionType:$('#sessType').value};
  $('#sessMsg').textContent='Menyimpan sesi jadual dalam '+(activeRoleTest?'sandbox ujian':'ruang kerja')+'...';
  try {
    const result=await workspaceApi('createScheduleSession',data);
    $('#sessMsg').textContent=result.message||'Sesi berjaya direkodkan.';
    e.target.reset();await loadRoleTestContext();
  } catch(error) { $('#sessMsg').textContent=error.message; }
});
$('#assignmentForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const data={semesterSubjectId:$('#pbSubject').value,title:$('#pbTitle').value.trim(),
    assignmentCode:$('#pbCode').value.trim(),assignmentType:$('#pbType').value.trim(),
    marksPercentage:Number($('#pbMarks').value||0),submissionMethod:$('#pbMethod').value.trim(),
    startDate:$('#pbStart').value,dueAt:$('#pbDue').value,description:$('#pbDesc').value};
  $('#pbMsg').textContent='Menerbitkan PB...';
  try {
    const result=await workspaceApi('createAssignment',data);
    $('#pbMsg').textContent=result.message||'PB berjaya diterbitkan.';
    e.target.reset();await loadRoleTestContext();
  } catch(error) { $('#pbMsg').textContent=error.message; }
});
$('#eventForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const sem=(roleTestContextData?.semesters||[]).find(x=>x.semester_id===activeTestSemesterId)||(roleTestContextData?.semesters||[])[0];
  if(!sem) { $('#evMsg').textContent='Tiada semester tersedia untuk acara ini.';return; }
  const data={semesterId:sem.semester_id,semesterSubjectId:$('#evSubject').value||'',
    title:$('#evTitle').value.trim(),eventCategory:$('#evCategory').value,
    startAt:$('#evStart').value,endAt:$('#evEnd').value,description:$('#evDesc').value};
  $('#evMsg').textContent='Menyimpan acara kalendar...';
  try {
    const result=await workspaceApi('createCalendarEvent',data);
    $('#evMsg').textContent=result.message||'Acara berjaya ditambah.';
    e.target.reset();await loadRoleTestContext();
  } catch(error) { $('#evMsg').textContent=error.message; }
});


/* Interactive CRUD controls in the temporary role workspace. */
$('#roleLabNav')?.addEventListener('click',e=>{
  const tab=e.target.closest('[data-role-tab]'); if(!tab) return;
  activeRoleLabTab=tab.dataset.roleTab; renderRoleLabWorkspace();
});
$('#roleLabContent')?.addEventListener('change',e=>{
  if(e.target.id==='roleLabSemester') { activeTestSemesterId=e.target.value; renderRoleLabWorkspace(); }
});
$('#roleLabRefreshBtn')?.addEventListener('click',async()=>{await loadRoleTestContext();});
$('#roleLabAuditRefreshBtn')?.addEventListener('click',refreshRoleTestAudit);
$('#roleLabContent')?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-role-action]'); if(!btn) return;
  const action=btn.dataset.roleAction,id=btn.dataset.id;
  if(action==='close-editor') { $('#roleLabEditor').innerHTML='';roleLabEditing=null;return; }
  if(['new-schedule','edit-schedule','new-pb','edit-pb','progress-pb','mark-pb','new-resource','edit-resource','new-event','edit-event'].includes(action)) {
    roleLabOpenEditor(action,id); return;
  }
  if(action==='verify-schedule') {
    const comment=prompt('Catatan pengesahan (pilihan):','Disemak dalam sesi ujian');
    if(comment===null) return;
    try { await workspaceApi('verifySchedule',{sessionId:id,status:'VERIFIED',comment}); await loadRoleTestContext(); }
    catch(err){alert(err.message);} return;
  }
  if(['delete-schedule','delete-pb','delete-resource','delete-event'].includes(action)) {
    if(!confirm('Arkibkan rekod ini dalam sandbox sesi ujian?')) return;
    const map={'delete-schedule':['deleteSchedule',{sessionId:id}],'delete-pb':['deleteAssignment',{assignmentId:id}],
      'delete-resource':['deleteResource',{resourceId:id}],'delete-event':['deleteCalendarEvent',{eventId:id}]};
    try { const [apiAction,data]=map[action]; await workspaceApi(apiAction,data); await loadRoleTestContext(); }
    catch(err){alert(err.message);} return;
  }
  if(action==='save-member-role') {
    const select=document.querySelector(`[data-member-role="${CSS.escape(id)}"]`);
    try { await workspaceApi('manageClassMemberRole',{classId:activeRoleTest.classId,targetUserId:id,memberRole:select.value}); await loadRoleTestContext(); }
    catch(err){alert(err.message);} return;
  }
  if(action==='activate-class') {
    if(!confirm('Aktifkan kelas ini dalam sandbox sesi ujian?')) return;
    try { await workspaceApi('activateClass',{classId:activeRoleTest.classId}); await loadRoleTestContext(); alert('Permintaan pengaktifan berjaya diproses.'); }
    catch(err){alert(err.message);} return;
  }
  if(action==='export-report') { roleLabExportReport(); return; }
});
$('#roleLabContent')?.addEventListener('submit',async e=>{
  if(e.target.id==='roleLabSemesterForm') {
    e.preventDefault();const v=Object.fromEntries(new FormData(e.target).entries());
    try { await workspaceApi('createSemester',{classId:activeRoleTest.classId,semesterName:v.semesterName,academicSession:v.academicSession,semesterNumber:Number(v.semesterNumber),startDate:v.startDate,endDate:v.endDate});
      $('#roleLabSemesterMessage').textContent='Semester berjaya dicipta dalam sandbox.';await loadRoleTestContext(); }
    catch(err){$('#roleLabSemesterMessage').textContent=err.message;} return;
  }
  if(e.target.id==='roleLabNotificationForm') {
    e.preventDefault();const v=Object.fromEntries(new FormData(e.target).entries());
    try { await workspaceApi('createClassNotification',{classId:activeRoleTest.classId,title:v.title,message:v.message,notificationType:'role_test'});
      $('#roleLabNotificationMessage').textContent='Hebahan ujian direkodkan dalam sandbox.';e.target.reset();await loadRoleTestContext(); }
    catch(err){$('#roleLabNotificationMessage').textContent=err.message;} return;
  }
  if(e.target.id!=='roleLabCrudForm') return;
  e.preventDefault();
  if(!activeRoleTest || !roleLabEditing) return;
  const v=Object.fromEntries(new FormData(e.target).entries()), editing=roleLabEditing;
  const send=(action,data)=>workspaceApi(action,data);
  const message=$('#roleLabFormMessage'); if(message) message.textContent='Menyimpan perubahan sandbox...';
  try {
    if(editing.action.includes('schedule')) {
      if(editing.id) await send('updateSchedule',{sessionId:editing.id,changes:{session_date:v.sessionDate,start_time:v.startTime,end_time:v.endTime,room:v.room,delivery_mode:v.deliveryMode,session_type:v.sessionType},reason:v.reason});
      else await send('createScheduleSession',{semesterSubjectId:v.semesterSubjectId,sessionDate:v.sessionDate,startTime:v.startTime,endTime:v.endTime,room:v.room,deliveryMode:v.deliveryMode,sessionType:v.sessionType});
    } else if(editing.action==='progress-pb') {
      await send('updateProgress',{assignmentId:editing.id,progress:{progress_status:v.progress_status,progress_percentage:Number(v.progress_percentage),personal_due_at:v.personal_due_at,personal_notes:v.personal_notes}});
    } else if(editing.action==='mark-pb') {
      await send('recordAssignmentMark',{assignmentId:editing.id,studentUserId:v.studentUserId,recordedMark:Number(v.recordedMark),feedback:v.feedback});
    } else if(editing.action.includes('pb')) {
      if(editing.id) await send('updateAssignment',{assignmentId:editing.id,changes:{title:v.title,assignment_code:v.assignmentCode,assignment_type:v.assignmentType,marks_percentage:Number(v.marksPercentage),start_date:v.startDate,due_at:v.dueAt,submission_method:v.submissionMethod,description:v.description}});
      else await send('createAssignment',{semesterSubjectId:v.semesterSubjectId,title:v.title,assignmentCode:v.assignmentCode,assignmentType:v.assignmentType,marksPercentage:Number(v.marksPercentage),startDate:v.startDate,dueAt:v.dueAt,submissionMethod:v.submissionMethod,description:v.description});
    } else if(editing.action.includes('resource')) {
      if(editing.id) await send('updateResource',{resourceId:editing.id,changes:{resource_name:v.resourceName,storage_file_id:v.url,description:v.description}});
      else await send('createResourceLink',{semesterSubjectId:v.semesterSubjectId,resourceName:v.resourceName,url:v.url,description:v.description});
    } else if(editing.action.includes('event')) {
      if(editing.id) await send('updateCalendarEvent',{eventId:editing.id,changes:{title:v.title,event_category:v.eventCategory,start_at:v.startAt,end_at:v.endAt,description:v.description}});
      else {
        const sem=(roleTestContextData?.semesters||[]).find(x=>x.semester_id===activeTestSemesterId);
        await send('createCalendarEvent',{semesterId:sem?.semester_id,title:v.title,eventCategory:v.eventCategory,startAt:v.startAt,endAt:v.endAt,description:v.description});
      }
    }
    roleLabEditing=null;
    await loadRoleTestContext();
    const editor=$('#roleLabEditor'); if(editor) editor.innerHTML='<div class="role-lab-success">Perubahan berjaya disimpan dalam sandbox sesi ujian.</div>';
  } catch(err) { if(message) message.textContent='Tidak berjaya: '+err.message; }
});

/* ---------------- STUDENT WORKSPACE ---------------- */
$('#joinBtn').addEventListener('click',async()=>{
  const code=$('#inviteCode').value.trim();
  $('#joinMessage').textContent='Memproses...';
  try{const result=await api('joinClass',{inviteCode:code});$('#joinMessage').textContent=result.message;window.location.reload();}
  catch(error){$('#joinMessage').textContent=error.message;}
});
document.querySelectorAll('.student-tab').forEach(button=>{
  button.addEventListener('click',()=>{
    document.querySelectorAll('.student-tab').forEach(item=>item.classList.toggle('active',item===button));
    document.querySelectorAll('.student-tab-content').forEach(item=>item.classList.add('hidden'));
    $('#student-tab-'+button.dataset.tab).classList.remove('hidden');
  });
});

async function logoutMySemester(){
  if(activeRoleTest) {
    const old=activeRoleTest;
    try { await api('stopRoleTest',{sessionId:old.sessionId}); } catch(error) { console.warn('Unable to close test session:',error); }
    activeRoleTest=null;
  }
  if(devToken) { try { await api('devLogout',{}); } catch(error) { console.warn('Unable to revoke development session:',error); } }
  idToken=null;devToken=null;currentUser=null;authenticatedUser=null;currentClass=null;adminData=null;
  roleTestContextData=null;activeTestSemesterId=null;
  show('#appView',false);show('#loginView',true);
  if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();
}
$('#logoutBtn').addEventListener('click',logoutMySemester);
$('#logoutBtnStudent').addEventListener('click',logoutMySemester);
$('#refreshAdminBtn').addEventListener('click',loadAdminDashboard);
$('#clearCacheBtn')?.addEventListener('click',async()=>{
  const btn=$('#clearCacheBtn');
  btn.disabled=true;btn.textContent='Mengosongkan...';
  try {
    const r=await api('clearCache',{});
    showToast(r.message||'Cache berjaya dikosongkan.');
    await loadAdminDashboard();
  } catch(err) {
    showToast('Gagal mengosongkan cache: '+err.message,true);
  } finally {
    btn.disabled=false;btn.textContent='Kosongkan cache';
  }
});
