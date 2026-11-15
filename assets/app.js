let idToken = null;
let currentUser = null;
let currentClass = null;

const $ = (selector) => document.querySelector(selector);
function show(selector, visible) { $(selector).classList.toggle('hidden', !visible); }
function setError(message) { $('#loginError').textContent = message || ''; }

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
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (window.google?.accounts?.id) {
      clearInterval(timer);
      initializeGoogleSignIn();
    } else if (attempts >= 20) {
      clearInterval(timer);
      setError('Tidak dapat memuatkan Google Sign-In. Semak sambungan internet atau sekatan browser.');
    }
  }, 250);
});

async function onGoogleCredential(response) {
  idToken = response.credential;
  setError('');
  $('#googleButton').classList.add('disabled');
  try {
    const result = await api('bootstrap', {});
    currentUser = result.user;
    $('#welcomeName').textContent = 'Selamat datang, ' + (currentUser.name || 'pengguna');
    $('#welcomeEmail').textContent = currentUser.email;
    $('#profile').textContent = currentUser.email + (result.isSystemAdmin ? ' • SYSTEM ADMIN' : '');
    show('#loginView', false);
    show('#appView', true);

    if (result.isSystemAdmin) {
      show('#adminNotice', true);
    }

    if (result.classes && result.classes.length) {
      currentClass = result.classes[0];
      $('#className').textContent = currentClass.className;
      $('#classCode').textContent = 'Kod kelas: ' + currentClass.classCode;
      show('#classArea', true);
      show('#noClass', false);
    } else {
      show('#noClass', true);
      show('#classArea', false);
    }
  } catch (error) {
    idToken = null;
    setError(error.message || 'Log masuk berjaya tetapi sambungan ke MySemester gagal.');
  } finally {
    $('#googleButton').classList.remove('disabled');
  }
}

/**
 * Apps Script POST is submitted through a form to a hidden iframe.
 * The result is read through JSONP polling. IMPORTANT: callback name
 * is read exactly from the URL; do not prepend "mscb" a second time.
 */
function api(action, data) {
  if (!idToken) return Promise.reject(new Error('Sila log masuk menggunakan Google dahulu.'));
  const apiUrl = MYSEMESTER_CONFIG.APPS_SCRIPT_URL;
  if (!apiUrl || !apiUrl.endsWith('/exec')) {
    return Promise.reject(new Error('URL Apps Script tidak sah. Gunakan URL deployment yang berakhir dengan /exec.'));
  }

  const requestId = 'r' + Date.now().toString(36) +
    Math.random().toString(36).slice(2, 15);
  const payload = { action, data, idToken, requestId };

  return new Promise((resolve, reject) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = apiUrl;
    form.target = 'apiFrame';
    form.style.display = 'none';

    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = 'payload';
    field.value = JSON.stringify(payload);
    form.appendChild(field);
    document.body.appendChild(form);
    form.submit();
    form.remove();

    let attempts = 0;
    let finished = false;
    const maxAttempts = 24;

    const poll = () => {
      if (finished) return;
      attempts++;

      const callbackName = 'mscb_' + requestId.replace(/[^a-zA-Z0-9_$]/g, '');
      const pollUrl = apiUrl +
        '?action=poll&requestId=' + encodeURIComponent(requestId) +
        '&callback=' + encodeURIComponent(callbackName) +
        '&_=' + Date.now();

      jsonp(pollUrl, (result) => {
        if (result && result.pending && attempts < maxAttempts) {
          window.setTimeout(poll, 500);
          return;
        }
        finished = true;
        if (result && result.ok) {
          resolve(result);
        } else {
          reject(new Error((result && result.error) ||
            'Tiada respons daripada Apps Script. Semak deployment Web App dan kebenaran akses Anyone.'));
        }
      }, (error) => {
        if (attempts < maxAttempts) {
          window.setTimeout(poll, 700);
        } else {
          finished = true;
          reject(new Error(
            'Apps Script tidak dapat dicapai (kemungkinan HTTP 403). ' +
            'Deploy semula sebagai Web App, Execute as Me, Who has access: Anyone. ' +
            'Pastikan URL /exec terkini. ' + (error || '')
          ));
        }
      });
    };

    window.setTimeout(poll, 800);
  });
}

function jsonp(url, onSuccess, onError) {
  let callbackName;
  try {
    const parsed = new URL(url);
    callbackName = parsed.searchParams.get('callback');
  } catch (error) {
    onError('URL polling tidak sah.');
    return;
  }

  if (!callbackName || !/^[A-Za-z_$][\w$]*$/.test(callbackName)) {
    onError('Nama JSONP callback tidak sah.');
    return;
  }

  let completed = false;
  const script = document.createElement('script');
  const cleanup = () => {
    if (completed) return;
    completed = true;
    window.clearTimeout(timeoutId);
    try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
    script.remove();
  };

  window[callbackName] = (data) => {
    cleanup();
    onSuccess(data);
  };

  script.async = true;
  script.src = url;
  script.onerror = () => {
    cleanup();
    onError('JSONP request gagal dimuatkan. Semak akses deployment Apps Script.');
  };

  const timeoutId = window.setTimeout(() => {
    cleanup();
    onError('Permintaan polling tamat masa.');
  }, 8000);

  document.body.appendChild(script);
}

$('#joinBtn').addEventListener('click', async () => {
  const code = $('#inviteCode').value.trim();
  $('#joinMessage').textContent = 'Memproses...';
  try {
    const result = await api('joinClass', { inviteCode: code });
    $('#joinMessage').textContent = result.message;
    window.location.reload();
  } catch (error) {
    $('#joinMessage').textContent = error.message;
  }
});

$('#logoutBtn').addEventListener('click', () => {
  idToken = null;
  currentUser = null;
  currentClass = null;
  show('#appView', false);
  show('#loginView', true);
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
});

document.querySelectorAll('.tab').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(item =>
      item.classList.toggle('active', item === button));
    document.querySelectorAll('.tab-content').forEach(item =>
      item.classList.add('hidden'));
    $('#tab-' + button.dataset.tab).classList.remove('hidden');
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('service-worker.js').catch(() => {}));
}
