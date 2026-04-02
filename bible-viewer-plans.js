/**
 * Bible Viewer — Firebase auth, Firestore plan progress & Scripture notes,
 * community chats (Creature Habits). Loaded as ES module from Bible Viewer.html.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, signOut,
  signInWithCustomToken
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, addDoc, getDocs, getDoc,
  query, orderBy, serverTimestamp, updateDoc, where, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';

/**
 * Firebase web config. The API key is a client key (meant for browsers) but should still be
 * restricted to your domains in Google Cloud Console; rotate it if it was exposed publicly.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyCv9xkCmCA52lYLOTeiMgA1Bb0XIa4Ii98',
  authDomain: 'creature-habits-1.firebaseapp.com',
  projectId: 'creature-habits-1',
  storageBucket: 'creature-habits-1.firebasestorage.app',
  messagingSenderId: '409145722058',
  appId: '1:409145722058:web:2dc5fbb5eb244bfe366033',
  measurementId: 'G-167G15KESH'
};

/** Default note text for new Scripture log rows (matches existing Firestore entries). */
const DEFAULT_SCRIPTURE_NOTE = '*I read this passage*';

/** Timestamp style consistent with existing Scripture map entries (fractional ms). */
function scriptureLogTimestamp() {
  return Date.now() + Math.random() * 0.001;
}

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();

/** CDN first so Wix / embedded pages work without a local copy of the JSON. */
const PLAN_JSON_URLS = [
  'https://cdn.jsdelivr.net/gh/RossBoone/Creature-Habits-json@main/bible-reading-plans.json',
  'https://raw.githubusercontent.com/RossBoone/Creature-Habits-json/main/bible-reading-plans.json',
  'bible-reading-plans.json'
];

const BOOK_NAMES = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'
];
const BOOK_SORTED = [...BOOK_NAMES].sort((a, b) => b.length - a.length);

function normalizeSegment(seg) {
  let s = seg.trim().replace(/\u2013/g, '-').replace(/\u2014/g, '-');
  if (/^Psalm\s+/i.test(s) && !/^Psalms\s+/i.test(s)) {
    s = s.replace(/^Psalm\s+/i, 'Psalms ');
  }
  return s;
}

/**
 * Expand one comma-separated segment into chapter-level passages for the reader & queue.
 */
function expandSegment(segRaw) {
  const seg = normalizeSegment(segRaw);
  for (const book of BOOK_SORTED) {
    const lower = seg.toLowerCase();
    if (!lower.startsWith(book.toLowerCase() + ' ') && lower !== book.toLowerCase()) continue;
    const rest = seg.slice(book.length).trim();
    if (!rest) return [{ book, chapter: 1, label: `${book} 1`, key: `${book}|1` }];

    const crossChVs = rest.match(/^(\d+):(\d+)\s*-\s*(\d+):(\d+)$/);
    if (crossChVs) {
      const c1 = +crossChVs[1], v1 = +crossChVs[2], c2 = +crossChVs[3], v2 = +crossChVs[4];
      const out = [];
      if (c1 === c2) {
        out.push({ book, chapter: c1, verseStart: v1, verseEnd: v2, label: seg.trim(), key: `${book}|${c1}|v${v1}-${v2}` });
      } else {
        out.push({ book, chapter: c1, verseStart: v1, label: `${book} ${c1}:${v1}–${c1}`, key: `${book}|${c1}|v${v1}+` });
        for (let c = c1 + 1; c < c2; c++) {
          out.push({ book, chapter: c, label: `${book} ${c}`, key: `${book}|${c}` });
        }
        out.push({ book, chapter: c2, verseEnd: v2, label: `${book} ${c2}:1–${v2}`, key: `${book}|${c2}|v1-${v2}` });
      }
      return out;
    }

    const chDashChColon = rest.match(/^(\d+)\s*-\s*(\d+):(\d+)$/);
    if (chDashChColon) {
      const a = +chDashChColon[1], b = +chDashChColon[2], ve = +chDashChColon[3];
      const out = [];
      for (let c = a; c < b; c++) {
        out.push({ book, chapter: c, label: `${book} ${c}`, key: `${book}|${c}` });
      }
      out.push({ book, chapter: b, verseEnd: ve, label: `${book} ${b} (through v. ${ve})`, key: `${book}|${b}|v1-${ve}` });
      return out;
    }

    const mVerses = rest.match(/^(\d+):(\d+)\s*-\s*(\d+)$/);
    if (mVerses) {
      const ch = +mVerses[1];
      return [{
        book, chapter: ch, verseStart: +mVerses[2], verseEnd: +mVerses[3],
        label: seg.trim(), key: `${book}|${ch}|v${mVerses[2]}-${mVerses[3]}`
      }];
    }

    const mChRange = rest.match(/^(\d+)\s*-\s*(\d+)$/);
    if (mChRange) {
      const a = +mChRange[1], b = +mChRange[2];
      const out = [];
      for (let c = a; c <= b; c++) {
        out.push({ book, chapter: c, label: `${book} ${c}`, key: `${book}|${c}` });
      }
      return out;
    }

    const mCh = rest.match(/^(\d+)$/);
    if (mCh) {
      return [{ book, chapter: +mCh[1], label: `${book} ${mCh[1]}`, key: `${book}|${mCh[1]}` }];
    }
    return [{ book, chapter: 1, label: seg, key: `${book}|?|${encodeURIComponent(seg)}` }];
  }
  return [];
}

