/**
 * ╔══════════════════════════════════════════════════════════╗
 *  SANGEETAM PORTAL — Data Service Layer v4
 *
 *  ARCHITECTURE:
 *  ─────────────
 *  Firebase Firestore = SINGLE SOURCE OF TRUTH
 *  localStorage       = instant display cache only
 *
 *  Every write  → Firebase first, then cache
 *  Every read   → Firebase first, cache as fallback
 *  Real-time    → polls Firebase every 3 seconds
 *  Any device   → always shows live Firebase data
 *
 *  Account: singhmohal@gmail.com · Project: vidyam-e2567
 * ╚══════════════════════════════════════════════════════════╝
 */
const DB = window.DB = (() => {

  // ── CONFIG ────────────────────────────────────────────────
  const PID  = 'vidyam-e2567';
  const AKEY = 'AIzaSyDL0W1VzjJjaL8088lrnZ3J613Ya6-YKbw';
  const FS   = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents`;
  const POLL_INTERVAL = 3000; // 3 seconds real-time sync

  const CLASS_ORDER = ['class6','class7','class8','class9','class10'];
  const CLASSES_DEFAULT = {
    class6:{name:'Class 6',students:[]},
    class7:{name:'Class 7',students:[]},
    class8:{name:'Class 8',students:[]},
    class9:{name:'Class 9',students:[]},
    class10:{name:'Class 10',students:[]},
  };
  const DCREDS = { username:'Devasangeeta', password:'sangeeta@99' };

  // ── CACHE (localStorage — display only) ───────────────────
  function ls(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } }
  function lsSet(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} }

  // ── FIRESTORE REST ────────────────────────────────────────
  function fsUrl(p)    { return `${FS}/${p}?key=${AKEY}`; }
  function fsListUrl(c){ return `${FS}/${c}?key=${AKEY}&pageSize=500`; }

  function toFS(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number')  return { integerValue: String(v) };
    if (typeof v === 'string')  return { stringValue: v };
    if (Array.isArray(v))       return { arrayValue: { values: v.map(toFS) } };
    if (typeof v === 'object')  return { mapValue: { fields: objToFS(v) } };
    return { stringValue: String(v) };
  }
  function objToFS(o) {
    const f = {};
    for (const k in o) if (o.hasOwnProperty(k)) f[k] = toFS(o[k]);
    return f;
  }
  function fromFS(v) {
    if (!v) return null;
    if ('nullValue'    in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return v.doubleValue;
    if ('stringValue'  in v) return v.stringValue;
    if ('arrayValue'   in v) return (v.arrayValue.values||[]).map(fromFS);
    if ('mapValue'     in v) {
      const o = {};
      for (const k in (v.mapValue.fields||{})) o[k] = fromFS(v.mapValue.fields[k]);
      return o;
    }
    return null;
  }

  // Core Firebase operations
  async function fsGet(path) {
    const res = await fetch(fsUrl(path));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${res.status}`);
    const doc = await res.json();
    return doc.fields ? fromFS({ mapValue: { fields: doc.fields } }) : null;
  }
  async function fsSet(path, data) {
    const res = await fetch(fsUrl(path), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objToFS(data) })
    });
    if (!res.ok) throw new Error(`SET ${res.status}`);
    return true;
  }
  async function fsDel(path) {
    const res = await fetch(fsUrl(path), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`DEL ${res.status}`);
    return true;
  }
  async function fsList(col) {
    const res = await fetch(fsListUrl(col));
    if (!res.ok) return [];
    const json = await res.json();
    return (json.documents||[]).map(d => ({
      id: d.name.split('/').pop(),
      ...fromFS({ mapValue: { fields: d.fields||{} } })
    }));
  }

  // ── OFFLINE QUEUE ─────────────────────────────────────────
  function enqueue(op) {
    const q = ls('sp_queue') || [];
    q.push({ ...op, ts: Date.now() });
    lsSet('sp_queue', q);
  }
  async function flushQueue() {
    const q = ls('sp_queue') || [];
    if (!q.length) return;
    const failed = [];
    for (const op of q) {
      try {
        if (op.type === 'set') await fsSet(op.path, op.data);
        if (op.type === 'del') await fsDel(op.path);
      } catch(e) { failed.push(op); }
    }
    lsSet('sp_queue', failed);
    if (failed.length < q.length) triggerRefresh();
  }
  window.addEventListener('online', () => setTimeout(flushQueue, 1000));

  // Safe write — tries Firebase, queues if offline
  async function safeSet(path, data) {
    lsSet('sp_fb_' + path.replace(/\//g,'_'), data); // instant cache
    try { await fsSet(path, data); }
    catch(e) { enqueue({ type:'set', path, data }); }
  }
  async function safeDel(path) {
    lsSet('sp_fb_' + path.replace(/\//g,'_'), null);
    try { await fsDel(path); }
    catch(e) { enqueue({ type:'del', path }); }
  }

  // ── REAL-TIME POLLING ─────────────────────────────────────
  let _pollCallback = null;   // set by attendance.html
  let _pollClass    = null;
  let _pollDate     = null;
  let _pollTimer    = null;
  let _lastHash     = '';

  function startPolling(classId, date, callback) {
    _pollCallback = callback;
    _pollClass    = classId;
    _pollDate     = date;
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(pollNow, POLL_INTERVAL);
    pollNow(); // immediate first poll
  }

  function updatePollTarget(classId, date) {
    _pollClass = classId;
    _pollDate  = date;
    _lastHash  = ''; // force refresh on target change
    pollNow();
  }

  function stopPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
  }

  async function pollNow() {
    if (!_pollClass || !_pollDate || !_pollCallback) return;
    if (!navigator.onLine) return;
    try {
      // Fetch attendance for current class + date
      const attDoc = await fsGet(`attendance/${_pollClass}_${_pollDate}`);
      const att = attDoc ? { morning: attDoc.morning||{}, lunch: attDoc.lunch||{} } : { morning:{}, lunch:{} };

      // Fetch students for current class
      const stuDoc = await fsGet(`students/${_pollClass}`);
      const students = stuDoc && Array.isArray(stuDoc.students) ? stuDoc.students : getStudents(_pollClass);

      // Create hash to detect changes
      const hash = JSON.stringify({ att, students });
      if (hash === _lastHash) return; // no change — skip UI update
      _lastHash = hash;

      // Update cache
      lsSet(`sp_att_${_pollClass}_${_pollDate}`, att);
      const c = getClasses();
      c[_pollClass].students = students;
      _saveClasses(c);

      // Trigger UI refresh
      _pollCallback({ classId: _pollClass, date: _pollDate, att, students });
    } catch(e) {
      // Offline or error — silently use cache
    }
  }

  // Full sync — pulls everything from Firebase
  async function fullSync() {
    if (!navigator.onLine) return false;
    try {
      // Students
      const c = getClasses();
      for (const cid of CLASS_ORDER) {
        const doc = await fsGet(`students/${cid}`);
        if (doc && Array.isArray(doc.students)) c[cid].students = doc.students;
      }
      _saveClasses(c);

      // Profiles
      const profiles = await fsList('profiles');
      if (profiles.length) lsSet('sp_profiles', profiles.filter(p => !p.deleted));

      // Attendance (recent 60 days)
      const attDocs = await fsList('attendance');
      attDocs.forEach(doc => {
        if (doc.classId && doc.date)
          lsSet(`sp_att_${doc.classId}_${doc.date}`, { morning: doc.morning||{}, lunch: doc.lunch||{} });
      });

      triggerRefresh();
      return true;
    } catch(e) { return false; }
  }

  // Callback registry for full refresh
  let _refreshCallback = null;
  function onRefresh(cb) { _refreshCallback = cb; }
  function triggerRefresh() { if (_refreshCallback) _refreshCallback(); }

  // ── AUTH ──────────────────────────────────────────────────
  function getCreds()      { return ls('sp_creds') || DCREDS; }
  function saveCreds(u, p) { lsSet('sp_creds', { username:u, password:p }); }
  function isLoggedIn()    { return !!localStorage.getItem('sp_auth'); }
  function setLoggedIn()   { localStorage.setItem('sp_auth', '1'); }
  function logout()        {
    localStorage.removeItem('sp_auth');
    localStorage.removeItem('vs_selected_class');
    stopPolling();
  }
  function getPin()        { return localStorage.getItem('sp_pin') || '58690'; }
  function setPin(p)       { localStorage.setItem('sp_pin', p); }
  function getTheme()      { return localStorage.getItem('sp_theme') || 'light'; }
  function setTheme(t)     { localStorage.setItem('sp_theme', t); }

  // ── CLASSES ───────────────────────────────────────────────
  function getClasses()    { return ls('sp_classes') || { ...CLASSES_DEFAULT }; }
  function _saveClasses(c) { lsSet('sp_classes', c); }

  // ── STUDENTS ──────────────────────────────────────────────
  function getStudents(cid) {
    const c = getClasses();
    return (c[cid] && Array.isArray(c[cid].students)) ? [...c[cid].students] : [];
  }

  async function addStudent(cid, name) {
    const trimmed = name.trim();
    if (!trimmed) return { ok:false, reason:'empty' };

    // Always fetch fresh from Firebase first
    let students = [];
    try {
      const doc = await fsGet(`students/${cid}`);
      students = (doc && Array.isArray(doc.students)) ? doc.students : getStudents(cid);
    } catch(e) { students = getStudents(cid); }

    if (students.find(s => s.toLowerCase() === trimmed.toLowerCase()))
      return { ok:false, reason:'duplicate' };

    students.push(trimmed);

    // Update cache
    const c = getClasses();
    c[cid].students = students;
    _saveClasses(c);

    // Write to Firebase
    await safeSet(`students/${cid}`, { classId:cid, students, updatedAt:Date.now() });

    // Auto-create profile
    const pid = `stu_${cid}_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
    const profile = { id:pid, name:trimmed, classId:cid, profileComplete:false, createdAt:Date.now(), deleted:false };
    const allProfiles = ls('sp_profiles') || [];
    allProfiles.push(profile);
    lsSet('sp_profiles', allProfiles);
    await safeSet(`profiles/${pid}`, profile);

    _lastHash = ''; // force poll refresh
    return { ok:true, profile };
  }

  async function removeStudent(cid, idx) {
    // Always get fresh list from Firebase
    let students = [];
    try {
      const doc = await fsGet(`students/${cid}`);
      students = (doc && Array.isArray(doc.students)) ? [...doc.students] : getStudents(cid);
    } catch(e) { students = getStudents(cid); }

    if (idx < 0 || idx >= students.length) return;
    const name = students[idx];
    students.splice(idx, 1);

    // Update cache
    const c = getClasses();
    c[cid].students = students;
    _saveClasses(c);

    // Write to Firebase
    await safeSet(`students/${cid}`, { classId:cid, students, updatedAt:Date.now() });

    // Delete linked profile
    const allProfiles = ls('sp_profiles') || [];
    const profile = allProfiles.find(p => p.name.toLowerCase()===name.toLowerCase() && p.classId===cid && !p.deleted);
    if (profile) {
      lsSet('sp_profiles', allProfiles.filter(p => !(p.name.toLowerCase()===name.toLowerCase() && p.classId===cid)));
      await safeDel(`profiles/${profile.id}`);
    }

    _lastHash = '';
    return name;
  }

  // ── ATTENDANCE ────────────────────────────────────────────
  function _attKey(cid, date) { return `sp_att_${cid}_${date}`; }

  // Always read from Firebase, fall back to cache
  async function getAttFresh(cid, date) {
    try {
      const doc = await fsGet(`attendance/${cid}_${date}`);
      if (doc) {
        const rec = { morning: doc.morning||{}, lunch: doc.lunch||{} };
        lsSet(_attKey(cid, date), rec);
        return rec;
      }
    } catch(e) {}
    return ls(_attKey(cid, date)) || { morning:{}, lunch:{} };
  }

  // Cache read (instant, for immediate display)
  function getAtt(cid, date) {
    return ls(_attKey(cid, date)) || { morning:{}, lunch:{} };
  }

  async function setMark(cid, date, sess, idx, val) {
    // Get fresh from Firebase first to avoid overwriting another device's changes
    const rec = await getAttFresh(cid, date);
    if (rec[sess][idx] === val) delete rec[sess][idx];
    else rec[sess][idx] = val;
    lsSet(_attKey(cid, date), rec);
    await safeSet(`attendance/${cid}_${date}`, { classId:cid, date, morning:rec.morning, lunch:rec.lunch, updatedAt:Date.now() });
    _lastHash = '';
  }

  async function markAllAtt(cid, date, sess, val, count) {
    const rec = getAtt(cid, date);
    if (!rec[sess]) rec[sess] = {};
    for (let i=0; i<count; i++) rec[sess][i] = val;
    lsSet(_attKey(cid, date), rec);
    await safeSet(`attendance/${cid}_${date}`, { classId:cid, date, morning:rec.morning, lunch:rec.lunch, updatedAt:Date.now() });
    _lastHash = '';
  }

  function getDatesWithAtt(cid) {
    const dates = [];
    for (let i=0; i<localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`sp_att_${cid}_`)) {
        const date = k.replace(`sp_att_${cid}_`, '');
        const rec  = ls(k) || {};
        if (Object.keys(rec.morning||{}).length || Object.keys(rec.lunch||{}).length) dates.push(date);
      }
    }
    return dates.sort();
  }

  function getReport(cid) {
    const students = getStudents(cid);
    const dates    = getDatesWithAtt(cid);
    return students.map((name, i) => {
      let mP=0,mA=0,lP=0,lA=0;
      dates.forEach(d => {
        const rec = getAtt(cid, d);
        if (rec.morning[i]==='P') mP++; else if (rec.morning[i]==='A') mA++;
        if (rec.lunch[i]==='P')   lP++; else if (rec.lunch[i]==='A')   lA++;
      });
      return { name, mP, mA, lP, lA, totalDays:dates.length };
    });
  }

  // ── PROFILES ──────────────────────────────────────────────
  function getProfiles(cid) {
    const all = (ls('sp_profiles') || []).filter(p => !p.deleted);
    return cid ? all.filter(p => p.classId === cid) : all;
  }

  async function saveProfile(profile) {
    const all = ls('sp_profiles') || [];
    const idx = all.findIndex(p => p.id === profile.id);
    profile.profileComplete = true;
    profile.updatedAt = Date.now();
    if (idx > -1) all[idx] = profile; else all.push(profile);
    lsSet('sp_profiles', all);
    await safeSet(`profiles/${profile.id}`, profile);
    return profile;
  }

  // ── INTEGRITY CHECK ───────────────────────────────────────
  function runIntegrityCheck() {
    const classes     = getClasses();
    const allProfiles = ls('sp_profiles') || [];
    let changed = false;
    CLASS_ORDER.forEach(cid => {
      (classes[cid]?.students || []).forEach(name => {
        const exists = allProfiles.find(p => p.name.toLowerCase()===name.toLowerCase() && p.classId===cid && !p.deleted);
        if (!exists) {
          const pid = `stu_${cid}_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
          allProfiles.push({ id:pid, name, classId:cid, profileComplete:false, createdAt:Date.now(), deleted:false, recovered:true });
          safeSet(`profiles/${pid}`, allProfiles[allProfiles.length-1]);
          changed = true;
        }
      });
    });
    allProfiles.forEach(p => {
      if (p.deleted) return;
      const cls = classes[p.classId];
      if (!cls) { p.deleted=true; changed=true; return; }
      if (!cls.students.find(s => s.toLowerCase()===p.name.toLowerCase())) {
        p.deleted=true; safeDel(`profiles/${p.id}`); changed=true;
      }
    });
    if (changed) lsSet('sp_profiles', allProfiles);
  }
  setTimeout(runIntegrityCheck, 3000);
  setInterval(runIntegrityCheck, 5*60*1000);

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    CLASS_ORDER,
    getCreds, saveCreds, isLoggedIn, setLoggedIn, logout,
    getPin, setPin, getTheme, setTheme,
    getClasses, getStudents, addStudent, removeStudent,
    getAtt, getAttFresh, setMark, markAllAtt, getDatesWithAtt, getReport,
    getProfiles, saveProfile,
    fullSync, pollNow, startPolling, stopPolling, updatePollTarget, onRefresh,
    flushQueue, runIntegrityCheck,
    isOnline: () => navigator.onLine,
  };

})();
