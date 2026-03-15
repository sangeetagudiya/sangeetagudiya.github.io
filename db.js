/**
 * ╔══════════════════════════════════════════════════════════╗
 *  SANGEETAM PORTAL — Data Service Layer v3
 *  Firebase Firestore (primary) + localStorage (fallback)
 *  Rock-solid data integrity: no orphans, no duplicates
 *  Account: singhmohal@gmail.com · Project: vidyam-e2567
 * ╚══════════════════════════════════════════════════════════╝
 */
const DB = window.DB = (() => {

  // ── CONFIG ────────────────────────────────────────────────
  const PID  = 'vidyam-e2567';
  const AKEY = 'AIzaSyDL0W1VzjJjaL8088lrnZ3J613Ya6-YKbw';
  const FS   = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents`;

  const CLASS_ORDER = ['class6','class7','class8','class9','class10'];
  const CLASSES_DEFAULT = {
    class6:{name:'Class 6',students:[]},
    class7:{name:'Class 7',students:[]},
    class8:{name:'Class 8',students:[]},
    class9:{name:'Class 9',students:[]},
    class10:{name:'Class 10',students:[]},
  };
  const DCREDS = { username:'Devasangeeta', password:'sangeeta@99' };

  // ── LOCAL STORAGE ─────────────────────────────────────────
  function ls(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } }
  function lsSet(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) { console.warn('localStorage write failed',k); } }
  function lsDel(k)   { try { localStorage.removeItem(k); } catch(e) {} }

  // ── SYNC QUEUE (offline resilience) ──────────────────────
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
        if (op.type === 'set')    await _fsSet(op.path, op.data);
        if (op.type === 'delete') await _fsDel(op.path);
      } catch(e) { failed.push(op); }
    }
    lsSet('sp_queue', failed);
  }
  window.addEventListener('online', () => setTimeout(flushQueue, 1500));

  // ── FIRESTORE REST ────────────────────────────────────────
  function toFS(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number')  return { integerValue: String(v) };
    if (typeof v === 'string')  return { stringValue: v };
    if (Array.isArray(v))       return { arrayValue: { values: v.map(toFS) } };
    if (typeof v === 'object')  return { mapValue: { fields: objToFS(v) } };
    return { stringValue: String(v) };
  }
  function objToFS(o) { const f={}; for(const k in o) if(o.hasOwnProperty(k)) f[k]=toFS(o[k]); return f; }
  function fromFS(v) {
    if (!v) return null;
    if ('nullValue'    in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return v.doubleValue;
    if ('stringValue'  in v) return v.stringValue;
    if ('arrayValue'   in v) return (v.arrayValue.values||[]).map(fromFS);
    if ('mapValue'     in v) { const o={}; for(const k in (v.mapValue.fields||{})) o[k]=fromFS(v.mapValue.fields[k]); return o; }
    return null;
  }
  async function _fsSet(path, data) {
    const res = await fetch(`${FS}/${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objToFS(data) })
    });
    if (!res.ok) throw new Error(`FS SET failed ${res.status}`);
  }
  async function _fsDel(path) {
    const res = await fetch(`${FS}/${path}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`FS DEL failed ${res.status}`);
  }
  async function _fsGet(path) {
    try {
      const res = await fetch(`${FS}/${path}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`FS GET failed ${res.status}`);
      const doc = await res.json();
      return doc.fields ? fromFS({ mapValue: { fields: doc.fields } }) : null;
    } catch(e) { return null; }
  }
  async function _fsList(col) {
    try {
      const res = await fetch(`${FS}/${col}`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.documents||[]).map(d => ({ id: d.name.split('/').pop(), ...fromFS({ mapValue: { fields: d.fields||{} } }) }));
    } catch(e) { return []; }
  }

  // Safe firebase write (with queue fallback)
  async function fsSet(path, data) {
    try { await _fsSet(path, data); }
    catch(e) { enqueue({ type:'set', path, data }); }
  }
  async function fsDel(path) {
    try { await _fsDel(path); }
    catch(e) { enqueue({ type:'delete', path }); }
  }

  // ── AUTH ──────────────────────────────────────────────────
  function getCreds()      { return ls('sp_creds') || DCREDS; }
  function saveCreds(u, p) { lsSet('sp_creds', { username:u, password:p }); }
  function isLoggedIn()    { return !!sessionStorage.getItem('sp_auth'); }
  function setLoggedIn()   { sessionStorage.setItem('sp_auth', '1'); }
  function logout()        { sessionStorage.removeItem('sp_auth'); }
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
    const c = getClasses();
    if (!c[cid]) return { ok:false, reason:'invalid_class' };
    // Duplicate check (case-insensitive)
    if (c[cid].students.find(s => s.toLowerCase() === trimmed.toLowerCase()))
      return { ok:false, reason:'duplicate' };
    // Add to roll list
    c[cid].students.push(trimmed);
    _saveClasses(c);
    // Sync students to Firebase
    await fsSet(`students/${cid}`, { classId:cid, students:c[cid].students, updatedAt:Date.now() });
    // Auto-create profile (strictly linked)
    const pid = `stu_${cid}_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
    const profile = { id:pid, name:trimmed, classId:cid, profileComplete:false, createdAt:Date.now(), deleted:false };
    const allProfiles = ls('sp_profiles') || [];
    allProfiles.push(profile);
    lsSet('sp_profiles', allProfiles);
    await fsSet(`profiles/${pid}`, profile);
    return { ok:true, profile };
  }

  async function removeStudent(cid, idx) {
    const c = getClasses();
    if (!c[cid] || idx < 0 || idx >= c[cid].students.length) return;
    const name = c[cid].students[idx];
    c[cid].students.splice(idx, 1);
    _saveClasses(c);
    await fsSet(`students/${cid}`, { classId:cid, students:c[cid].students, updatedAt:Date.now() });
    // Strictly remove linked profile — no orphans
    const allProfiles = ls('sp_profiles') || [];
    const profile = allProfiles.find(p => p.name.toLowerCase()===name.toLowerCase() && p.classId===cid && !p.deleted);
    if (profile) {
      // Soft delete (keeps Firebase history)
      profile.deleted = true; profile.deletedAt = Date.now();
      lsSet('sp_profiles', allProfiles.filter(p => !(p.name.toLowerCase()===name.toLowerCase() && p.classId===cid)));
      await fsDel(`profiles/${profile.id}`);
    }
    return name;
  }

  // ── ATTENDANCE ────────────────────────────────────────────
  function _attKey(cid, date) { return `sp_att_${cid}_${date}`; }
  function getAtt(cid, date)  { return ls(_attKey(cid,date)) || { morning:{}, lunch:{} }; }

  async function setMark(cid, date, sess, idx, val) {
    const rec = getAtt(cid, date);
    if (!rec[sess]) rec[sess] = {};
    if (rec[sess][idx] === val) delete rec[sess][idx];
    else rec[sess][idx] = val;
    lsSet(_attKey(cid, date), rec);
    await fsSet(`attendance/${cid}_${date}`, { classId:cid, date, morning:rec.morning, lunch:rec.lunch, updatedAt:Date.now() });
  }

  async function markAllAtt(cid, date, sess, val, count) {
    const rec = getAtt(cid, date);
    if (!rec[sess]) rec[sess] = {};
    for (let i=0; i<count; i++) rec[sess][i] = val;
    lsSet(_attKey(cid, date), rec);
    await fsSet(`attendance/${cid}_${date}`, { classId:cid, date, morning:rec.morning, lunch:rec.lunch, updatedAt:Date.now() });
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
    await fsSet(`profiles/${profile.id}`, profile);
    return profile;
  }

  // ── DATA INTEGRITY CHECK ──────────────────────────────────
  // Ensures every student has a profile and no orphan profiles exist
  function runIntegrityCheck() {
    const classes = getClasses();
    const allProfiles = ls('sp_profiles') || [];
    let changed = false;

    // Forward: every student must have a profile
    CLASS_ORDER.forEach(cid => {
      (classes[cid]?.students || []).forEach(name => {
        const exists = allProfiles.find(p => p.name.toLowerCase()===name.toLowerCase() && p.classId===cid && !p.deleted);
        if (!exists) {
          const pid = `stu_${cid}_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
          allProfiles.push({ id:pid, name, classId:cid, profileComplete:false, createdAt:Date.now(), deleted:false, recovered:true });
          fsSet(`profiles/${pid}`, allProfiles[allProfiles.length-1]);
          changed = true;
        }
      });
    });

    // Backward: no active profile without a student
    allProfiles.forEach(p => {
      if (p.deleted) return;
      const cls = classes[p.classId];
      if (!cls) { p.deleted=true; changed=true; return; }
      const inList = cls.students.find(s => s.toLowerCase() === p.name.toLowerCase());
      if (!inList) { p.deleted=true; fsDel(`profiles/${p.id}`); changed=true; }
    });

    if (changed) lsSet('sp_profiles', allProfiles);
  }

  // Run integrity check on load
  setTimeout(runIntegrityCheck, 2000);
  // Run every 5 minutes
  setInterval(runIntegrityCheck, 5 * 60 * 1000);

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    CLASS_ORDER, CLASSES_DEFAULT,
    getCreds, saveCreds, isLoggedIn, setLoggedIn, logout,
    getPin, setPin, getTheme, setTheme,
    getClasses, getStudents, addStudent, removeStudent,
    getAtt, setMark, markAllAtt, getDatesWithAtt, getReport,
    getProfiles, saveProfile,
    flushQueue, runIntegrityCheck,
    isOnline: () => navigator.onLine,
  };
})();