function expandDayString(dayStr) {
  const parts = dayStr.split(', ').map(p => p.trim()).filter(Boolean);
  const all = [];
  for (const p of parts) {
    all.push(...expandSegment(p));
  }
  return all;
}

let plansBundle = null;
let currentUid = null;
let allUsers = [];
let selectedPlanId = localStorage.getItem('bvPlanId') || 'mcheyne';
let selectedDayNum = Math.max(1, parseInt(localStorage.getItem('bvPlanDay') || '1', 10));
let currentChatId = null;
let chatUnsub = null;
let planProgress = {};

/** Set of biblePlanPassageId values present in user's Scripture array (each passage logged once). */
let scriptureEntriesByPassageId = new Set();
/** biblePlanPassageId -> Scripture_notes string */
let scriptureNotesByPassageId = new Map();
/** chapterLogId for Read-tab “I read this chapter” rows */
let scriptureChapterLogIds = new Set();
let scriptureNotesByChapterLogId = new Map();

/** Last chapter the reader showed — refresh footer after sign-in loads Firestore. */
let lastChapterBarBook = null;
let lastChapterBarChapter = null;

function biblePlanPassageId(planId, dayNum, passageIdx) {
  return `plan:${planId}:day:${dayNum}:p:${passageIdx}`;
}

function viewerChapterLogId(book, chapter) {
  const chNum = Number(chapter);
  const chPart = Number.isFinite(chNum) ? String(chNum) : String(chapter ?? '').trim();
  return `viewer:${String(book).trim()}:${chPart}`;
}

/** Firestore / legacy clients may store Scripture as an object map; normalize to a dense array of objects. */
function normalizeScriptureArray(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter(e => e && typeof e === 'object');
  }
  if (typeof raw === 'object') {
    return Object.keys(raw)
      .sort((a, b) => Number(a) - Number(b))
      .map(k => raw[k])
      .filter(e => e && typeof e === 'object');
  }
  return [];
}

function refreshScripturePassageCache(scripture) {
  scriptureEntriesByPassageId = new Set();
  scriptureNotesByPassageId = new Map();
  scriptureChapterLogIds = new Set();
  scriptureNotesByChapterLogId = new Map();
  const arr = normalizeScriptureArray(scripture);
  for (const e of arr) {
    if (e.biblePlanPassageId) {
      scriptureEntriesByPassageId.add(e.biblePlanPassageId);
      scriptureNotesByPassageId.set(e.biblePlanPassageId, e.Scripture_notes != null ? String(e.Scripture_notes) : '');
    }
    if (e.chapterLogId && String(e.chapterLogId).startsWith('viewer:')) {
      scriptureChapterLogIds.add(e.chapterLogId);
      scriptureNotesByChapterLogId.set(e.chapterLogId, e.Scripture_notes != null ? String(e.Scripture_notes) : '');
    }
  }
}

/** Build one Scripture[] element — same shape as other logs, one row per passage. */
function buildScriptureEntryForPlanPassage(p, planId, dayNum, idx, rawDayString, notes) {
  const label = p.label || `${p.book} ${p.chapter}`;
  const pid = biblePlanPassageId(planId, dayNum, idx);
  const noteText = (notes != null && String(notes).trim()) ? String(notes).trim() : DEFAULT_SCRIPTURE_NOTE;
  const entry = {
    Date_submitted: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    Id: String(Math.random()),
    Scripture_address: label,
    Scripture_notes: noteText,
    Timestamp: scriptureLogTimestamp(),
    biblePlanId: planId,
    biblePlanDay: dayNum,
    biblePlanDayRaw: rawDayString,
    biblePlanPassageIndex: idx,
    biblePlanPassageId: pid,
    book: p.book,
    chapter: p.chapter
  };
  if (p.verseStart != null) entry.verseStart = p.verseStart;
  if (p.verseEnd != null) entry.verseEnd = p.verseEnd;
  return entry;
}

/** One Scripture[] row for “I read this chapter” from the Read tab (not tied to a plan day). */
function buildScriptureEntryForViewerChapter(book, chapter, notes) {
  const chNum = Number(chapter);
  const cid = viewerChapterLogId(book, chapter);
  const addr = `${book} ${chapter}`;
  const noteText = (notes != null && String(notes).trim()) ? String(notes).trim() : DEFAULT_SCRIPTURE_NOTE;
  return {
    Date_submitted: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    Id: String(Math.random()),
    Scripture_address: addr,
    Scripture_notes: noteText,
    Timestamp: scriptureLogTimestamp(),
    chapterLogId: cid,
    bibleViewerChapterRead: true,
    book,
    chapter: Number.isFinite(chNum) ? chNum : chapter
  };
}

async function readUserScriptureArray() {
  if (!currentUid) return [];
  const snap = await getDoc(doc(db, 'users', currentUid));
  if (!snap.exists()) return [];
  return normalizeScriptureArray(snap.data().Scripture);
}

