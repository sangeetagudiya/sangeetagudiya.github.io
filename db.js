/**
 * ╔══════════════════════════════════════════════════════╗
 *  VIDYA SETU — Data Service Layer  (v1 · localStorage)
 *  ─────────────────────────────────────────────────────
 *  To switch to Firebase / Google Sheets later:
 *  Replace the functions below with Firebase SDK calls.
 *  The rest of the app (attendance.html, students.html)
 *  does NOT need to change — it only calls these methods.
 * ╚══════════════════════════════════════════════════════╝
 */

const DB = window.DB = (() => {

  // ── KEYS ──────────────────────────────────────────────
  const K = {
    CREDS:    'vs_creds',
    CLASSES:  'vs_classes',     // { classId: { name, students:[] } }
    ATTEND:   'vs_attendance',  // { "classId|date": { morning:{i:P/A}, lunch:{i:P/A} } }
    PROFILES: 'vs_profiles',    // [ { id, classId, name, ...fields } ]
    THEME:    'vs_theme',
    AUTH:     'vs_auth',        // sessionStorage
  };

  const CLASSES_DEFAULT = {
    'class6':  { name: 'Class 6',  students: [] },
    'class7':  { name: 'Class 7',  students: [] },
    'class8':  { name: 'Class 8',  students: [] },
    'class9':  { name: 'Class 9',  students: [] },
    'class10': { name: 'Class 10', students: [] },
  };

  const CREDS_DEFAULT = { username: 'Devasangeeta', password: 'sangeeta@99' };

  // ── HELPERS ───────────────────────────────────────────
  function ls(key)        { try { return JSON.parse(localStorage.getItem(key)); } catch(e) { return null; } }
  function lsSet(key, v)  { localStorage.setItem(key, JSON.stringify(v)); }

  // ── AUTH ──────────────────────────────────────────────
  function getCreds()           { return ls(K.CREDS) || CREDS_DEFAULT; }
  function saveCreds(u, p)      { lsSet(K.CREDS, { username: u, password: p }); }
  function isLoggedIn()         { return !!sessionStorage.getItem(K.AUTH); }
  function setLoggedIn()        { sessionStorage.setItem(K.AUTH, '1'); }
  function logout()             { sessionStorage.removeItem(K.AUTH); }

  // ── CLASSES & STUDENTS ────────────────────────────────
  function getClasses()         { return ls(K.CLASSES) || { ...CLASSES_DEFAULT }; }
  function saveClasses(data)    { lsSet(K.CLASSES, data); }

  function getClassIds()        { return Object.keys(getClasses()); }

  function getStudents(classId) {
    const c = getClasses();
    return (c[classId] && c[classId].students) ? c[classId].students : [];
  }

  function addStudent(classId, name) {
    const c = getClasses();
    if (!c[classId]) return false;
    if (c[classId].students.find(s => s.toLowerCase() === name.toLowerCase())) return false;
    c[classId].students.push(name);
    saveClasses(c);
    return true;
  }

  function removeStudent(classId, idx) {
    const c = getClasses();
    if (!c[classId]) return;
    c[classId].students.splice(idx, 1);
    saveClasses(c);
  }

  // ── ATTENDANCE ────────────────────────────────────────
  function getAttendance(classId, date) {
    const all = ls(K.ATTEND) || {};
    return all[`${classId}|${date}`] || { morning: {}, lunch: {} };
  }

  function setAttendanceMark(classId, date, session, studentIdx, value) {
    const all = ls(K.ATTEND) || {};
    const key = `${classId}|${date}`;
    if (!all[key]) all[key] = { morning: {}, lunch: {} };
    // Toggle off if same value
    if (all[key][session][studentIdx] === value) {
      delete all[key][session][studentIdx];
    } else {
      all[key][session][studentIdx] = value;
    }
    lsSet(K.ATTEND, all);
  }

  function markAllAttendance(classId, date, session, value, count) {
    const all = ls(K.ATTEND) || {};
    const key = `${classId}|${date}`;
    if (!all[key]) all[key] = { morning: {}, lunch: {} };
    for (let i = 0; i < count; i++) all[key][session][i] = value;
    lsSet(K.ATTEND, all);
  }

  function getDatesWithAttendance(classId) {
    const all = ls(K.ATTEND) || {};
    return Object.keys(all)
      .filter(k => k.startsWith(classId + '|') && (
        Object.keys(all[k].morning || {}).length > 0 ||
        Object.keys(all[k].lunch || {}).length > 0
      ))
      .map(k => k.split('|')[1]);
  }

  function getAttendanceReport(classId) {
    const all = ls(K.ATTEND) || {};
    const students = getStudents(classId);
    const dates = Object.keys(all)
      .filter(k => k.startsWith(classId + '|'))
      .map(k => k.split('|')[1])
      .sort();

    return students.map((name, i) => {
      let mP=0, mA=0, lP=0, lA=0;
      dates.forEach(d => {
        const rec = all[`${classId}|${d}`] || { morning:{}, lunch:{} };
        if (rec.morning[i] === 'P') mP++; else if (rec.morning[i] === 'A') mA++;
        if (rec.lunch[i]   === 'P') lP++; else if (rec.lunch[i]   === 'A') lA++;
      });
      return { name, mP, mA, lP, lA, totalDays: dates.length };
    });
  }

  // ── STUDENT PROFILES ──────────────────────────────────
  function getProfiles(classId) {
    const all = ls(K.PROFILES) || [];
    return classId ? all.filter(p => p.classId === classId) : all;
  }

  function saveProfile(profile) {
    const all = ls(K.PROFILES) || [];
    if (profile.id) {
      const idx = all.findIndex(p => p.id === profile.id);
      if (idx > -1) all[idx] = profile; else all.push(profile);
    } else {
      profile.id = 'stu_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
      all.push(profile);
    }
    lsSet(K.PROFILES, all);
    return profile;
  }

  function deleteProfile(id) {
    const all = (ls(K.PROFILES) || []).filter(p => p.id !== id);
    lsSet(K.PROFILES, all);
  }

  // ── THEME ─────────────────────────────────────────────
  function getTheme()       { return localStorage.getItem(K.THEME) || 'light'; }
  function setTheme(t)      { localStorage.setItem(K.THEME, t); }

  // ── PUBLIC API ────────────────────────────────────────
  return {
    // Auth
    getCreds, saveCreds, isLoggedIn, setLoggedIn, logout,
    // Classes
    getClasses, getClassIds, getStudents, addStudent, removeStudent,
    // Attendance
    getAttendance, setAttendanceMark, markAllAttendance,
    getDatesWithAttendance, getAttendanceReport,
    // Profiles
    getProfiles, saveProfile, deleteProfile,
    // Theme
    getTheme, setTheme,
    // Class list (ordered)
    CLASS_ORDER: ['class6','class7','class8','class9','class10'],
  };
})();
