console.log('MySemester app.js v1.2 (top-postMessage fix) loaded');
let idToken = null;
let currentUser = null;
let authenticatedUser = null;
let currentClass = null;
let adminData = null;
let selectedAdminClassId = null;
let activeRoleTest = null;
let roleMatrixData = null;
let roleTestContextData = null;
let activeTestSemesterId = null;

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
  } catch(error) {
    idToken=null;
    setError(error.message||'Log masuk berjaya tetapi sambungan MySemester gagal.');
  } finally {
    $('#googleButton').classList.remove('disabled');
  }
}

function api(action,data,testSessionToken) {
  if(!idToken)return Promise.reject(new Error('Sila log masuk menggunakan Google dahulu.'));
  const apiUrl=MYSEMESTER_CONFIG.APPS_SCRIPT_URL;
  if(!apiUrl||!apiUrl.endsWith('/exec'))return Promise.reject(new Error('URL Apps Script tidak sah. Gunakan URL /exec.'));
  const requestId='r'+Date.now().toString(36)+Math.random().toString(36).slice(2,15);
  const payload={action,data,idToken,requestId};
  if(testSessionToken) payload.testSessionToken=testSessionToken;
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
    await loadRolePreviewConfig();
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
  const classId=$('#previewClass').value;
  const selectedRole=role||selectedPreviewRole();
  if(!classId) { $('#previewMessage').textContent='Sila pilih kelas terlebih dahulu.'; return; }
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
    show('#previewBanner',true);show('#previewTestConsole',true);
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
    $('#previewMessage').textContent=result.message;
    await loadRoleTestContext();
    await refreshRoleTestAudit();
    document.querySelectorAll('.student-tab').forEach((b,i)=>b.classList.toggle('active',i===0));
    document.querySelectorAll('.student-tab-content').forEach((el,i)=>el.classList.toggle('hidden',i!==0));
  } catch(error) {
    $('#previewMessage').textContent='Gagal memulakan ujian: '+error.message;
    if(!activeRoleTest) {
      show('#studentView',false);show('#previewBanner',false);show('#previewTestConsole',false);show('#adminView',true);
    }
  }
}
async function loadRoleTestContext() {
  if(!activeRoleTest) return;
  try {
    roleTestContextData=await api('roleTestContext',{},activeRoleTest.token);
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
    'pb.view':['class.view','semester.view'],'pb.create':['class.view','semester.view','pb.view'],
    'pb.edit':['class.view','semester.view','pb.view'],'pb.progress.update':['class.view','semester.view','pb.view'],
    'pb.marks.manage':['class.view','semester.view','pb.view'],
    'resources.view':['class.view','semester.view'],'resources.manage':['class.view','semester.view','resources.view'],
    'calendar.view':['class.view','semester.view'],'calendar.create':['class.view','semester.view','calendar.view'],
    'calendar.edit':['class.view','semester.view','calendar.view'],
    'members.view':['class.view'],'members.roles.manage':['class.view','members.view'],
    'reports.view':['class.view'],'notifications.manage':['class.view']
  };
  return enabled(permissionId) && (dependencies[permissionId]||[]).every(enabled);
}
function renderRoleTestWorkspace() {
  const ctx=roleTestContextData;
  if(!ctx) return;
  const semesters=ctx.semesters||[];
  const semester=semesters.find(x=>x.semester_id===activeTestSemesterId)||semesters[0]||null;
  activeTestSemesterId=semester?.semester_id||null;
  const ss=(ctx.semesterSubjects||[]).filter(x=>!semester || x.semester_id===semester.semester_id);
  const subjects=(ctx.subjects||[]).filter(x=>ss.some(item=>item.subject_id===x.subject_id));
  const semesterSubjectIds=ss.map(x=>x.semester_subject_id);
  const sessions=(ctx.sessions||[]).filter(x=>semesterSubjectIds.includes(x.semester_subject_id));
  const assignments=(ctx.assignments||[]).filter(x=>semesterSubjectIds.includes(x.semester_subject_id));
  const calendarEvents=(ctx.calendarEvents||[]).filter(x=>!semester || x.semester_id===semester.semester_id);
  const subjectById=Object.fromEntries(subjects.map(x=>[x.subject_id,x]));
  const ssById=Object.fromEntries(ss.map(x=>[x.semester_subject_id,x]));
  const subjectOptions=ss.map(item=>{
    const subject=subjectById[item.subject_id]||{};
    return `<option value="${escapeHtml(item.semester_subject_id)}">${escapeHtml(subject.subject_code||'')} ${escapeHtml(subject.subject_name||'Subjek')}</option>`;
  }).join('');
  ['#sessSubject','#pbSubject','#pbSubjectFilter','#evSubject'].forEach(selector=>{
    const el=$(selector);
    if(el) el.innerHTML=(selector==='#pbSubjectFilter'?'<option value="all">Semua subjek</option>':'<option value="">Pilih subjek</option>')+subjectOptions;
  });
  const semesterSwitch=$('#semesterSwitch');
  if(semesterSwitch) {
    semesterSwitch.classList.toggle('hidden',semesters.length<2);
    semesterSwitch.innerHTML=semesters.map(x=>`<option value="${escapeHtml(x.semester_id)}">${escapeHtml(x.semester_name)}</option>`).join('');
    if(activeTestSemesterId) semesterSwitch.value=activeTestSemesterId;
  }
  $('#overviewStats').innerHTML=[
    ['Semester',semesters.length],['Subjek',subjects.length],['Sesi jadual',sessions.length],['PB',assignments.length]
  ].map(x=>`<article class="stat"><span>${x[0]}</span><b>${x[1]}</b></article>`).join('');
  $('#overviewSubjects').innerHTML=ss.map(x=>{
    const sub=subjectById[x.subject_id]||{};
    const pb=assignments.filter(a=>a.semester_subject_id===x.semester_subject_id).length;
    return `<tr><td>${escapeHtml(sub.subject_code||'—')}</td><td>${escapeHtml(sub.subject_name||'Subjek')}</td><td>${escapeHtml(x.lecturer_user_id||'—')}</td><td>${pb}</td><td>—</td></tr>`;
  }).join('')||'<tr><td colspan="5">Belum ada subjek bagi semester ini.</td></tr>';
  $('#scheduleList').innerHTML=sessions.map(x=>`<div class="semester-row"><div><strong>${escapeHtml(x.session_date||'Tarikh belum ditetapkan')}</strong><small>${escapeHtml(x.start_time||'')}–${escapeHtml(x.end_time||'')} • ${escapeHtml(x.room||'')}</small></div><span class="status ${String(x.verification_status).toUpperCase()==='VERIFIED'?'active':'draft'}">${escapeHtml(x.verification_status||x.status||'—')}</span></div>`).join('')||'<p class="muted">Tiada sesi jadual direkodkan.</p>';
  $('#assignmentList').innerHTML=assignments.map(x=>`<div class="semester-row"><div><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.assignment_type||'PB')} • ${escapeHtml(x.due_at||'Tiada tarikh akhir')}</small></div><span class="status active">${escapeHtml(x.marks_percentage||0)}%</span></div>`).join('')||'<p class="muted">Tiada PB direkodkan.</p>';
  $('#calendarList').innerHTML=calendarEvents.map(x=>`<div class="semester-row"><div><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.start_at||'')}</small></div><span class="status draft">${escapeHtml(x.event_category||'')}</span></div>`).join('')||'<p class="muted">Tiada acara kalendar direkodkan.</p>';
  $('#overviewUpcoming').textContent='Paparan data ujian bagi '+(semester?.semester_name||'kelas ini')+'.';
  $('#sessionFormWrap').classList.toggle('hidden',!rolePermissionEnabled('schedule.edit'));
  $('#assignmentFormWrap').classList.toggle('hidden',!rolePermissionEnabled('pb.create'));
  $('#eventFormWrap').classList.toggle('hidden',!rolePermissionEnabled('calendar.create'));
  const tabRules={schedule:'schedule.view',assignments:'pb.view',calendar:'calendar.view'};
  document.querySelectorAll('.student-tab').forEach(tab=>{
    const permission=tabRules[tab.dataset.tab];
    if(permission) tab.classList.toggle('hidden',!rolePermissionEnabled(permission));
  });
  if(!ctx.permissions?.classView) {
    $('#overviewUpcoming').textContent='Akses ruang kerja kelas tidak dibenarkan oleh matriks kebenaran.';
    $('#overviewSubjects').innerHTML='<tr><td colspan="5">Akses disekat.</td></tr>';
  }
}
async function stopActiveRoleTest(returnToAdmin=true) {
  if(!activeRoleTest) return;
  const old=activeRoleTest;
  try { await api('stopRoleTest',{sessionId:old.sessionId}); }
  catch(error) { console.warn('Unable to close role test session:',error); }
  let closedLogs=[];
  try { const history=await api('roleTestStatus',{sessionId:old.sessionId}); closedLogs=history.logs||[]; }
  catch(error) { console.warn('Unable to load closed test audit:',error); }
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
    $('#previewTestAudit').innerHTML=(result.logs||[]).map(log=>`<div class="test-audit-item"><strong>${escapeHtml(log.action)}</strong> — ${escapeHtml(log.result)}<small>${escapeHtml(log.created_at||'')} • ${escapeHtml(log.entity_type||'')}</small></div>`).join('')||'Belum ada aktiviti.';
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
    await loadRoleTestContext();await refreshRoleTestAudit();
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
    await loadRoleTestContext();await refreshRoleTestAudit();
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
    e.target.reset();await loadRoleTestContext();await refreshRoleTestAudit();
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
    e.target.reset();await loadRoleTestContext();await refreshRoleTestAudit();
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
    e.target.reset();await loadRoleTestContext();await refreshRoleTestAudit();
  } catch(error) { $('#evMsg').textContent=error.message; }
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
  if(activeRoleTest) { const old=activeRoleTest; api('stopRoleTest',{sessionId:old.sessionId}).catch(()=>{}); activeRoleTest=null; }
  idToken=null;currentUser=null;authenticatedUser=null;currentClass=null;adminData=null;
  show('#appView',false);show('#loginView',true);
  if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();
}
$('#logoutBtn').addEventListener('click',logoutMySemester);
$('#logoutBtnStudent').addEventListener('click',logoutMySemester);
$('#refreshAdminBtn').addEventListener('click',loadAdminDashboard);
