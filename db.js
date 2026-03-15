/**
 * ╔══════════════════════════════════════════════════════════╗
 *  VIDYAM — Data Service Layer v2
 *  Primary  : Firebase Firestore (vidyam-e2567)
 *  Fallback : localStorage (offline support + auto-sync)
 *  Account  : singhmohal@gmail.com
 * ╚══════════════════════════════════════════════════════════╝
 */

const DB = window.DB = (() => {

  // ── FIREBASE CONFIG ───────────────────────────────────────
  const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyDL0W1VzjJjaL8088lrnZ3J613Ya6-YKbw",
    authDomain:        "vidyam-e2567.firebaseapp.com",
    projectId:         "vidyam-e2567",
    storageBucket:     "vidyam-e2567.firebasestorage.app",
    messagingSenderId: "239816985208",
    appId:             "1:239816985208:web:76cacc443149627368fb8d",
  };

  // ── CONSTANTS ─────────────────────────────────────────────
  const CLASS_ORDER = ['class6','class7','class8','class9','class10'];
  const CLASSES_DEFAULT = {
    class6:  { name: 'Class 6',  students: [] },
    class7:  { name: 'Class 7',  students: [] },
    class8:  { name: 'Class 8',  students: [] },
    class9:  { name: 'Class 9',  students: [] },
    class10: { name: 'Class 10', students: [] },
  };
  const CREDS_DEFAULT = { username: 'Devasangeeta', password: 'sangeeta@99' };

  // ── FIRESTORE REST API BASE ───────────────────────────────
  // We use Firestore REST API directly — no npm needed, works in plain HTML
  const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

  // ── LOCAL STORAGE HELPERS ─────────────────────────────────
  function ls(k)       { try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} }

  // ── OFFLINE SYNC QUEUE ────────────────────────────────────
  function enqueue(fn, args) {
    const q = ls('vs_queue') || [];
    q.push({ fn, args, ts: Date.now() });
    lsSet('vs_queue', q);
  }
  async function flushQueue() {
    const q = ls('vs_queue') || [];
    if (!q.length) return;
    const failed = [];
    for (const item of q) {
      try {
        await WRITE_FNS[item.fn](...item.args);
      } catch(e) {
        failed.push(item);
      }
    }
    lsSet('vs_queue', failed);
  }
  window.addEventListener('online', () => setTimeout(flushQueue, 1000));

  // ── FIRESTORE REST HELPERS ────────────────────────────────
  // Convert JS value to Firestore field value
  function toFS(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number')  return { integerValue: String(val) };
    if (typeof val === 'string')  return { stringValue: val };
    if (Array.isArray(val))       return { arrayValue: { values: val.map(toFS) } };
    if (typeof val === 'object')  return { mapValue: { fields: objToFS(val) } };
    return { stringValue: String(val) };
  }
  function objToFS(obj) {
    const fields = {};
    for (const k in obj) {
      if (obj.hasOwnProperty(k)) fields[k] = toFS(obj[k]);
    }
    return fields;
  }

  // Convert Firestore field value to JS value
  function fromFS(val) {
    if (!val) return null;
    if ('nullValue'    in val) return null;
    if ('booleanValue' in val) return val.booleanValue;
    if ('integerValue' in val) return Number(val.integerValue);
    if ('doubleValue'  in val) return val.doubleValue;
    if ('stringValue'  in val) return val.stringValue;
    if ('arrayValue'   in val) return (val.arrayValue.values || []).map(fromFS);
    if ('mapValue'     in val) return fsToObj(val.mapValue.fields || {});
    return null;
  }
  function fsToObj(fields) {
    const obj = {};
    for (const k in fields) obj[k] = fromFS(fields[k]);
    return obj;
  }

  // GET a document
  async function fsGet(path) {
    const res = await fetch(`${FS_BASE}/${path}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore GET failed: ${res.status}`);
    const doc = await res.json();
    return doc.fields ? fsToObj(doc.fields) : null;
  }

  // SET (create/overwrite) a document
  async function fsSet(path, data) {
    const body = { fields: objToFS(data) };
    const res = await fetch(`${FS_BASE}/${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Firestore SET failed: ${res.status}`);
    return true;
  }

  // DELETE a document
  async function fsDelete(path) {
    const res = await fetch(`${FS_BASE}/${path}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Firestore DELETE failed: ${res.status}`);
    return true;
  }

  // LIST documents in a collection
  async function fsList(collection) {
    const res = await fetch(`${FS_BASE}/${collection}`);
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.documents) return [];
    return json.documents.map(doc => ({
      id: doc.name.split('/').pop(),
      ...fsToObj(doc.fields || {}),
    }));
  }

  // ── AUTH ──────────────────────────────────────────────────
  function getCreds()      { return ls('vs_creds') || CREDS_DEFAULT; }
  function saveCreds(u, p) { lsSet('vs_creds', { username: u, password: p }); }
  function isLoggedIn()    { return !!sessionStorage.getItem('vs_auth'); }
  function setLoggedIn()   { sessionStorage.setItem('vs_auth', '1'); }
  function logout()        { sessionStorage.removeItem('vs_auth'); }

  // ── THEME ─────────────────────────────────────────────────
  function getTheme()      { return localStorage.getItem('vs_theme') || 'light'; }
  function setTheme(t)     { localStorage.setItem('vs_theme', t); }

  // ── CLASSES ───────────────────────────────────────────────
  function getClasses()    { return ls('vs_classes') || { ...CLASSES_DEFAULT }; }
  function _saveClasses(c) { lsSet('vs_classes', c); }

  // ── STUDENTS ──────────────────────────────────────────────
  function getStudents(classId) {
    const c = getClasses();
    return (c[classId] && c[classId].students) ? [...c[classId].students] : [];
  }

  async function _pushStudents(classId, students) {
    await fsSet(`students/${classId}`, { classId, students });
  }

  async function addStudent(classId, name) {
    const c = getClasses();
    if (!c[classId]) return false;
    if (c[classId].students.find(s => s.toLowerCase() === name.toLowerCase())) return false;
    c[classId].students.push(name);
    _saveClasses(c);
    try {
      await _pushStudents(classId, c[classId].students);
    } catch(e) {
      enqueue('_pushStudents', [classId, c[classId].students]);
    }
    return true;
  }

  async function removeStudent(classId, idx) {
    const c = getClasses();
    if (!c[classId]) return;
    c[classId].students.splice(idx, 1);
    _saveClasses(c);
    try {
      await _pushStudents(classId, c[classId].students);
    } catch(e) {
      enqueue('_pushStudents', [classId, c[classId].students]);
    }
  }

  async function syncStudentsFromFirebase() {
    try {
      const c = getClasses();
      for (const classId of CLASS_ORDER) {
        const doc = await fsGet(`students/${classId}`);
        if (doc && Array.isArray(doc.students)) {
          c[classId].students = doc.students;
        }
      }
      _saveClasses(c);
    } catch(e) {
      // offline — use local
    }
  }

  // ── ATTENDANCE ────────────────────────────────────────────
  function _attLocalKey(classId, date) { return `vs_att_${classId}_${date}`; }
  function _attFSPath(classId, date)   { return `attendance/${classId}_${date}`; }

  function getAttendance(classId, date) {
    return ls(_attLocalKey(classId, date)) || { morning: {}, lunch: {} };
  }

  async function setAttendanceMark(classId, date, session, studentIdx, value) {
    const rec = getAttendance(classId, date);
    if (rec[session][studentIdx] === value) {
      delete rec[session][studentIdx];
    } else {
      rec[session][studentIdx] = value;
    }
    lsSet(_attLocalKey(classId, date), rec);
    try {
      await fsSet(_attFSPath(classId, date), { classId, date, morning: rec.morning, lunch: rec.lunch });
    } catch(e) {
      enqueue('_pushAttendance', [classId, date, rec]);
    }
  }

  async function markAllAttendance(classId, date, session, value, count) {
    const rec = getAttendance(classId, date);
    for (let i = 0; i < count; i++) rec[session][i] = value;
    lsSet(_attLocalKey(classId, date), rec);
    try {
      await fsSet(_attFSPath(classId, date), { classId, date, morning: rec.morning, lunch: rec.lunch });
    } catch(e) {
      enqueue('_pushAttendance', [classId, date, rec]);
    }
  }

  async function _pushAttendance(classId, date, rec) {
    await fsSet(_attFSPath(classId, date), { classId, date, morning: rec.morning, lunch: rec.lunch });
  }

  function getDatesWithAttendance(classId) {
    const dates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`vs_att_${classId}_`)) {
        const date = key.replace(`vs_att_${classId}_`, '');
        const rec  = ls(key) || {};
        if (Object.keys(rec.morning||{}).length > 0 || Object.keys(rec.lunch||{}).length > 0) {
          dates.push(date);
        }
      }
    }
    return dates.sort();
  }

  function getAttendanceReport(classId) {
    const students = getStudents(classId);
    const dates    = getDatesWithAttendance(classId);
    return students.map((name, i) => {
      let mP=0,mA=0,lP=0,lA=0;
      dates.forEach(d => {
        const rec = getAttendance(classId, d);
        if (rec.morning[i]==='P') mP++; else if (rec.morning[i]==='A') mA++;
        if (rec.lunch[i]==='P')   lP++; else if (rec.lunch[i]==='A')   lA++;
      });
      return { name, mP, mA, lP, lA, totalDays: dates.length };
    });
  }

  async function syncAttendanceFromFirebase(classId, date) {
    try {
      const doc = await fsGet(_attFSPath(classId, date));
      if (doc) lsSet(_attLocalKey(classId, date), { morning: doc.morning || {}, lunch: doc.lunch || {} });
    } catch(e) { /* use local */ }
  }

  // ── PROFILES ──────────────────────────────────────────────
  function getProfiles(classId) {
    const all = ls('vs_profiles') || [];
    return classId ? all.filter(p => p.classId === classId) : all;
  }

  async function saveProfile(profile) {
    const all = ls('vs_profiles') || [];
    if (!profile.id) {
      profile.id = 'stu_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    }
    const idx = all.findIndex(p => p.id === profile.id);
    if (idx > -1) all[idx] = profile; else all.push(profile);
    lsSet('vs_profiles', all);
    try {
      await fsSet(`profiles/${profile.id}`, profile);
    } catch(e) {
      enqueue('_pushProfile', [profile]);
    }
    return profile;
  }

  async function _pushProfile(profile) {
    await fsSet(`profiles/${profile.id}`, profile);
  }

  async function deleteProfile(id) {
    const all = (ls('vs_profiles') || []).filter(p => p.id !== id);
    lsSet('vs_profiles', all);
    try {
      await fsDelete(`profiles/${id}`);
    } catch(e) {
      enqueue('_deleteProfile', [id]);
    }
  }

  async function _deleteProfile(id) {
    await fsDelete(`profiles/${id}`);
  }

  async function syncProfilesFromFirebase() {
    try {
      const docs = await fsList('profiles');
      if (docs.length) lsSet('vs_profiles', docs);
    } catch(e) { /* use local */ }
  }

  // ── WRITE FNS MAP (for queue replay) ─────────────────────
  const WRITE_FNS = {
    _pushStudents,
    _pushAttendance,
    _pushProfile,
    _deleteProfile,
  };

  // ── PING ──────────────────────────────────────────────────
  async function ping() {
    try {
      const res = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)`);
      return { ok: res.ok };
    } catch(e) {
      return { ok: false };
    }
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    // Auth
    getCreds, saveCreds, isLoggedIn, setLoggedIn, logout,
    // Theme
    getTheme, setTheme,
    // Classes
    getClasses, CLASS_ORDER,
    // Students
    getStudents, addStudent, removeStudent, syncStudentsFromFirebase,
    // Attendance
    getAttendance, setAttendanceMark, markAllAttendance,
    getDatesWithAttendance, getAttendanceReport, syncAttendanceFromFirebase,
    // Profiles
    getProfiles, saveProfile, deleteProfile, syncProfilesFromFirebase,
    // Sync
    flushQueue, ping,
    isOnline: () => navigator.onLine,
  };

})();
