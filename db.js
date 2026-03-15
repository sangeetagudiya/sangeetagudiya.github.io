/**
 * ╔══════════════════════════════════════════════════════════╗
 *  VIDYAM — Data Service Layer
 *  Primary:  Google Sheets (singhmohal@gmail.com)
 *  Fallback: localStorage (works offline, auto-syncs)
 * ╚══════════════════════════════════════════════════════════╝
 */

const DB = window.DB = (() => {

  // ── CONFIG ────────────────────────────────────────────────
  const API = 'https://script.google.com/macros/s/AKfycbz5eWyW7S2Bsq2qef_FyBCZtEM1cJywqmFL___LTi5CKmYV-7U617YyYS1PEC1D9iQV/exec';

  const CLASS_ORDER   = ['class6','class7','class8','class9','class10'];
  const CLASSES_DEFAULT = {
    class6:  { name: 'Class 6',  students: [] },
    class7:  { name: 'Class 7',  students: [] },
    class8:  { name: 'Class 8',  students: [] },
    class9:  { name: 'Class 9',  students: [] },
    class10: { name: 'Class 10', students: [] },
  };
  const CREDS_DEFAULT = { username: 'Devasangeeta', password: 'sangeeta@99' };

  // ── LOCAL STORAGE HELPERS ─────────────────────────────────
  function ls(k)       { try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} }

  // ── OFFLINE QUEUE ─────────────────────────────────────────
  // Any write that fails while offline gets queued and retried
  function enqueue(action, payload) {
    const q = ls('vs_sync_queue') || [];
    q.push({ action, payload, ts: Date.now() });
    lsSet('vs_sync_queue', q);
  }
  async function flushQueue() {
    const q = ls('vs_sync_queue') || [];
    if (!q.length) return;
    const remaining = [];
    for (const item of q) {
      try {
        await apiPost(item.action, item.payload);
      } catch(e) {
        remaining.push(item);
      }
    }
    lsSet('vs_sync_queue', remaining);
  }

  // ── API HELPERS ───────────────────────────────────────────
  async function apiGet(action, params = {}) {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`${API}?${qs}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.data?.error || 'API error');
    return json.data;
  }

  async function apiPost(action, body = {}) {
    const res = await fetch(API, {
      method: 'POST',
      body: JSON.stringify({ action, ...body }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.data?.error || 'API error');
    return json.data;
  }

  function isOnline() { return navigator.onLine; }

  // Flush queue whenever connection is restored
  window.addEventListener('online', () => {
    flushQueue();
  });

  // ── AUTH ──────────────────────────────────────────────────
  function getCreds()        { return ls('vs_creds') || CREDS_DEFAULT; }
  function saveCreds(u, p)   { lsSet('vs_creds', { username: u, password: p }); }
  function isLoggedIn()      { return !!sessionStorage.getItem('vs_auth'); }
  function setLoggedIn()     { sessionStorage.setItem('vs_auth', '1'); }
  function logout()          { sessionStorage.removeItem('vs_auth'); }

  // ── THEME ─────────────────────────────────────────────────
  function getTheme()        { return localStorage.getItem('vs_theme') || 'light'; }
  function setTheme(t)       { localStorage.setItem('vs_theme', t); }

  // ── CLASSES (local only — structure doesn't change) ───────
  function getClasses()      { return ls('vs_classes') || { ...CLASSES_DEFAULT }; }
  function _saveClasses(c)   { lsSet('vs_classes', c); }

  // ── STUDENTS ──────────────────────────────────────────────
  function getStudents(classId) {
    const c = getClasses();
    return (c[classId] && c[classId].students) ? c[classId].students : [];
  }

  async function addStudent(classId, name) {
    const c = getClasses();
    if (!c[classId]) return false;
    if (c[classId].students.find(s => s.toLowerCase() === name.toLowerCase())) return false;
    c[classId].students.push(name);
    _saveClasses(c);
    // Sync to Google Sheets
    const students = c[classId].students;
    try {
      await apiPost('saveStudents', { classId, students });
    } catch(e) {
      enqueue('saveStudents', { classId, students });
    }
    return true;
  }

  async function removeStudent(classId, idx) {
    const c = getClasses();
    if (!c[classId]) return;
    c[classId].students.splice(idx, 1);
    _saveClasses(c);
    const students = c[classId].students;
    try {
      await apiPost('saveStudents', { classId, students });
    } catch(e) {
      enqueue('saveStudents', { classId, students });
    }
  }

  // Load students from Sheets into localStorage (call on app start)
  async function syncStudentsFromSheets() {
    try {
      const c = getClasses();
      for (const classId of CLASS_ORDER) {
        const data = await apiGet('getStudents', { classId });
        if (data && Array.isArray(data.students)) {
          c[classId].students = data.students;
        }
      }
      _saveClasses(c);
    } catch(e) {
      // offline — use local data
    }
  }

  // ── ATTENDANCE ────────────────────────────────────────────
  function _attKey(classId, date) { return `vs_att_${classId}_${date}`; }

  function getAttendance(classId, date) {
    return ls(_attKey(classId, date)) || { morning: {}, lunch: {} };
  }

  async function setAttendanceMark(classId, date, session, studentIdx, value) {
    const rec = getAttendance(classId, date);
    if (rec[session][studentIdx] === value) {
      delete rec[session][studentIdx];
    } else {
      rec[session][studentIdx] = value;
    }
    lsSet(_attKey(classId, date), rec);
    // Sync session to Sheets
    try {
      await apiPost('saveAttendance', { classId, date, session, data: rec[session] });
    } catch(e) {
      enqueue('saveAttendance', { classId, date, session, data: rec[session] });
    }
  }

  async function markAllAttendance(classId, date, session, value, count) {
    const rec = getAttendance(classId, date);
    for (let i = 0; i < count; i++) rec[session][i] = value;
    lsSet(_attKey(classId, date), rec);
    try {
      await apiPost('saveAttendance', { classId, date, session, data: rec[session] });
    } catch(e) {
      enqueue('saveAttendance', { classId, date, session, data: rec[session] });
    }
  }

  function getDatesWithAttendance(classId) {
    // Read from localStorage keys
    const dates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`vs_att_${classId}_`)) {
        const date = key.replace(`vs_att_${classId}_`, '');
        const rec  = ls(key) || {};
        if (Object.keys(rec.morning || {}).length > 0 || Object.keys(rec.lunch || {}).length > 0) {
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

  // Load attendance for a date from Sheets (called when switching date)
  async function syncAttendanceFromSheets(classId, date) {
    try {
      const data = await apiGet('getAttendance', { classId, date });
      if (data) lsSet(_attKey(classId, date), data);
    } catch(e) {
      // use local
    }
  }

  // ── PROFILES ─────────────────────────────────────────────
  function getProfiles(classId) {
    const all = ls('vs_profiles') || [];
    return classId ? all.filter(p => p.classId === classId) : all;
  }

  async function saveProfile(profile) {
    const all = ls('vs_profiles') || [];
    if (profile.id) {
      const idx = all.findIndex(p => p.id === profile.id);
      if (idx > -1) all[idx] = profile; else all.push(profile);
    } else {
      profile.id = 'stu_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
      all.push(profile);
    }
    lsSet('vs_profiles', all);
    try {
      await apiPost('saveProfile', { profile });
    } catch(e) {
      enqueue('saveProfile', { profile });
    }
    return profile;
  }

  async function deleteProfile(id) {
    const all = (ls('vs_profiles') || []).filter(p => p.id !== id);
    lsSet('vs_profiles', all);
    try {
      await apiPost('deleteProfile', { id });
    } catch(e) {
      enqueue('deleteProfile', { id });
    }
  }

  async function syncProfilesFromSheets() {
    try {
      const data = await apiGet('getProfiles', {});
      if (data && Array.isArray(data.profiles)) {
        lsSet('vs_profiles', data.profiles);
      }
    } catch(e) {
      // use local
    }
  }

  // ── PING (test connection) ─────────────────────────────────
  async function ping() {
    try {
      const data = await apiGet('ping');
      return data;
    } catch(e) {
      return { ok: false, error: e.toString() };
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
    getStudents, addStudent, removeStudent, syncStudentsFromSheets,
    // Attendance
    getAttendance, setAttendanceMark, markAllAttendance,
    getDatesWithAttendance, getAttendanceReport, syncAttendanceFromSheets,
    // Profiles
    getProfiles, saveProfile, deleteProfile, syncProfilesFromSheets,
    // Sync
    flushQueue, ping,
    // Online check
    isOnline,
  };

})();