async function saveScriptureArray(scripture) {
  if (!currentUid) return;
  const arr = normalizeScriptureArray(scripture);
  const cleaned = JSON.parse(JSON.stringify(arr));
  try {
    await setDoc(doc(db, 'users', currentUid), { Scripture: cleaned }, { merge: true });
  } catch (err) {
    console.error('[Bible Viewer] Firestore Scripture save failed:', err);
    throw err;
  }
}

/** Sync plan day checkmarks from Scripture rows so the grid stays consistent. */
function syncPlanProgressDaysFromScripture(scripture) {
  const fromScr = {};
  for (const e of scripture || []) {
    if (!e || !e.biblePlanPassageId) continue;
    const m = String(e.biblePlanPassageId).match(/^plan:([^:]+):day:(\d+):p:(\d+)$/);
    if (!m) continue;
    const planId = m[1];
    const day = m[2];
    const pidx = m[3];
    if (!fromScr[planId]) fromScr[planId] = { days: {} };
    if (!fromScr[planId].days[day]) fromScr[planId].days[day] = [];
    if (!fromScr[planId].days[day].includes(pidx)) fromScr[planId].days[day].push(pidx);
  }
  for (const planId of Object.keys(fromScr)) {
    if (!planProgress[planId]) planProgress[planId] = { days: {} };
    const merged = { ...planProgress[planId].days };
    for (const d of Object.keys(fromScr[planId].days)) {
      const set = new Set([...(merged[d] || []), ...fromScr[planId].days[d]]);
      merged[d] = [...set].sort((a, b) => Number(a) - Number(b));
    }
    planProgress[planId].days = merged;
  }
}

