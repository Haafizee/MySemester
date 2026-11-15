console.log('MySemester app.js v1.2 (top-postMessage fix) loaded');
let idToken = null;
let currentUser = null;
let currentClass = null;
let adminData = null;
let selectedAdminClassId = null;

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

function initializeGoogleSignIn() {
  if (!window.google || !google.accounts || !google.accounts.id) {
    setError('Google Sign-In belum dimuatkan. Sila refresh halaman.');
    return;
  }
  if (!MYSEMESTER_CONFIG.GOOGLE_CLIENT_ID ||
      MYSEMESTER_CONFIG.GOOGLE_CLIENT_ID.includes('PASTE_')) {
    setError('Google Client ID belum dikonfigurasikan dalam config.js.');
    return;
  }
  google.accounts.id.initialize({
    client_id: MYSEMESTER_CONFIG.GOOGLE_CLIENT_ID,
    callback: onGoogleCredential,
    auto_select: false
  });
  google.accounts.id.renderButton($('#googleButton'), {
    theme: 'outline', size: 'large', shape: 'pill',
    text: 'continue_with', width: 260
  });
}
window.addEventListener('load', () => {
  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(window.google?.accounts?.id){clearInterval(timer);initializeGoogleSignIn();}
    else if(attempts>=20){clearInterval(timer);setError('Tidak dapat memuatkan Google Sign-In. Semak sambungan internet.');}
  },250);
});

async function onGoogleCredential(response) {
  idToken=response.credential;
  setError('');
  $('#googleButton').classList.add('disabled');
  try {
    const result=await api('bootstrap',{});
    currentUser=result.user;
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
  } catch(error) {
    idToken=null;
    setError(error.message||'Log masuk berjaya tetapi sambungan MySemester gagal.');
  } finally {
    $('#googleButton').classList.remove('disabled');
  }
}

function api(action,data) {
  if(!idToken)return Promise.reject(new Error('Sila log masuk menggunakan Google dahulu.'));
  const apiUrl=MYSEMESTER_CONFIG.APPS_SCRIPT_URL;
  if(!apiUrl||!apiUrl.endsWith('/exec'))return Promise.reject(new Error('URL Apps Script tidak sah. Gunakan URL /exec.'));
  const requestId='r'+Date.now().toString(36)+Math.random().toString(36).slice(2,15);
  const payload={action,data,idToken,requestId};
  const frame=document.getElementById('apiFrame');

  return new Promise((resolve,reject)=>{
    let finished=false;
    let timeoutId;
    const cleanup=()=>{window.removeEventListener('message',onMessage);window.clearTimeout(timeoutId);};
    const onMessage=(event)=>{
      // The reply comes from a nested Google iframe (not apiFrame itself), so event.source
      // can never equal frame.contentWindow. The random requestId is what authenticates it.
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
      reject(new Error('Tiada respons daripada Apps Script dalam 30 saat. Semak deployment Web App dan versi Code.gs.'));
    },30000);

    const form=document.createElement('form');
    form.method='POST';form.action=apiUrl;form.target='apiFrame';form.style.display='none';
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
  });
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

function logoutMySemester(){
  idToken=null;currentUser=null;currentClass=null;adminData=null;
  show('#appView',false);show('#loginView',true);
  if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();
}
$('#logoutBtn').addEventListener('click',logoutMySemester);
$('#logoutBtnStudent').addEventListener('click',logoutMySemester);
$('#refreshAdminBtn').addEventListener('click',loadAdminDashboard);
