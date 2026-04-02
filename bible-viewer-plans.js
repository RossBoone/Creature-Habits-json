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
  query, orderBy, serverTimestamp, updateDoc, where, onSnapshot, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCv9xkCmCA52lYLOTeiMgA1Bb0XIa4Ii98',
  authDomain: 'creature-habits-1.firebaseapp.com',
  projectId: 'creature-habits-1',
  storageBucket: 'creature-habits-1.firebasestorage.app',
  messagingSenderId: '409145722058',
  appId: '1:409145722058:web:2dc5fbb5eb244bfe366033',
  measurementId: 'G-167G15KESH'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();

const PLAN_JSON_URLS = [
  'bible-reading-plans.json',
  'https://raw.githubusercontent.com/RossBoone/Creature-Habits-json/main/bible-reading-plans.json',
  'https://cdn.jsdelivr.net/gh/RossBoone/Creature-Habits-json@main/bible-reading-plans.json'
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

function passageCompletionKey(planId, dayNum, passageIdx) {
  return `${planId}:${dayNum}:${passageIdx}`;
}

function isPassageDone(planId, dayNum, passageIdx) {
  const st = planProgress[planId];
  if (!st || !st.days) return false;
  const arr = st.days[String(dayNum)] || [];
  return arr.includes(String(passageIdx));
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
  if (snap.exists() && snap.data().biblePlanProgress) {
    planProgress = snap.data().biblePlanProgress || {};
  } else {
    planProgress = {};
  }
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
    html += `<div class="plans-passage" data-pidx="${idx}">
      <label><input type="checkbox" class="bv-pass-done" data-pidx="${idx}" ${done ? 'checked' : ''} />
      ${escapeHtml(label)}</label>
      <div class="plans-pass-actions">
        <button type="button" class="btn bv-go" data-pidx="${idx}">Read</button>
      </div>
    </div>`;
  });

  html += `<div class="plans-note-area">
    <label for="bvPlanNote" style="font-size:13px;font-weight:600;">Notes after reading (saved to your Scripture log)</label>
    <textarea id="bvPlanNote" placeholder="Thoughts, prayer, highlights…"></textarea>
    <button type="button" class="btn primary" id="bvSavePlanNoteBtn" style="margin-top:8px;">Save note &amp; log reading</button>
  </div>`;

  wrap.innerHTML = html;

  wrap.querySelectorAll('.bv-pass-done').forEach(cb => {
    cb.addEventListener('change', async () => {
      if (!currentUid) {
        toast('Sign in to save progress', 'error');
        cb.checked = false;
        return;
      }
      const idx = cb.getAttribute('data-pidx');
      const on = cb.checked;
      if (!planProgress[selectedPlanId]) planProgress[selectedPlanId] = { days: {} };
      const key = String(selectedDayNum);
      let arr = planProgress[selectedPlanId].days[key] || [];
      const sidx = String(idx);
      if (on) {
        if (!arr.includes(sidx)) arr = [...arr, sidx];
      } else {
        arr = arr.filter(x => x !== sidx);
      }
      planProgress[selectedPlanId].days[key] = arr;
      await persistPlanProgress();
      renderDayGrid();
      renderPlanProgressLine();
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

  document.getElementById('bvSavePlanNoteBtn')?.addEventListener('click', async () => {
    const ta = document.getElementById('bvPlanNote');
    const note = (ta?.value || '').trim();
    if (!currentUid) {
      toast('Sign in to save notes', 'error');
      return;
    }
    const addr = `${planTitle} · Day ${selectedDayNum}`;
    const entry = {
      Date_submitted: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
      Id: String(Math.random()),
      Scripture_address: addr,
      Scripture_notes: note || '(reading logged)',
      Timestamp: Date.now(),
      biblePlanId: selectedPlanId,
      biblePlanDay: selectedDayNum,
      biblePlanDayRaw: raw
    };
    try {
      await setDoc(doc(db, 'users', currentUid), { Scripture: arrayUnion(entry) }, { merge: true });
      toast('Saved to your Scripture log.');
      ta.value = '';
    } catch (e) {
      console.error(e);
      toast('Could not save: ' + e.message, 'error');
    }
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
    try {
      await signInWithEmailAndPassword(auth, email, pass);
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
        email, displayName: name, name, createdAt: serverTimestamp()
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
  } else {
    currentUid = null;
    if (label) label.textContent = '';
    signIn.style.display = 'inline-block';
    signOutBtn.style.display = 'none';
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
    sel.innerHTML = plansBundle.plans.map(p =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.shortName || p.name)}</option>`
    ).join('');
    sel.value = plansBundle.plans.some(p => p.id === selectedPlanId) ? selectedPlanId : plansBundle.plans[0].id;
    selectedPlanId = sel.value;
  }
  await attemptAutoSignIn();
  renderDayGrid();
  renderDayDetail();
  renderPlanProgressLine();
}

init();