async function fetchPlansJson() {
  let lastErr = null;
  for (const url of PLAN_JSON_URLS) {
    try {
      const r = await fetch(url, { cache: 'force-cache' });
      if (!r.ok) throw new Error(r.statusText);
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Could not load bible-reading-plans.json');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Readable plan labels for the dropdown (short name + what the plan is). */
function planOptionLabel(p) {
  const desc = (p.description || '').trim();
  const short = (p.shortName || p.name || p.id || '').trim();
  if (desc && short) return `${short} — ${desc}`;
  return desc || short || String(p.id);
}

function planOptionTitleAttr(p) {
  const name = (p.name || '').trim();
  const desc = (p.description || '').trim();
  if (name && desc) return `${name} — ${desc}`;
  return name || desc || planOptionLabel(p);
}

function toast(msg, kind = 'info') {
  const el = document.getElementById('bvToast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.borderColor = kind === 'error' ? '#b91c1c' : 'var(--border)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

function switchMainTab(which) {
  const read = document.getElementById('bvTabRead');
  const plans = document.getElementById('bvTabPlans');
  const bRead = document.getElementById('bvNavRead');
  const bPlans = document.getElementById('bvNavPlans');
  if (!read || !plans) return;
  if (which === 'plans') {
    read.classList.remove('bv-tab-panel--active');
    plans.classList.add('bv-tab-panel--active');
    bRead?.classList.remove('active');
    bPlans?.classList.add('active');
  } else {
    plans.classList.remove('bv-tab-panel--active');
    read.classList.add('bv-tab-panel--active');
    bPlans?.classList.remove('active');
    bRead?.classList.add('active');
  }
}

function getPlanMeta(id) {
  return plansBundle?.plans?.find(p => p.id === id);
}

function isPassageDone(planId, dayNum, passageIdx) {
  const pid = biblePlanPassageId(planId, dayNum, passageIdx);
  if (scriptureEntriesByPassageId.has(pid)) return true;
  const st = planProgress[planId];
  if (!st || !st.days) return false;
  return (st.days[String(dayNum)] || []).includes(String(passageIdx));
}

function isDayFullyDone(planId, dayNum, nPassages) {
  for (let i = 0; i < nPassages; i++) {
    if (!isPassageDone(planId, dayNum, i)) return false;
  }
  return nPassages > 0;
}

async function persistPlanProgress() {
  if (!currentUid) return;
  await setDoc(doc(db, 'users', currentUid), { biblePlanProgress: planProgress }, { merge: true });
}

async function loadPlanProgressFromFirestore() {
  if (!currentUid) return;
  const snap = await getDoc(doc(db, 'users', currentUid));
  if (!snap.exists()) {
    planProgress = {};
    refreshScripturePassageCache([]);
    return;
  }
  const d = snap.data();
  planProgress = d.biblePlanProgress || {};
  const scripture = normalizeScriptureArray(d.Scripture);
  refreshScripturePassageCache(scripture);
  syncPlanProgressDaysFromScripture(scripture);
}

function renderPlanProgressLine() {
  const el = document.getElementById('bvPlanProgress');
  const meta = getPlanMeta(selectedPlanId);
  if (!el || !meta) return;
  const days = meta.days || [];
  const total = days.length;
  let completedDays = 0;
  for (let d = 1; d <= total; d++) {
    const passages = expandDayString(days[d - 1] || '');
    if (isDayFullyDone(selectedPlanId, d, passages.length)) completedDays++;
  }
  const pct = total ? Math.round((completedDays / total) * 100) : 0;
  el.textContent = `Day ${selectedDayNum} of ${total} · ${completedDays} full day(s) completed · ${pct}% days complete`;
}

function renderDayGrid() {
  const grid = document.getElementById('bvPlanDayGrid');
  const meta = getPlanMeta(selectedPlanId);
  if (!grid || !meta) return;
  const total = meta.days.length;
  grid.innerHTML = '';
  for (let d = 1; d <= total; d++) {
    const passages = expandDayString(meta.days[d - 1] || '');
    const done = isDayFullyDone(selectedPlanId, d, passages.length);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plans-day-btn' + (d === selectedDayNum ? ' is-current' : '') + (done ? ' is-done' : '');
    btn.textContent = String(d);
    btn.title = `Day ${d}`;
    btn.addEventListener('click', () => {
      selectedDayNum = d;
      localStorage.setItem('bvPlanDay', String(d));
      renderDayGrid();
      renderDayDetail();
      renderPlanProgressLine();
    });
    grid.appendChild(btn);
  }
}

async function applyPassageCheckboxChange(passages, idx, checked, raw) {
  const p = passages[idx];
  const pid = biblePlanPassageId(selectedPlanId, selectedDayNum, idx);
  let scripture = await readUserScriptureArray();
  scripture = scripture.filter(e => e && e.biblePlanPassageId !== pid);
  const ta = document.getElementById(`bvNote-${idx}`);
  const note = (ta?.value || '').trim();
  if (checked) {
    scripture.push(buildScriptureEntryForPlanPassage(p, selectedPlanId, selectedDayNum, idx, raw, note));
  }
  await saveScriptureArray(scripture);
  refreshScripturePassageCache(scripture);
  syncPlanProgressDaysFromScripture(scripture);
  toast(checked ? 'Saved to your Scripture log.' : 'Updated your Scripture log.');

  if (!planProgress[selectedPlanId]) planProgress[selectedPlanId] = { days: {} };
  const key = String(selectedDayNum);
  let arr = planProgress[selectedPlanId].days[key] || [];
  const sidx = String(idx);
  if (checked) {
    if (!arr.includes(sidx)) arr = [...arr, sidx];
  } else {
    arr = arr.filter(x => x !== sidx);
  }
  planProgress[selectedPlanId].days[key] = arr;
  try {
    await persistPlanProgress();
  } catch (e) {
    console.warn('[Bible Viewer] biblePlanProgress save failed (Scripture row may still be saved):', e);
  }
}

async function savePassageNoteOnly(idx) {
  if (!currentUid) {
    toast('Sign in to save notes', 'error');
    return;
  }
  const pid = biblePlanPassageId(selectedPlanId, selectedDayNum, idx);
  const ta = document.getElementById(`bvNote-${idx}`);
  const note = (ta?.value || '').trim();
  let scripture = await readUserScriptureArray();
  const i = scripture.findIndex(e => e && e.biblePlanPassageId === pid);
  if (i === -1) {
    toast('Mark this passage as read first, then you can save a note for it.', 'error');
    return;
  }
  const prev = scripture[i];
  const noteSaved = (note && note.trim()) ? note.trim() : DEFAULT_SCRIPTURE_NOTE;
  scripture[i] = {
    ...prev,
    Scripture_notes: noteSaved,
    Date_submitted: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    Timestamp: scriptureLogTimestamp()
  };
  await saveScriptureArray(scripture);
  refreshScripturePassageCache(scripture);
  toast('Note saved for this passage.');
}

async function applyViewerChapterReadChange(book, chapter, checked) {
  const cid = viewerChapterLogId(book, chapter);
  let scripture = await readUserScriptureArray();
  scripture = scripture.filter(e => e && e.chapterLogId !== cid);
  const ta = document.getElementById('bvChapterReadNote');
  const raw = (ta?.value || '').trim();
  const note = raw || DEFAULT_SCRIPTURE_NOTE;
  if (checked) {
    scripture.push(buildScriptureEntryForViewerChapter(book, chapter, note));
  }
  await saveScriptureArray(scripture);
  refreshScripturePassageCache(scripture);
  toast(checked ? 'Saved this chapter to your Scripture log.' : 'Removed this chapter from your Scripture log.');
}

async function saveViewerChapterNoteOnly(book, chapter) {
  if (!currentUid) {
    toast('Sign in to save notes', 'error');
    return;
  }
  const cid = viewerChapterLogId(book, chapter);
  let scripture = await readUserScriptureArray();
  const i = scripture.findIndex(e => e && e.chapterLogId === cid);
  if (i === -1) {
    toast('Mark this chapter as read first, then you can save a note for it.', 'error');
    return;
  }
  const ta = document.getElementById('bvChapterReadNote');
  const raw = (ta?.value || '').trim();
  const note = raw || DEFAULT_SCRIPTURE_NOTE;
  const prev = scripture[i];
  scripture[i] = {
    ...prev,
    Scripture_notes: note,
    Date_submitted: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    Timestamp: scriptureLogTimestamp()
  };
  await saveScriptureArray(scripture);
  refreshScripturePassageCache(scripture);
  toast('Note saved for this chapter.');
}

function mountChapterReadBar(book, chapter) {
  const content = document.getElementById('content');
  if (!content || !book || chapter == null || String(chapter).trim() === '') return;

  document.getElementById('bvChapterReadFooter')?.remove();

  const cid = viewerChapterLogId(book, chapter);
  const checked = scriptureChapterLogIds.has(cid);
  const savedNote = scriptureNotesByChapterLogId.get(cid) || '';
  const noteForTextarea = (savedNote && savedNote.trim()) ? savedNote : DEFAULT_SCRIPTURE_NOTE;

  const footer = document.createElement('div');
  footer.id = 'bvChapterReadFooter';
  footer.className = 'bv-chapter-read-footer';
  footer.style.cssText =
    'margin-top:28px;padding:18px;border:1px solid var(--border,#e5e5e5);border-radius:14px;background:var(--card,#fafafa);';
  footer.innerHTML = `
    <div style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text,#111);">Your reading log</div>
    <p style="margin:0 0 12px;font-size:13px;color:var(--muted,#666);line-height:1.45;">
      Type your notes for this chapter first, then check the box to save a Scripture entry (same fields as your other logs). Sign in required.
    </p>
    <label for="bvChapterReadNote" style="font-size:12px;font-weight:600;color:var(--muted,#666);display:block;margin-bottom:6px;">Notes for this chapter</label>
    <textarea id="bvChapterReadNote" rows="4" placeholder="Notes for this chapter…"
      style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid var(--border,#e5e5e5);font-size:14px;font-family:inherit;">${escapeHtml(noteForTextarea)}</textarea>
    <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap;">
      <button type="button" class="btn" id="bvChapterReadSaveNote" style="font-size:13px;${checked ? '' : 'display:none;'}">Update note only</button>
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;margin:0;">
        <input type="checkbox" id="bvChapterReadDone" ${checked ? 'checked' : ''} />
        <span>I’ve read this chapter</span>
      </label>
    </div>
  `;
  content.appendChild(footer);

  const cb = footer.querySelector('#bvChapterReadDone');
  cb?.addEventListener('change', async () => {
    if (!currentUid) {
      toast('Sign in to save progress', 'error');
      cb.checked = false;
      return;
    }
    const on = cb.checked;
    try {
      await applyViewerChapterReadChange(book, chapter, on);
      mountChapterReadBar(book, chapter);
    } catch (e) {
      console.error(e);
      toast('Could not save: ' + (e.message || e), 'error');
      cb.checked = !on;
    }
  });

  footer.querySelector('#bvChapterReadSaveNote')?.addEventListener('click', async () => {
    try {
      await saveViewerChapterNoteOnly(book, chapter);
      mountChapterReadBar(book, chapter);
    } catch (e) {
      console.error(e);
      toast('Could not save note: ' + (e.message || e), 'error');
    }
  });
}

window.bvNotifyChapterLoaded = function (book, chapter) {
  lastChapterBarBook = book;
  lastChapterBarChapter = chapter;
  mountChapterReadBar(book, chapter);
};

window.bvRefreshChapterReadFooter = function () {
  if (lastChapterBarBook != null && lastChapterBarChapter != null) {
    mountChapterReadBar(lastChapterBarBook, lastChapterBarChapter);
  }
};

function renderDayDetail() {
  const wrap = document.getElementById('bvPlanDayDetail');
  const meta = getPlanMeta(selectedPlanId);
  if (!wrap || !meta) return;
  const raw = meta.days[selectedDayNum - 1] || '';
  const passages = expandDayString(raw);
  if (!passages.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';

  const planTitle = meta.name || meta.shortName || selectedPlanId;
  let html = `<h3>Day ${selectedDayNum} — ${escapeHtml(planTitle)}</h3>`;
  html += `<p style="font-size:13px;color:var(--muted);margin:0 0 12px;">${escapeHtml(raw)}</p>`;

  passages.forEach((p, idx) => {
    const done = isPassageDone(selectedPlanId, selectedDayNum, idx);
    const label = p.label || `${p.book} ${p.chapter}`;
    const pid = biblePlanPassageId(selectedPlanId, selectedDayNum, idx);
    const savedNote = scriptureNotesByPassageId.has(pid) ? scriptureNotesByPassageId.get(pid) : '';
    const displayNote = (savedNote && savedNote.trim()) ? savedNote : DEFAULT_SCRIPTURE_NOTE;
    html += `<div class="plans-passage plans-passage--stack" data-pidx="${idx}">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;width:100%;justify-content:space-between;">
        <span style="font-weight:600;flex:1;min-width:0;">${escapeHtml(label)}</span>
        <div class="plans-pass-actions">
          <button type="button" class="btn bv-go" data-pidx="${idx}">Read</button>
        </div>
      </div>
      <div class="plans-passage-note" style="margin-top:10px;">
        <label for="bvNote-${idx}" style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px;">Notes for this passage</label>
        <textarea id="bvNote-${idx}" class="bv-pass-note" data-pidx="${idx}" rows="3" placeholder="Notes for this passage…" style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid var(--border);font-size:14px;font-family:inherit;">${escapeHtml(displayNote)}</textarea>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap;">
          <button type="button" class="btn bv-save-pass-note" data-pidx="${idx}" style="font-size:13px;${done ? '' : 'display:none;'}">Update note only</button>
          <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;margin:0;">
            <input type="checkbox" class="bv-pass-done" data-pidx="${idx}" ${done ? 'checked' : ''} />
            <span>I’ve read this passage</span>
          </label>
        </div>
      </div>
    </div>`;
  });

  wrap.innerHTML = html;

  wrap.querySelectorAll('.bv-pass-done').forEach(cb => {
    cb.addEventListener('change', async () => {
      if (!currentUid) {
        toast('Sign in to save progress', 'error');
        cb.checked = false;
        return;
      }
      const idx = +cb.getAttribute('data-pidx');
      const on = cb.checked;
      try {
        await applyPassageCheckboxChange(passages, idx, on, raw);
        renderDayGrid();
        renderPlanProgressLine();
        renderDayDetail();
      } catch (e) {
        console.error(e);
        toast('Could not save: ' + e.message, 'error');
        cb.checked = !on;
      }
    });
  });

  wrap.querySelectorAll('.bv-go').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.getAttribute('data-pidx');
      const p = passages[idx];
      if (p && window.goToBookChapter) {
        switchMainTab('read');
        window.goToBookChapter(p.book, p.chapter);
      }
    });
  });

  wrap.querySelectorAll('.bv-save-pass-note').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = +btn.getAttribute('data-pidx');
      try {
        await savePassageNoteOnly(idx);
      } catch (e) {
        console.error(e);
        toast('Could not save note: ' + e.message, 'error');
      }
    });
  });
}

document.getElementById('bvAddDayToQueueBtn')?.addEventListener('click', () => {
  const meta = getPlanMeta(selectedPlanId);
  if (!meta) return;
  const raw = meta.days[selectedDayNum - 1] || '';
  const passages = expandDayString(raw);
  const items = passages.map(p => ({ book: p.book, chapter: p.chapter }));
  if (window.queuePlanChapters) window.queuePlanChapters(items);
  toast(`Added ${items.length} chapter(s) to your reading queue.`);
  switchMainTab('read');
});

document.getElementById('bvPlanSelect')?.addEventListener('change', e => {
  selectedPlanId = e.target.value;
  localStorage.setItem('bvPlanId', selectedPlanId);
  selectedDayNum = 1;
  localStorage.setItem('bvPlanDay', '1');
  renderDayGrid();
  renderDayDetail();
  renderPlanProgressLine();
});

document.getElementById('bvNavRead')?.addEventListener('click', () => switchMainTab('read'));
document.getElementById('bvNavPlans')?.addEventListener('click', () => switchMainTab('plans'));

function setupAuthUi() {
  const mask = document.getElementById('authMask');
  document.getElementById('bvSignInBtn')?.addEventListener('click', () => {
    mask?.classList.add('show');
  });
  document.getElementById('authClose')?.addEventListener('click', () => mask?.classList.remove('show'));
  document.getElementById('tabSignIn')?.addEventListener('click', () => {
    document.getElementById('paneSignIn').style.display = 'block';
    document.getElementById('paneSignUp').style.display = 'none';
    document.getElementById('tabSignIn').classList.add('active');
    document.getElementById('tabSignUp').classList.remove('active');
  });
  document.getElementById('tabSignUp')?.addEventListener('click', () => {
    document.getElementById('paneSignIn').style.display = 'none';
    document.getElementById('paneSignUp').style.display = 'block';
    document.getElementById('tabSignUp').classList.add('active');
    document.getElementById('tabSignIn').classList.remove('active');
  });
  document.getElementById('signInForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const email = document.getElementById('siEmail').value.trim();
    const pass = document.getElementById('siPass').value;
    const name = (document.getElementById('siName')?.value || '').trim();
    try {
      const userCred = await signInWithEmailAndPassword(auth, email, pass);
      if (name) {
        await updateProfile(userCred.user, { displayName: name });
        await setDoc(doc(db, 'users', userCred.user.uid), {
          displayName: name,
          name: name
        }, { merge: true });
      }
      mask?.classList.remove('show');
      toast('Signed in.');
    } catch (err) {
      toast(err.message || 'Sign in failed', 'error');
    }
  });
  document.getElementById('signUpForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const email = document.getElementById('suEmail').value.trim();
    const pass = document.getElementById('suPass').value;
    const name = document.getElementById('suName').value.trim();
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, 'users', cred.user.uid), {
        email,
        displayName: name,
        name,
        badges: ['Looking'],
        createdAt: serverTimestamp()
      }, { merge: true });
      mask?.classList.remove('show');
      toast('Account created.');
    } catch (err) {
      toast(err.message || 'Sign up failed', 'error');
    }
  });
  document.getElementById('bvSignOutBtn')?.addEventListener('click', async () => {
    await signOut(auth);
    toast('Signed out.');
  });
}

async function loadAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function getValidChatName(user) {
  const rawName = (user?.displayName || user?.name || '').trim();
  if (!rawName) return '';
  const normalized = rawName.toLowerCase().replace(/\s+/g, ' ').trim();
  const blocked = new Set(['user', 'unknown', 'anonymous', 'test user', 'someone']);
  if (blocked.has(normalized)) return '';
  return rawName;
}

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function renderUserSelection() {
  const list = document.getElementById('userList');
  if (!list) return;
  const validUsers = allUsers
    .filter(u => u.id !== currentUid)
    .map(u => ({ ...u, __chatName: getValidChatName(u) }))
    .filter(u => !!u.__chatName)
    .sort((a, b) => a.__chatName.localeCompare(b.__chatName));

  list.innerHTML = validUsers.map(u => `
    <div class="userItem" data-participants="${u.id}">
      <div class="userItemCheckbox"><input type="checkbox" class="chatTargetCheckbox" data-participants="${u.id}" /></div>
      <div class="userItemContent">
        <img class="userItemAvatar" src="${u.photoURL || `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(u.__chatName)}`}" alt="" />
        <div class="userItemName">${escapeHtml(u.__chatName)}</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.userItem').forEach(item => {
    const cb = item.querySelector('input');
    item.addEventListener('click', ev => {
      if (ev.target === cb) return;
      cb.checked = !cb.checked;
    });
  });
}

function getSelectedChatParticipants() {
  const checked = Array.from(document.querySelectorAll('#userList input.chatTargetCheckbox:checked'));
  const ids = new Set();
  checked.forEach(cb => {
    (cb.getAttribute('data-participants') || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => ids.add(id));
  });
  return Array.from(ids);
}

function loadChatMessages() {
  if (!currentChatId) return;
  if (chatUnsub) chatUnsub();
  const messagesRef = collection(db, 'chats', currentChatId, 'messages');
  const q = query(messagesRef, orderBy('createdAt', 'asc'));
  chatUnsub = onSnapshot(q, snapshot => {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '';
    snapshot.docs.forEach(d => {
      const msg = d.data();
      const isOwn = msg.senderId === currentUid;
      const sender = allUsers.find(u => u.id === msg.senderId);
      const avatar = sender?.photoURL || (isOwn ? auth.currentUser?.photoURL : null) ||
        'https://api.dicebear.com/7.x/shapes/svg?seed=User';
      const bubble = `<div class="messageBubble">${escapeHtml(msg.text || '')}</div>`;
      container.innerHTML += `
        <div class="message ${isOwn ? 'own' : ''}">
          <img class="messageAvatar" src="${avatar}" alt="" />
          <div>${bubble}<div class="messageTime">${msg.createdAt?.toDate ? fmtTime(msg.createdAt.toDate()) : ''}</div></div>
        </div>`;
    });
    container.scrollTop = container.scrollHeight;
  });
}

async function startChatFromPicker(customTitle) {
  const selected = getSelectedChatParticipants();
  if (!selected.length) {
    toast('Select at least one person', 'error');
    return;
  }
  const participants = [currentUid, ...selected].sort();
  const meta = getPlanMeta(selectedPlanId);
  const planLabel = meta?.name || selectedPlanId;
  const title = (customTitle || '').trim() || `Bible plan: ${planLabel}`;

  const existing = await getDocs(query(collection(db, 'chats'), where('participants', '==', participants)));
  let chatId;
  let isNew = false;
  if (!existing.empty) {
    chatId = existing.docs[0].id;
    await updateDoc(doc(db, 'chats', chatId), { title, biblePlanId: selectedPlanId, biblePlanName: planLabel });
  } else {
    isNew = true;
    const ref = await addDoc(collection(db, 'chats'), {
      participants,
      title,
      biblePlanId: selectedPlanId,
      biblePlanName: planLabel,
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp()
    });
    chatId = ref.id;
  }

  if (isNew) {
    const intro = `⌲ ${title}\n\nWe’re reading “${planLabel}” in the Bible Viewer. Day ${selectedDayNum}.`;
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      text: intro,
      senderId: currentUid,
      senderName: auth.currentUser?.displayName || 'Reader',
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'chats', chatId), { lastMessageAt: serverTimestamp(), lastMessageSenderId: currentUid });
  }

  currentChatId = chatId;
  document.getElementById('userSelection').style.display = 'none';
  document.getElementById('chatMessages').style.display = 'flex';
  document.getElementById('chatInputArea').style.display = 'flex';
  const ctx = document.getElementById('chatContextLabel');
  if (ctx) {
    ctx.style.display = 'block';
    ctx.textContent = title;
  }
  loadChatMessages();
  toast('Chat ready.');
}

async function enterChatWithSelectedUsers() {
  const selected = getSelectedChatParticipants();
  if (!selected.length) {
    toast('Select at least one person', 'error');
    return;
  }
  const participants = [currentUid, ...selected].sort();
  const existing = await getDocs(query(collection(db, 'chats'), where('participants', '==', participants)));
  if (!existing.empty) {
    currentChatId = existing.docs[0].id;
  } else {
    const ref = await addDoc(collection(db, 'chats'), {
      participants,
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp()
    });
    currentChatId = ref.id;
  }
  document.getElementById('userSelection').style.display = 'none';
  document.getElementById('chatMessages').style.display = 'flex';
  document.getElementById('chatInputArea').style.display = 'flex';
  const ctx = document.getElementById('chatContextLabel');
  if (ctx) ctx.style.display = 'none';
  loadChatMessages();
}

window.bvOpenCommunityChat = () => {
  if (!currentUid) {
    toast('Sign in to chat', 'error');
    return;
  }
  document.getElementById('chatModal')?.classList.add('show');
  document.getElementById('userSelection').style.display = 'flex';
  document.getElementById('chatMessages').style.display = 'none';
  document.getElementById('chatInputArea').style.display = 'none';
  renderUserSelection();
  document.getElementById('startChatBtn').onclick = () => enterChatWithSelectedUsers();
};

window.bvCloseCommunityChat = () => {
  document.getElementById('chatModal')?.classList.remove('show');
};

document.getElementById('chatFloatingBtn')?.addEventListener('click', () => {
  window.bvOpenCommunityChat();
});

document.getElementById('chatClose')?.addEventListener('click', () => {
  document.getElementById('chatModal')?.classList.remove('show');
});
document.getElementById('cancelChatBtn')?.addEventListener('click', () => {
  document.getElementById('chatModal')?.classList.remove('show');
});

async function sendChatMessage() {
  const inp = document.getElementById('chatInput');
  const text = (inp?.value || '').trim();
  if (!text || !currentChatId || !currentUid) return;
  await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
    text,
    senderId: currentUid,
    senderName: auth.currentUser?.displayName || 'Reader',
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, 'chats', currentChatId), {
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: currentUid
  });
  inp.value = '';
}

document.getElementById('chatSendBtn')?.addEventListener('click', sendChatMessage);
document.getElementById('chatInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

document.getElementById('bvOpenPlanChatPickerBtn')?.addEventListener('click', () => {
  if (!currentUid) {
    toast('Sign in to invite people', 'error');
    return;
  }
  document.getElementById('chatModal')?.classList.add('show');
  document.getElementById('userSelection').style.display = 'flex';
  document.getElementById('chatMessages').style.display = 'none';
  document.getElementById('chatInputArea').style.display = 'none';
  renderUserSelection();
  const nameVal = document.getElementById('planChatName')?.value?.trim() || '';
  document.getElementById('startChatBtn').onclick = async () => {
    await startChatFromPicker(nameVal);
  };
});

async function attemptAutoSignIn() {
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('authToken');
  if (tokenFromUrl) {
    try {
      await signInWithCustomToken(auth, tokenFromUrl);
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      return true;
    } catch (e) {
      console.warn(e);
    }
  }
  return false;
}

onAuthStateChanged(auth, async user => {
  const label = document.getElementById('bvUserLabel');
  const signIn = document.getElementById('bvSignInBtn');
  const signOutBtn = document.getElementById('bvSignOutBtn');
  if (user) {
    currentUid = user.uid;
    if (label) label.textContent = user.displayName || user.email || 'Signed in';
    signIn.style.display = 'none';
    signOutBtn.style.display = 'inline-block';
    await loadPlanProgressFromFirestore();
    await loadAllUsers();
    renderDayGrid();
    renderDayDetail();
    renderPlanProgressLine();
    window.bvRefreshChapterReadFooter?.();
  } else {
    currentUid = null;
    if (label) label.textContent = '';
    signIn.style.display = 'inline-block';
    signOutBtn.style.display = 'none';
    planProgress = {};
    refreshScripturePassageCache([]);
    renderDayGrid();
    renderDayDetail();
    renderPlanProgressLine();
    window.bvRefreshChapterReadFooter?.();
  }
});

async function init() {
  setupAuthUi();
  const startBtn = document.getElementById('startChatBtn');
  if (startBtn) startBtn.onclick = () => enterChatWithSelectedUsers();
  try {
    plansBundle = await fetchPlansJson();
  } catch (e) {
    console.error(e);
    toast('Could not load reading plans JSON. Place bible-reading-plans.json next to this page.', 'error');
    return;
  }
  const sel = document.getElementById('bvPlanSelect');
  if (sel && plansBundle.plans) {
    sel.innerHTML = plansBundle.plans.map(p => {
      const label = planOptionLabel(p);
      const title = escapeHtml(planOptionTitleAttr(p));
      return `<option value="${escapeHtml(p.id)}" title="${title}">${escapeHtml(label)}</option>`;
    }).join('');
    sel.value = plansBundle.plans.some(p => p.id === selectedPlanId) ? selectedPlanId : plansBundle.plans[0].id;
    selectedPlanId = sel.value;
  }
  await attemptAutoSignIn();
  renderDayGrid();
  renderDayDetail();
  renderPlanProgressLine();
}

init().then(() => {
  console.log('[Bible Viewer] Plans module ready (Firebase, tabs, chat). Build: per-passage-notes-v2.');
}).catch(err => {
  console.error('[Bible Viewer] Plans init failed:', err);
});
