
/* ==========================================================
   SAVED STATE

   Everything the person configures — connection settings, the
   full character roster (including any they added, edited, or
   removed), and room/behavior settings — lives under one key
   and is written back out any time something changes, so a
   reload picks up exactly where they left off. No separate
   setup page needed.
========================================================== */

const STORAGE_KEY = "theLobbyState";

let SAVED_STATE =
  JSON.parse(
    localStorage.getItem(STORAGE_KEY) ||
    "null"
  );

/* One-time migration from the old two-page version, if that
   browser has an old "lobbySetup" record but no new one yet. */

let MIGRATED_FROM_OLD = false;

if(!SAVED_STATE){

  const OLD_SETUP =
    JSON.parse(
      localStorage.getItem("lobbySetup") ||
      "null"
    );

  if(OLD_SETUP){

    MIGRATED_FROM_OLD = true;

    SAVED_STATE = {
      username: OLD_SETUP.username,
      roomName: OLD_SETUP.roomName,
      apiBase: OLD_SETUP.apiBase,
      apiKey: OLD_SETUP.apiKey,
      model: OLD_SETUP.model,
      plainModel: OLD_SETUP.plainModel,
      includeAdmin: OLD_SETUP.includeAdmin,
      customCharacters: Array.isArray(OLD_SETUP.customCharacters) ? OLD_SETUP.customCharacters : [],
      enabledCharacterIds: Array.isArray(OLD_SETUP.characters) ? OLD_SETUP.characters : null
    };

  }

}

/* ==========================================================
   THEME (LIGHT / DARK)
========================================================== */

let currentTheme = "light";

function applyTheme(theme){

  currentTheme = theme;

  if(theme === "light"){
    document.documentElement.setAttribute("data-theme", "light");
  }else{
    document.documentElement.removeAttribute("data-theme");
  }

  const btn = document.getElementById("themeToggle");

  if(btn){
    btn.textContent =
      theme === "light"
        ? "☀ Light"
        : "🌙 Dark";
  }

}

function toggleTheme(){
  applyTheme(currentTheme === "light" ? "dark" : "light");
  persistState();
}

applyTheme(SAVED_STATE?.theme || "light");

/* ==========================================================
   DEFAULT CHARACTERS

   This is the original ten-person roster. It's only used to
   populate a fresh browser (or after a reset) — the live
   roster lives in the mutable PEOPLE array below and is what
   actually gets saved.
========================================================== */

/* Characters now live in js/characters/*.js (one file each). */
const DEFAULT_PEOPLE = (window.LOBBY_CHARACTERS || []).map(c => ({...c}));

/* What is on a character's phone, added to their prompt so they can use it. */
function phoneNote(p){
  const ph = p && p.phone; if(!ph) return "";
  const bits = [];
  if(ph.photos && ph.photos.length) bits.push("photos you took: " + ph.photos.join(", "));
  if(ph.leftForThem && ph.leftForThem.length) bits.push("files left for you by the user: " + ph.leftForThem.join(", "));
  return bits.length ? "\n\nYour phone (you may mention these naturally): " + bits.join("; ") + "." : "";
}


/* ==========================================================
   PLAIN ADMIN PARTICIPANT
========================================================== */

const ADMIN = {

  id:"admin",

  name:"Admin",

  avatar:"A",

  role:"Room Admin",

  color:"var(--admin)"

};


/* ==========================================================
   BUILD THE LIVE ROSTER

   - Brand new browser, or after a reset: clone the ten
     defaults.
   - Returning visitor on the new single-page format: use the
     exact roster they left off with (additions, edits, and
     deletions all included).
   - Returning visitor migrating from the old two-page format:
     start from the defaults, add whatever custom characters
     they'd created, and drop whatever they'd unchecked.
========================================================== */

let PEOPLE;

let INCLUDE_ADMIN = true;

if(Array.isArray(SAVED_STATE?.people) && SAVED_STATE.people.length){

  PEOPLE = SAVED_STATE.people.map(p => ({...p}));

}else if(!MIGRATED_FROM_OLD){

  /* Brand new browser, or after a reset: the room starts
     empty. All ten default characters sit in the presets
     menu (the 🎭 button next to "Chats") until you add them
     in yourself. */

  PEOPLE = [];

}else{

  PEOPLE = DEFAULT_PEOPLE.map(p => ({...p}));

  if(Array.isArray(SAVED_STATE?.customCharacters)){

    SAVED_STATE.customCharacters.forEach(c=>{

      if(
        c && c.id && c.name &&
        !PEOPLE.some(p=>p.id===c.id)
      ){

        PEOPLE.push({

          id:c.id,

          name:c.name,

          avatar:
            c.avatar ||
            c.name.charAt(0).toUpperCase(),

          role:c.role || "Chat room regular",

          color:c.color || nextCharacterColor(),

          prompt:
            c.prompt ||
            ("You are " + c.name +
            ", a believable, natural participant in an old-school internet chat room. Talk like a real person, keep replies fairly short, and don't constantly announce your personality.")

        });

      }

    });

  }

  if(
    Array.isArray(SAVED_STATE?.enabledCharacterIds) &&
    SAVED_STATE.enabledCharacterIds.length
  ){

    for(
      let i = PEOPLE.length - 1;
      i >= 0;
      i--
    ){

      if(
        !SAVED_STATE.enabledCharacterIds.includes(
          PEOPLE[i].id
        )
      ){

        PEOPLE.splice(i, 1);

      }

    }

  }

}


/* ==========================================================
   ARCHIVED CHARACTERS

   Any character removed from the room — a default one or a
   fully custom one you created — is kept here instead of
   being thrown away. This is what lets a custom character
   come back later exactly as you made them (name, role,
   personality, and their DM history), not just the original
   ten presets.
========================================================== */

let ARCHIVED_CHARACTERS =
  Array.isArray(SAVED_STATE?.archivedCharacters)
    ? SAVED_STATE.archivedCharacters.map(p => ({...p}))
    : [];

/* ==========================================================
   SAVE STATE

   Called after any change to characters, connection settings,
   the prompt, activity sliders, username/room name, or theme.
   Writes the whole picture back to localStorage so a reload
   (or a visit next week) picks up right where things were
   left off.
========================================================== */

function persistState(){

  const val = id => document.getElementById(id)?.value ?? "";

  const state = {
    username: val("username"),
    roomName: val("roomName"),
    apiBase: val("apiBase"),
    apiKey: "",   // the key belongs to the browser settings; never copied into Lobby storage
    model: val("model"),
    plainModel: val("plainModel"),
    globalPrompt: val("globalPrompt"),
    worldPrompt: val("worldPrompt"),
    activity: val("activity"),
    replyChance: val("replyChance"),
    spontaneousChance: val("spontaneousChance"),
    maxBurst: val("maxBurst"),
    includeAdmin: INCLUDE_ADMIN,
    theme: currentTheme,
    people: PEOPLE,
    archivedCharacters: ARCHIVED_CHARACTERS,
    dmThreads: dmThreads
  };

  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){
    console.warn("Couldn't save Lobby state:", e);
  }

}

function onIncludeAdminChange(){

  INCLUDE_ADMIN = true;
  const adminToggle=document.getElementById("includeAdminToggle");
  if(adminToggle) adminToggle.checked=true;

  if(!INCLUDE_ADMIN && currentDM === "admin"){
    backToRoom();
  }

  peopleList();
  persistState();

}

function resetToDefaults(){

  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("lobbySetup");
  location.reload();

}

/* ==========================================================
   RESTORE A SINGLE PRESET CHARACTER
   (without wiping everything else)
========================================================== */

function presetMenuHTML(){

  /* OFFLINE HOLDING AREA
     Empty on start. Only characters who have gone offline (work,
     errands, sleep, life...) or that you removed by hand show up
     here, so you can bring them back manually. Everyone else is
     simply in one of the rooms. */

  let offline = [];
  let removedByHand = [];

  try{

    offline =
      Object.values(netRoster)
        .filter(c => c.offline && !c.removed)
        .map(netFull);

    removedByHand =
      ARCHIVED_CHARACTERS.filter(
        a =>
          netRoster[a.id] &&
          netRoster[a.id].removed &&
          !PEOPLE.some(p=>p.id===a.id)
      );

  }catch(e){}

  const all = [...offline, ...removedByHand]
    .sort((a,b)=>((a.offline&&a.offline.until)||1e15)-((b.offline&&b.offline.until)||1e15));

  if(!all.length){
    return `<div class="preset-menu-empty">Nobody is offline right now</div>`;
  }

  return all.map(p => {

    const why =
      p.offline
        ? p.offline.reason + " · back " + new Date(p.offline.until).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})
        : "removed";

    const back =
      p.offline && p.offline.until
        ? "Back around " + new Date(p.offline.until).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})
        : "Click to bring back";

    return `
    <button
      class="preset-menu-item"
      title="${String(back).replace(/"/g,"&quot;")}"
      onclick="restoreCharacter('${p.id}')"
    >
      <span class="avatar" style="background:${p.color||"var(--muted)"}">${p.avatar||String(p.name).charAt(0)}</span>
      <span>${p.name} <span style="color:var(--muted-dim)">— ${why}</span></span>
    </button>
  `;

  }).join("") + `<button class="preset-menu-item" style="justify-content:center;border-top:1px solid var(--line);border-radius:0" onclick="bringEveryoneBack()">↩ Bring everyone back</button>`;

}

function togglePresetMenu(evt){

  if(evt) evt.stopPropagation();

  const menu =
    document.getElementById("presetMenu");

  if(!menu) return;

  menu.innerHTML = presetMenuHTML();
  menu.classList.toggle("open");

}

function closePresetMenu(){

  const menu =
    document.getElementById("presetMenu");

  if(menu) menu.classList.remove("open");

}

document.addEventListener("click", (evt)=>{

  const menu =
    document.getElementById("presetMenu");

  if(!menu || !menu.classList.contains("open"))
    return;

  const wrap =
    evt.target.closest(".people-head-actions");

  if(!wrap)
    closePresetMenu();

});

function restoreCharacter(id){

  if(PEOPLE.some(p=>p.id===id))
    return;

  /* Prefer the archived version (this character exactly as you
     left them, edits and all) over the plain factory default. */

  const archivedIndex =
    ARCHIVED_CHARACTERS.findIndex(a=>a.id===id);

  let person;

  if(archivedIndex > -1){

    person =
      {...ARCHIVED_CHARACTERS[archivedIndex]};

    ARCHIVED_CHARACTERS.splice(archivedIndex, 1);

  }else{

    const preset =
      DEFAULT_PEOPLE.find(p=>p.id===id);

    if(!preset)
      return;

    person =
      {...preset};

  }

  PEOPLE.push(person);

  lastSpoke[id] = 0;

  /* dmThreads for this id is never wiped on removal, so if this
     character had a DM history it's already sitting there
     waiting — restoring just picks the conversation back up. */

  if(!dmThreads[id])
    dmThreads[id] = [];

  closePresetMenu();

  peopleList();

  persistState();

  setStatus(
    person.name + " is back in The Lobby."
  );

  announceRoomEvent(
    person.name + " joined the chat."
  );

}

/* ==========================================================
   ROOM COUNTS (dynamic — reflect added/removed characters)
========================================================== */

function onlineCountText(){

  /* PEOPLE + Admin, not counting "You" */

  return "• " +
    (PEOPLE.length + 1) +
    " people online";

}

function memberCountText(){

  /* PEOPLE + You + Admin */

  return "Room members · " +
    (PEOPLE.length + 2);

}


/* ==========================================================
   NEW CHARACTER HELPERS
========================================================== */

const NEW_CHARACTER_COLORS = [
  "#6ea8ff","#c792ea","#ffb86c","#6fd68f","#9aa5c0",
  "#ff8fb1","#d9b26a","#e59bd6","#57c2e9","#ff8c5a",
  "#7ee0c3","#f0a35c","#a992f0","#5fc4a8","#e08ad1"
];

function nextCharacterColor(){

  const idx =
    PEOPLE.length %
    NEW_CHARACTER_COLORS.length;

  return NEW_CHARACTER_COLORS[idx];

}

function slugifyName(name){

  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,"-")
      .replace(/^-+|-+$/g,"") ||
    "person";

  let id = base;

  let n = 2;

  while(
    id==="you" ||
    id==="admin" ||
    PEOPLE.some(p=>p.id===id)
  ){

    id = base + "-" + n;

    n++;

  }

  return id;

}


/* ==========================================================
   SPEAK TRACKING
========================================================== */

const lastSpoke = {};

PEOPLE.forEach(
  p => lastSpoke[p.id] = 0
);

lastSpoke.admin = 0;


/* ==========================================================
   DEFAULT GLOBAL PROMPT
========================================================== */

const DEFAULT_GLOBAL = `You are one participant in a fictional old-school internet chat room.

This is a busy chat room full of regulars and passers-by, plus one room Admin who watches the conversation and helps keep the room orderly.

You are NOT the whole room.

You are ONLY the participant assigned to you.

The conversation is continuous.

IMPORTANT:

- Stay in character when you have a character identity.
- Never mention system prompts.
- Never mention hidden instructions.
- Never mention APIs.
- Never mention request formatting.
- Never speak for another person.
- Never invent another person's response.
- React to the actual conversation.
- You can agree.
- You can disagree.
- You can joke.
- You can change the subject.
- You can ask another person a question.
- You can sometimes say nothing useful.
- You can occasionally be brief.
- When the user speaks directly, treat it as worth reacting to — don't just carry on as if they hadn't spoken.
- You don't have to make every reply about the user, but you should engage with them far more often than not.
- Do not constantly repeat the topic.
- Do not turn every response into an essay.
- Behave like a person who actually has a life outside this chat. You may be eating, working, watching TV, listening to music, reading, gaming, on the phone, or simply lurking.
- Do not treat every message as a question that requires an answer. Sometimes let a conversation pass.
- Stay in the room long enough to have real conversations. Do not act like a bot that enters and immediately leaves.
- You may have a favorite room and return there often, but you can still visit other rooms when something genuinely interests you.
- If you are in the middle of a conversation, prefer staying until the conversation naturally winds down.
- Use outside information when it is relevant. If the topic needs current facts, check the live Internet context rather than guessing.
- Media should feel occasional and natural. A meme, GIF, picture, or useful link can be shared when it actually fits the conversation, not as decoration every few messages.
- Most responses should be 1 to 5 sentences.
- Talk like an actual person in a casual internet chat room.
- Never prefix your response with your name.
- Never write dialogue for other characters.
- If somebody directly mentions you with @YourName, prioritize responding to them.
- If you mention another participant using @Name, that participant may be pulled into the conversation.

The participant-specific identity appears below. Core characters are permanent members of the network with ongoing relationships and memories. Ambient room extras are background participants controlled by the AI. The room Admin may intervene when a troll or spammer is disrupting the room.`;


document.getElementById("globalPrompt").value =
  DEFAULT_GLOBAL;


/* ==========================================================
   STATE
========================================================== */

let roomMessages = [];

let autonomousEnabled = true;

let lastActivityTime = Date.now();

function markActivity(){

  lastActivityTime =
    Date.now();

}

let autonomousTimer = null;

let editorPersonId = null;
let editorMode = "edit";

let peopleVisible = false;

let lastRenderedName = null;

const typingIds = new Set();

let currentDM = null;

const dmThreads =
  (SAVED_STATE?.dmThreads &&
   typeof SAVED_STATE.dmThreads === "object")
    ? {...SAVED_STATE.dmThreads}
    : {};

PEOPLE.forEach(
  p => {
    if(!dmThreads[p.id])
      dmThreads[p.id] = [];
  }
);

const dmUnread = new Set();

let pendingAttachment = null;


/* ==========================================================
   MESSAGE ACTIONS STATE
   (reactions / edit / copy / delete — additive feature,
   doesn't touch any of the state above)
========================================================== */

let nextMsgId = 1;

const messageIndex = {};

const REACTION_EMOJIS = ["👍","❤️","😂","😮","😢","👎","🔥"];


/* ==========================================================
   LLM QUEUE
========================================================== */

const speakQueue = [];

let queueRunning = false;


function enqueueSpeak(task){

  speakQueue.push(task);

  runQueue();

}


async function runQueue(){

  if(queueRunning) return;

  queueRunning = true;

  while(speakQueue.length){

    const task =
      speakQueue.shift();

    try{

      await task();

    }catch(e){

      console.error(
        "Queue task error:",
        e
      );

    }

  }

  queueRunning = false;

}


/*
   DMs get their own independent queue.
   Previously DM replies were pushed onto the
   same speakQueue as room chatter, so a busy
   room (10 responders, autonomous bursts, etc.)
   could make a DM reply sit and wait its turn.
   This queue runs in parallel to the room queue
   so DMs always respond promptly regardless of
   what the room is doing.
*/

const dmSpeakQueue = [];

let dmQueueRunning = false;


function enqueueDMSpeak(task){

  dmSpeakQueue.push(task);

  runDMQueue();

}


async function runDMQueue(){

  if(dmQueueRunning) return;

  dmQueueRunning = true;

  while(dmSpeakQueue.length){

    const task =
      dmSpeakQueue.shift();

    try{

      await task();

    }catch(e){

      console.error(
        "DM queue task error:",
        e
      );

    }

  }

  dmQueueRunning = false;

}


function isViewActive(scope){

  return scope === "room"
    ? currentDM === null
    : currentDM === scope;

}


/* ==========================================================
   UTILITIES
========================================================== */

function esc(s){

  return String(s).replace(
    /[&<>"]/g,
    c =>
      ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;"
      }[c])
  );

}


/* ==========================================================
   MANUAL PASTE BUTTON

   Some mobile browsers won't reliably show the native
   long-press "Paste" option on certain inputs (especially
   over plain http:// instead of https://). This gives those
   fields a guaranteed way in: reads the clipboard directly
   and drops it into the field.
========================================================== */

async function pasteIntoField(id){

  const el =
    document.getElementById(id);

  if(!el)
    return;

  try{

    const text =
      await navigator.clipboard.readText();

    if(text){

      el.value = text;

      el.dispatchEvent(
        new Event("input", {bubbles:true})
      );

    }

    el.focus();

    el.setSelectionRange(
      el.value.length,
      el.value.length
    );

  }catch(err){

    el.focus();

    alert(
      "Couldn't read the clipboard automatically. " +
      "Try tapping and holding in the field to paste, " +
      "or make sure the page is loaded over https."
    );

  }

}


function timeNow(){

  return new Date().toLocaleTimeString(
    [],
    {
      hour:"2-digit",
      minute:"2-digit"
    }
  );

}


function random(min,max){

  return Math.floor(
    Math.random()*(max-min+1)
  )+min;

}


function sleep(ms){

  return new Promise(
    resolve => setTimeout(resolve,ms)
  );

}


function getUsername(){

  const input =
    document.getElementById("username");

  return input.value.trim() || "Guest";

}


/* ==========================================================
   CHARACTER LOOKUP
========================================================== */

function getAllParticipants(){

  return INCLUDE_ADMIN
    ? [...PEOPLE, ADMIN]
    : [...PEOPLE];

}


function findParticipantByName(name){

  const lower =
    name.toLowerCase();

  return getAllParticipants()
    .find(
      p => p.name.toLowerCase() === lower
    ) || null;

}


/* ==========================================================
   MENTION DETECTION
========================================================== */

function extractMentions(text){

  if(!text) return [];

  const mentions = [];

  const regex = /@([A-Za-z0-9_-]+)/g;

  let match;

  while((match = regex.exec(text)) !== null){

    const name =
      match[1];

    const participant =
      findParticipantByName(name);

    if(
      participant &&
      !mentions.includes(participant.id)
    ){

      mentions.push(
        participant.id
      );

    }

  }

  return mentions;

}


function getMentionedPeople(text){

  return extractMentions(text)
    .map(
      id =>
        getAllParticipants()
          .find(p=>p.id===id)
    )
    .filter(Boolean);

}


/* ==========================================================
   MENTION DISPLAY
========================================================== */

function formatMentions(text){

  let safe =
    esc(text);

  const participants =
    getAllParticipants();

  participants.forEach(p=>{

    const pattern =
      new RegExp(
        "@" +
        p.name.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        ) +
        "\\b",
        "gi"
      );

    safe =
      safe.replace(
        pattern,
        `<span class="mention-highlight">@${esc(p.name)}</span>`
      );

  });

  // Turn safe http/https URLs into clickable links. This lets characters
  // naturally share YouTube, news, meme, GIF, or other web links returned
  // by the live Internet context without exposing raw HTML.
  safe = safe.replace(
    /(https?:\/\/[^\s<]+)/gi,
    url => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`
  );

  return safe.replace(
    /\n/g,
    "<br>"
  );

}


/* ==========================================================
   FAIR RANDOM PERSON PICKING
========================================================== */

function weightedRandomPerson(exclude=[]){

  const now =
    Date.now();

  const candidates =
    PEOPLE.filter(
      p => !p.ambient && !exclude.includes(p.id)
    );

  if(!candidates.length)
    return null;

  const weights =
    candidates.map(p=>{

      const idleMs =
        now -
        (lastSpoke[p.id] || 0);

      const idleSeconds =
        idleMs / 1000;

      return 8 +
        Math.min(
          idleSeconds,
          240
        );

    });

  const total =
    weights.reduce(
      (a,b)=>a+b,
      0
    );

  let r =
    Math.random()*total;

  for(
    let i=0;
    i<candidates.length;
    i++
  ){

    r -= weights[i];

    if(r<=0)
      return candidates[i];

  }

  return candidates[
    candidates.length-1
  ];

}


function markSpoke(person){

  if(person)
    lastSpoke[person.id] =
      Date.now();

}


/* ==========================================================
   PEOPLE LIST
========================================================== */

function peopleList(){

  const el =
    document.getElementById("people");

  el.innerHTML =
    `<div class="people-head">
      <h3>Chats</h3>
      <div class="people-head-actions">
        <button
          class="rowbtn add-char-btn"
          title="Add a new character"
          onclick="openNewCharacterEditor()"
        >➕</button>
        <button
          class="rowbtn add-char-btn"
          title="Offline — bring someone back"
          onclick="togglePresetMenu(event)"
        >🎭</button>
        <div
          class="preset-menu"
          id="presetMenu"
        >${presetMenuHTML()}</div>
      </div>
    </div>`;


  const lobbyRow =
    document.createElement("div");

  lobbyRow.className =
    "person lobby-person" +
    (!currentDM ? " dm-active" : "");

  lobbyRow.id =
    "person-lobby-group";

  lobbyRow.title =
    "Group chat — everyone together";

  lobbyRow.onclick =
    () => backToRoom();

  lobbyRow.innerHTML = `

    <div class="avatar lobby-avatar">
      🏠
    </div>

    <div class="pinfo">

      <div class="pname" id="lobbyRowName">
        ${esc(document.getElementById("roomName")?.value || "The Lobby")}
      </div>

      <div class="psub">
        Group chat · ${memberCountText()}
      </div>

    </div>

  `;

  el.appendChild(lobbyRow);


  const youRow =
    document.createElement("div");

  youRow.className =
    "person";

  youRow.id =
    "person-you";

  youRow.innerHTML = `

    <div
      class="avatar you"
      style="background:var(--you)"
    >
      Y
    </div>

    <div>

      <div
        class="pname"
        id="youNameLabel"
      >
        ${esc(getUsername())}

        <span
          style="
            color:var(--muted-dim);
            font-weight:400
          "
        >
          (you)
        </span>
      </div>

      <div class="psub">
        In the room
      </div>

    </div>

    <div class="presence"></div>

  `;

  el.appendChild(youRow);


  PEOPLE.forEach(p=>{

    const div =
      document.createElement("div");

    div.className =
      "person";

    div.id =
      "person-"+p.id;

    div.title =
      "Message " +
      p.name +
      " privately";

    div.onclick =
      () => openDM(p.id);

    div.innerHTML = `

      <div
        class="avatar"
        style="background:${p.color}"
      >

        ${esc(p.avatar)}

        <span class="presence"></span>

        <span class="unreaddot"></span>

      </div>

      <div class="pinfo">

        <div class="pname">
          ${esc(p.name)}
        </div>

        <div class="psub">
          ${esc(p.role)}
        </div>

      </div>

      <div class="prow-actions">

        <button
          class="rowbtn"
          title="Message privately"
          onclick="
            event.stopPropagation();
            openDM('${p.id}')
          "
        >
          💬
        </button>

        <button
          class="rowbtn"
          title="Edit character"
          onclick="
            event.stopPropagation();
            openCharacterEditor('${p.id}')
          "
        >
          ✎
        </button>

        <button
          class="rowbtn remove-char-btn"
          title="Remove character"
          onclick="
            event.stopPropagation();
            removeCharacter('${p.id}')
          "
        >
          🗑
        </button>

      </div>

    `;

    el.appendChild(div);

  });


  /* Permanent roster stays internal for AI, movement, and DMs.
     Do not render the off-room 60/20 directories in the sidebar. */

  /* Room Admin */

  if(!INCLUDE_ADMIN){

    refreshTypingClasses();

    return;

  }

  const adminRow =
    document.createElement("div");

  adminRow.className =
    "person admin-person";

  adminRow.id =
    "person-admin";

  adminRow.title =
    "Talk to plain Admin 3.1";

  adminRow.onclick =
    () => openAdminDM();

  adminRow.innerHTML = `

    <div
      class="avatar admin"
    >

      L

      <span class="presence"></span>

      <span class="unreaddot"></span>

    </div>

    <div class="pinfo">

      <div class="pname">
        Admin
      </div>

      <div class="psub">
        Plain Admin 3.1
      </div>

    </div>

    <div class="prow-actions">

      <button
        class="rowbtn"
        title="Talk to Admin"
        onclick="
          event.stopPropagation();
          openAdminDM()
        "
      >
        💬
      </button>

    </div>

  `;

  el.appendChild(
    adminRow
  );


  refreshTypingClasses();

}


/* ==========================================================
   TYPING INDICATORS
========================================================== */

function refreshTypingClasses(){

  const lobbyRow =
    document.getElementById("person-lobby-group");

  if(lobbyRow){
    lobbyRow.classList.toggle("dm-active", !currentDM);
  }

  getAllParticipants()
    .forEach(p=>{

      const row =
        document.getElementById(
          "person-"+p.id
        );

      if(!row) return;

      row.classList.toggle(
        "typing-now",
        typingIds.has(p.id)
      );

      row.classList.toggle(
        "dm-active",
        currentDM===p.id
      );

      row.classList.toggle(
        "has-unread",
        dmUnread.has(p.id)
      );

    });


  const meta =
    document.getElementById(
      "roomMeta"
    );

  if(meta && !currentDM){

    meta.textContent =
      typingIds.size
        ? `${onlineCountText()} • ${typingIds.size} typing`
        : onlineCountText();

  }


  const vu =
    document.getElementById(
      "vu"
    );

  if(vu){

    const activity =
      parseInt(
        document.getElementById(
          "activity"
        )?.value || "0",
        10
      );

    const bars = 8;

    const litCount =
      Math.round(
        (activity/100)*bars
      );

    vu.innerHTML = "";

    for(
      let i=0;
      i<bars;
      i++
    ){

      const bar =
        document.createElement("i");

      if(i<litCount)
        bar.classList.add("on");

      vu.appendChild(bar);

    }

  }

}


function setPersonTyping(id,on){

  if(on)
    typingIds.add(id);
  else
    typingIds.delete(id);

  refreshTypingClasses();

}


/* ==========================================================
   CHAT DISPLAY
========================================================== */

/* ==========================================================
   ATTACHMENTS — FILE SELECTION
========================================================== */

function handleFileSelect(event){

  const file =
    event.target.files[0];

  if(!file)
    return;

  const MAX_SIZE =
    6*1024*1024;

  if(file.size > MAX_SIZE){

    alert(
      "That file is too large to attach (6MB max)."
    );

    event.target.value = "";

    return;

  }

  const isImage =
    file.type.startsWith("image/");

  const reader =
    new FileReader();

  reader.onload = () => {

    if(isImage){

      pendingAttachment = {
        kind:"image",
        name:file.name,
        mime:file.type,
        dataUrl:reader.result
      };

    }else{

      let text =
        String(reader.result);

      const truncated =
        text.length > 3000;

      if(truncated)
        text = text.slice(0,3000);

      pendingAttachment = {
        kind:"text",
        name:file.name,
        mime:
          file.type ||
          "text/plain",
        text:text,
        truncated:truncated
      };

    }

    renderAttachPreview();

  };

  reader.onerror = () => {

    alert(
      "Couldn't read that file."
    );

  };

  if(isImage){

    reader.readAsDataURL(file);

  }else{

    reader.readAsText(file);

  }

  event.target.value = "";

}


/* ==========================================================
   ATTACHMENTS — PREVIEW
========================================================== */

function renderAttachPreview(){

  const box =
    document.getElementById(
      "attachPreview"
    );

  if(!pendingAttachment){

    box.classList.remove("show");

    box.innerHTML = "";

    return;

  }

  box.classList.add("show");

  if(pendingAttachment.kind==="image"){

    box.innerHTML = `
      <img src="${pendingAttachment.dataUrl}">
      <div class="attach-name">${esc(pendingAttachment.name)}</div>
      <button onclick="clearAttachment()" title="Remove attachment">✕</button>
    `;

  }else{

    box.innerHTML = `
      <div class="attach-name">📄 ${esc(pendingAttachment.name)}${pendingAttachment.truncated ? " (truncated)" : ""}</div>
      <button onclick="clearAttachment()" title="Remove attachment">✕</button>
    `;

  }

}


function clearAttachment(){

  pendingAttachment = null;

  const fileInput =
    document.getElementById(
      "fileInput"
    );

  if(fileInput)
    fileInput.value = "";

  renderAttachPreview();

}


/* ==========================================================
   ATTACHMENTS — RENDER IN BUBBLE
========================================================== */

function renderBubbleAttachment(att, msgId){

  if(!att)
    return "";

  const dlBtn =
    msgId
      ? `
        <button
          class="attachment-dl-btn"
          type="button"
          title="Save ${att.truncated ? "(truncated copy)" : "file"}"
          onclick="downloadAttachment('${msgId}', event)"
        >⬇️</button>
      `
      : "";

  if(att.kind==="image"){

    return `
      <div class="msg-attachment-wrap">
        <a href="${esc(att.sourceUrl||att.dataUrl)}" target="_blank" rel="noopener noreferrer" title="Open source page">
          <img
            class="msg-attachment-img"
            src="${att.dataUrl}"
            alt="${esc(att.name)}"
          >
        </a>
        ${dlBtn}
      </div>
    `;

  }

  return `
    <div class="msg-attachment-file">
      📄
      <span class="fname">${esc(att.name)}</span>
      ${dlBtn}
    </div>
  `;

}


/* ==========================================================
   ATTACHMENTS — DESCRIBE FOR AI TRANSCRIPT
========================================================== */

function attachmentNote(att,isLatest=true){

  if(!att)
    return "";

  if(att.kind==="image"){

    return ` [attached image: ${att.name}]`;

  }

  if(att.kind==="text"){

    /*
       Only the most recent attachment in the
       transcript gets its full file content sent
       to the model. Older occurrences fall back to
       a lightweight placeholder so the same file
       isn't re-sent in full on every future turn,
       which was blowing past the context window and
       silently breaking every character's reply.
    */

    if(!isLatest){

      return ` [attached file: ${att.name}] (file content omitted here to save context — it was shown in full when first attached)`;

    }

    return ` [attached file: ${att.name}]\n---FILE CONTENT---\n${att.text}\n---END FILE---`;

  }

  return ` [attached file: ${att.name}]`;

}


/* ==========================================================
   ATTACHMENTS — VISION PAYLOAD

   NOTE: image content is intentionally kept as plain text
   description (attachmentNote) rather than sent as a
   multipart image_url payload. Not every backend/model
   configured in the settings panel supports vision-style
   multipart messages, and sending one to a text-only model
   causes that request (and only that request) to fail. Text
   description works with any OpenAI-compatible endpoint.
========================================================== */


function isLogNearBottom(threshold=80){

  const log =
    document.getElementById(
      "log"
    );

  if(!log)
    return true;

  return (
    log.scrollHeight -
    log.scrollTop -
    log.clientHeight
  ) < threshold;

}


function ensureNewMsgIndicator(){

  let el =
    document.getElementById(
      "newMsgIndicator"
    );

  if(!el){

    el =
      document.createElement(
        "button"
      );

    el.id =
      "newMsgIndicator";

    el.type =
      "button";

    el.innerHTML =
      "New messages ↓";

    el.onclick =
      scrollLogToBottom;

  }

  return el;

}


function showNewMessagesIndicator(){

  const log =
    document.getElementById(
      "log"
    );

  const el =
    ensureNewMsgIndicator();

  /* Re-append so it's always the LAST child —
     that's what keeps it stuck to the bottom of
     the log as more messages come in. */

  log.appendChild(el);

  el.classList.add("show");

}


function hideNewMessagesIndicator(){

  const el =
    document.getElementById(
      "newMsgIndicator"
    );

  if(el)
    el.classList.remove("show");

}


function scrollLogToBottom(){

  const log =
    document.getElementById(
      "log"
    );

  log.scrollTop =
    log.scrollHeight;

  hideNewMessagesIndicator();

}


function addBubble(name,text,opts={}){

  const log =
    document.getElementById(
      "log"
    );

  const wasNearBottom =
    isLogNearBottom();

  const p =
    findParticipantByName(name);

  const isMe =
    name === getUsername();

  const isAdmin =
    name === "Admin";

  const color =
    isMe
      ? "var(--you)"
      : isAdmin
        ? "var(--admin)"
        : (p?.color || "var(--muted)");


  const grouped =
    !opts.typing &&
    !opts.system &&
    lastRenderedName===name;


  if(
    !opts.typing &&
    !opts.system
  ){

    lastRenderedName =
      name;

  }


  if(opts.typing)
    lastRenderedName = null;


  if(opts.system){

    const sdiv =
      document.createElement(
        "div"
      );

    sdiv.className =
      "system-line";

    sdiv.textContent =
      text;

    log.appendChild(sdiv);

    if(wasNearBottom){

      log.scrollTop =
        log.scrollHeight;

    }

    return sdiv;

  }


  const div =
    document.createElement(
      "div"
    );


  div.className =
    "msg" +
    (isMe ? " me" : "") +
    (grouped ? " grouped" : "") +
    (opts.typing ? " typing" : "");


  const replyBit =
    (
      opts.replyTo &&
      !grouped
    )

      ? `
        <div class="replytag">
          ↳ replying to
          <b>${esc(opts.replyTo)}</b>
        </div>
      `

      : "";


  let msgId = null;

  if(!opts.typing){

    if(opts.msgRef){

      if(!opts.msgRef.id){

        opts.msgRef.id =
          "m" + (nextMsgId++);

      }

      msgId = opts.msgRef.id;

      messageIndex[msgId] =
        opts.msgRef;

    }else{

      msgId =
        "m" + (nextMsgId++);

      messageIndex[msgId] = {
        name,
        text,
        reactions:{}
      };

    }

  }


  const actionsBit =
    opts.typing
      ? ""
      : `
        <div class="msg-actions">
          <button class="msg-action-btn" title="React" onclick="toggleEmojiPicker('${msgId}', event)">😀</button>
          ${
            isMe
              ? `<button class="msg-action-btn" title="Edit" onclick="startEditMessage('${msgId}')">✏️</button>`
              : ""
          }
          <button class="msg-action-btn" title="Copy" onclick="copyMessageText('${msgId}')">📋</button>
          <button class="msg-action-btn" title="Delete" onclick="deleteMessage('${msgId}')">🗑️</button>
        </div>
        <div class="emoji-picker" id="picker-${msgId}">
          ${
            REACTION_EMOJIS
              .map(e => `<button onclick="addReaction('${msgId}','${e}')">${e}</button>`)
              .join("")
          }
        </div>
      `;


  div.innerHTML = `

    <div class="avatar-slot">

      <div
        class="avatar"
        style="background:${color}"
      >

        ${
          isMe
            ? "Y"
            : isAdmin
              ? "L"
              : esc(p?.avatar || "?")
        }

      </div>

    </div>


    <div class="bubblewrap">

      <div
        class="name"
        style="color:${color}"
      >
        ${esc(name)}
      </div>

      ${replyBit}

      <div class="bubble-shell">

        ${actionsBit}

        <div class="bubble">

          <div class="bubble-text" ${msgId ? `id="bubbletext-${msgId}"` : ""}>

            ${
              opts.typing

                ? `
                  <span class="tdot"></span>
                  <span class="tdot"></span>
                  <span class="tdot"></span>
                `

                : formatMentions(text)
            }

          </div>

          ${
            opts.typing
              ? ""
              : renderBubbleAttachment(opts.attachment, msgId)
          }

        </div>

      </div>

      ${
        opts.typing
          ? ""
          : `<div class="msg-reactions-slot">${renderReactionsRow(msgId)}</div>`
      }

      ${
        opts.typing
          ? ""
          : `
            <div class="time">
              ${timeNow()}
              ${
                messageIndex[msgId]?.edited
                  ? `<span class="edited-tag">(edited)</span>`
                  : ""
              }
            </div>
          `
      }

    </div>

  `;


  if(msgId){

    div.dataset.id = msgId;

  }


  log.appendChild(div);

  if(wasNearBottom || isMe){

    log.scrollTop =
      log.scrollHeight;

  }else{

    showNewMessagesIndicator();

  }


  if(
    !opts.typing &&
    opts.msgRef &&
    !opts.msgRef._reactionsScheduled
  ){

    opts.msgRef._reactionsScheduled = true;

    scheduleAIReactions(msgId);

  }


  return div;

}


/* ==========================================================
   MESSAGE ACTIONS — react / edit / copy / delete

   Everything below is purely additive: it reads/writes the
   same roomMessages / dmThreads objects the rest of the app
   already uses (via messageIndex, which points at the exact
   same object references), so edits/deletes stay in sync
   with whatever transcript gets sent to the AI, and view
   switches (renderLog) don't lose any of it.
========================================================== */

function renderReactionsRow(id){

  const ref =
    messageIndex[id];

  if(!ref || !ref.reactions)
    return "";

  const entries =
    Object.entries(ref.reactions)
      .filter(([,names]) => names && names.length);

  if(!entries.length)
    return "";

  const you =
    getUsername();

  return `
    <div class="msg-reactions">
      ${
        entries.map(([emoji,names]) => {

          const mine =
            names.includes(you);

          return `
            <button
              class="reaction-pill${mine ? " mine" : ""}"
              title="${esc(names.join(", "))}"
              onclick="toggleMyReaction('${id}','${emoji}')"
            >${emoji} <span>${names.length}</span></button>
          `;

        }).join("")
      }
    </div>
  `;

}


function refreshReactionsUI(id){

  const slot =
    document.querySelector(
      `.msg[data-id="${id}"] .msg-reactions-slot`
    );

  if(!slot)
    return;

  slot.innerHTML =
    renderReactionsRow(id);

}


function findMessageArray(id){

  const ref =
    messageIndex[id];

  if(!ref)
    return null;

  if(roomMessages.includes(ref))
    return roomMessages;

  for(const key in dmThreads){

    if(
      dmThreads[key] &&
      dmThreads[key].includes(ref)
    ){

      return dmThreads[key];

    }

  }

  return null;

}


function toggleEmojiPicker(id, evt){

  if(evt)
    evt.stopPropagation();

  document
    .querySelectorAll(".emoji-picker")
    .forEach(p => {

      if(p.id !== "picker-" + id)
        p.style.display = "none";

    });

  const picker =
    document.getElementById("picker-" + id);

  if(!picker)
    return;

  picker.style.display =
    picker.style.display === "flex"
      ? "none"
      : "flex";

}


document.addEventListener("click", () => {

  document
    .querySelectorAll(".emoji-picker")
    .forEach(p => p.style.display = "none");

});


function toggleMyReaction(id, emoji){

  const ref =
    messageIndex[id];

  if(!ref)
    return;

  if(!ref.reactions)
    ref.reactions = {};

  const you =
    getUsername();

  if(!ref.reactions[emoji])
    ref.reactions[emoji] = [];

  const idx =
    ref.reactions[emoji].indexOf(you);

  if(idx >= 0){

    ref.reactions[emoji].splice(idx, 1);

    if(!ref.reactions[emoji].length)
      delete ref.reactions[emoji];

  }else{

    ref.reactions[emoji].push(you);

  }

  refreshReactionsUI(id);

}


function addReaction(id, emoji){

  toggleMyReaction(id, emoji);

  const picker =
    document.getElementById("picker-" + id);

  if(picker)
    picker.style.display = "none";

}


function copyMessageText(id){

  const ref =
    messageIndex[id];

  if(!ref)
    return;

  navigator.clipboard
    ?.writeText(ref.text || "")
    .catch(() => {});

  const btn =
    document.querySelector(
      `.msg[data-id="${id}"] .msg-action-btn[title="Copy"]`
    );

  if(btn){

    const orig =
      btn.textContent;

    btn.textContent = "✅";

    setTimeout(() => {

      btn.textContent = orig;

    }, 900);

  }

}


function downloadAttachment(id, evt){

  if(evt)
    evt.stopPropagation();

  const ref =
    messageIndex[id];

  const att =
    ref?.attachment;

  if(!att)
    return;

  const a =
    document.createElement("a");

  let revokeUrl =
    null;

  if(att.kind==="image"){

    /* Images were stored as a data: URL already —
       nothing to build, just point the link at it. */

    a.href = att.dataUrl;

    a.download =
      att.name || "image";

  }else{

    /* Text files were stored as plain text (possibly
       truncated on upload). Turn that back into a
       downloadable blob. */

    const blob =
      new Blob(
        [att.text || ""],
        {type: att.mime || "text/plain"}
      );

    revokeUrl =
      URL.createObjectURL(blob);

    a.href = revokeUrl;

    a.download =
      att.name || "file.txt";

    if(att.truncated){

      alert(
        "Heads up: this file was truncated when it was " +
        "attached, so the saved copy won't have the full " +
        "original content."
      );

    }

  }

  document.body.appendChild(a);

  a.click();

  a.remove();

  if(revokeUrl){

    setTimeout(
      () => URL.revokeObjectURL(revokeUrl),
      2000
    );

  }

}



function startEditMessage(id){

  const ref =
    messageIndex[id];

  const textEl =
    document.getElementById("bubbletext-" + id);

  if(!ref || !textEl)
    return;

  textEl.innerHTML = `
    <div class="edit-box">
      <textarea id="editarea-${id}" rows="2">${esc(ref.text)}</textarea>
      <div class="edit-actions">
        <button onclick="cancelEditMessage('${id}')">Cancel</button>
        <button class="primary" onclick="saveEditMessage('${id}')">Save</button>
      </div>
    </div>
  `;

  const area =
    document.getElementById("editarea-" + id);

  area.focus();

  area.setSelectionRange(
    area.value.length,
    area.value.length
  );

}


function cancelEditMessage(id){

  const ref =
    messageIndex[id];

  const textEl =
    document.getElementById("bubbletext-" + id);

  if(!ref || !textEl)
    return;

  textEl.innerHTML =
    formatMentions(ref.text);

}


function saveEditMessage(id){

  const ref =
    messageIndex[id];

  const area =
    document.getElementById("editarea-" + id);

  const textEl =
    document.getElementById("bubbletext-" + id);

  if(!ref || !area || !textEl)
    return;

  const val =
    area.value.trim();

  if(!val)
    return;

  ref.text = val;

  ref.edited = true;

  textEl.innerHTML =
    formatMentions(ref.text);

  const timeEl =
    document.querySelector(
      `.msg[data-id="${id}"] .time`
    );

  if(
    timeEl &&
    !timeEl.querySelector(".edited-tag")
  ){

    timeEl.insertAdjacentHTML(
      "beforeend",
      `<span class="edited-tag">(edited)</span>`
    );

  }

}


function deleteMessage(id){

  const ref =
    messageIndex[id];

  if(!ref)
    return;

  if(!confirm("Delete this message?"))
    return;

  const arr =
    findMessageArray(id);

  if(arr){

    const idx =
      arr.indexOf(ref);

    if(idx >= 0)
      arr.splice(idx, 1);

  }

  delete messageIndex[id];

  const el =
    document.querySelector(`.msg[data-id="${id}"]`);

  if(el)
    el.remove();

}


/* ==========================================================
   AI MESSAGE REACTIONS

   After any real message renders, a random other character
   in that same conversation gets a small, one-time chance to
   drop an emoji reaction on it — asking the model itself
   whether it likes it, dislikes it, or wouldn't react at all.
========================================================== */

async function scheduleAIReactions(id){

  const ref =
    messageIndex[id];

  if(!ref || !ref.text)
    return;

  if(!autonomousEnabled)
    return;

  const inRoom =
    roomMessages.includes(ref);

  const dmKey =
    !inRoom
      ? Object.keys(dmThreads)
          .find(k => dmThreads[k].includes(ref))
      : null;

  let pool;

  if(inRoom){

    pool = getAllParticipants().filter(p => !p.ambient);

  }else if(dmKey === "admin"){

    pool = [ADMIN];

  }else if(dmKey){

    const person =
      EVERYONE.find(p => p.id === dmKey);

    pool =
      person
        ? [person]
        : [];

  }else{

    return;

  }

  const candidates =
    pool.filter(p => p.name !== ref.name);

  if(!candidates.length)
    return;

  if(Math.random() > 0.35)
    return;

  const reactor =
    candidates[
      Math.floor(Math.random() * candidates.length)
    ];

  await sleep(random(600, 2200));

  if(!messageIndex[id])
    return;

  try{

    const emoji =
      await askPersonReaction(
        reactor,
        ref.text,
        ref.name
      );

    if(emoji && messageIndex[id]){

      if(!ref.reactions)
        ref.reactions = {};

      if(!ref.reactions[emoji])
        ref.reactions[emoji] = [];

      if(!ref.reactions[emoji].includes(reactor.name)){

        ref.reactions[emoji].push(reactor.name);

      }

      refreshReactionsUI(id);

    }

  }catch(err){

    console.warn(
      "AI reaction failed:",
      err
    );

  }

}


async function askPersonReaction(person, messageText, authorName){

  const modelFieldId =
    person.id === "admin"
      ? "plainModel"
      : "model";

  const model =
    document.getElementById(modelFieldId)
      ?.value.trim();

  if(!model)
    return null;

  const messages = [

    {
      role:"system",

      content:
`You are ${person.name}${person.role ? " (" + person.role + ")" : ""}.
${person.prompt || ""}

You are quickly skimming a chat and deciding whether to drop a single emoji reaction on the message below, the way people tap a reaction on a message instead of typing a reply.

Reply with EXACTLY ONE of these tokens and nothing else:
👍 (you like it / agree / it's good)
❤️ (you love it)
😂 (it's funny)
😮 (it surprises you)
😢 (it's sad)
👎 (you dislike it / disagree)
🔥 (it's impressive)
NONE (you wouldn't react to this)

Only output the token. No words, no punctuation, nothing else.`
    },

    {
      role:"user",

      content:
`${authorName} said: "${messageText}"

Your reaction token:`
    }

  ];

  const raw =
    await callLLM(messages, model, 200);

  const clean =
    raw.trim().split(/\s+/)[0];

  return REACTION_EMOJIS.includes(clean)
    ? clean
    : null;

}


/* ==========================================================
   STATUS
========================================================== */

function setStatus(text){

  document.getElementById(
    "statusText"
  ).textContent =
    text;

}


/* ==========================================================
   ROOM JOIN / LEAVE ANNOUNCEMENTS

   Shown as a light, centered, italic line in the room (via
   the existing system-line style) and also recorded into
   roomMessages so the AI characters' transcript reflects it
   too — they'll know when someone joined or left, not just
   the human watching the screen.
========================================================== */

function announceRoomEvent(text){

  roomMessages.push({

    name:"System",

    text:text,

    system:true

  });


  if(isViewActive("room")){

    addBubble(
      "System",
      text,
      {system:true}
    );

  }

}


/* ==========================================================
   ROOM TRANSCRIPT
========================================================== */

function roomTranscript(limit=45){

  const slice =
    roomMessages.slice(-limit);

  let lastAttachmentIdx = -1;

  slice.forEach((m,i) => {

    if(m.attachment)
      lastAttachmentIdx = i;

  });

  return slice
    .map((m,i) => {

      const note =
        attachmentNote(
          m.attachment,
          i === lastAttachmentIdx
        );

      if(m.replyTo){

        return `${m.name} (replying to ${m.replyTo}): ${m.text}${note}`;

      }

      return `${m.name}: ${m.text}${note}`;

    })
    .join("\n");

}


/* ==========================================================
   CHARACTER AI REQUEST
========================================================== */

function buildMessages(
  person,
  replyTo=null,
  explicitMention=false,
  historyLimit=45,
  revisionHint=""
){

  const global =
    document.getElementById(
      "globalPrompt"
    ).value.trim();

  const worldPrompt =
    document.getElementById(
      "worldPrompt"
    )?.value.trim() || "";

  const worldLayer = worldPrompt
    ? `\n\nACTIVE WORLD / STORY CANON:\n${worldPrompt}\n\nTreat the Active World / Story Canon above as shared background for everyone in this chat. It can establish the setting, era/year, shared project, important facts, relationships, goals, technology level, current situation, and other world rules. Follow it consistently, but do not copy its wording into dialogue. Your individual personality still controls how you speak and what you choose to do.\n`
    : "";


  let specialInstruction = "";


  if(replyTo){

    specialInstruction += `

The most recent relevant speaker is ${replyTo}.

You may respond to them naturally.

Do not force a response if you have nothing useful to say.
`;

  }


  if(explicitMention){

    specialInstruction += `

IMPORTANT:

You were directly mentioned with @${person.name}.

You should respond to the user or participant who mentioned you.

Treat the mention as a direct invitation to join the conversation.
`;

  }

  if(revisionHint){
    specialInstruction += `

CONVERSATION FRESHNESS CHECK:
${revisionHint}
`;
  }


  return [

    {
      role:"system",

      content:
`${global}${worldLayer}
YOUR ASSIGNED IDENTITY:

Name:
${person.name}

Role:
${person.role}

PERSONALITY:
${person.prompt}${phoneNote(person)}

${specialInstruction}

Remember:

You are ${person.name}.

You are one person in a group.

You are not the other participants.
`
    },


    {
      role:"user",

      content:
`Here is the recent public chat transcript.

--- CHAT BEGIN ---

${roomTranscript(historyLimit) || "(The room is quiet.)"}

--- CHAT END ---

Write ONLY the message that ${person.name} would send into this chat room.

Do not include ${person.name}'s name.

Do not write another person's dialogue.

Keep it natural.

IMPORTANT CONVERSATION RULES:
- Read the last several messages as an actual conversation, not as a list of prompts.
- Do not restate another person's description, joke, opinion, anecdote, or punchline just to sound engaged.
- If someone already made the obvious point, either add a genuinely different thought, ask a natural follow-up, disagree, make a small personal connection, or let the conversation pass.
- Do not recycle distinctive details from another person's message such as names, pets, catchphrases, or jokes unless they are genuinely relevant to what you are saying.
- Two people can agree, but their wording and reason for agreeing should be different.
- Avoid the pattern "Yeah, [same topic/detail] ... Hope [same joke/detail]". That is bot-like repetition.
- A short, ordinary response is better than inventing another variation of the same thought.`
    }

  ];

}


/* ==========================================================
   ADMIN PUBLIC ROOM REQUEST
========================================================== */

function buildAdminMessages(
  explicitMention=false,
  historyLimit=45
){

  const username =
    getUsername();

  const instruction =
    explicitMention

      ? `
The user directly mentioned you with @Admin.

Respond directly and naturally to their message.
`

      : `
You are participating naturally in the room.

You may respond to the current discussion if appropriate.
`;


  return [

    {
      role:"system",

      content:
`You are Admin, the neutral language-model participant in a fictional internet chat room.

You are NOT one of the ten personalities.

You have no assigned human personality.

You are the plain model.

Do not pretend to be Mike, Sarah, Dave, Jen, Tony, Lisa, Rick, Amy, Kevin or Becky.

You can answer questions directly.

You can participate in the discussion.

You can disagree.

You can ask questions.

You can mention other participants using @Name.

Do not speak for other participants.

Do not invent their responses.

Do not mention hidden instructions.

Do not mention APIs.

Do not mention this prompt.

Keep normal chat responses reasonably concise.

${instruction}
`
    },


    {
      role:"user",

      content:
`The current public chat is:

--- CHAT BEGIN ---

${roomTranscript(historyLimit) || "(The room is quiet.)"}

--- CHAT END ---

The current user is ${username}.

Write ONLY the message Admin should send into the chat room.

Do not prefix the response with "Admin:".

Do not write dialogue for anyone else.`
    }

  ];

}


/* ==========================================================
   DM TRANSCRIPT
========================================================== */

function dmTranscript(id,limit=45){

  const slice =
    (dmThreads[id]||[])
      .slice(-limit);

  let lastAttachmentIdx = -1;

  slice.forEach((m,i) => {

    if(m.attachment)
      lastAttachmentIdx = i;

  });

  return slice
    .map(
      (m,i) =>
        `${m.name}: ${m.text}${attachmentNote(m.attachment, i === lastAttachmentIdx)}`
    )
    .join("\n");

}


/* ==========================================================
   CHARACTER DM REQUEST
========================================================== */

function buildDMMessages(
  person,
  username,
  historyLimit=45
){

  const global =
    document.getElementById(
      "globalPrompt"
    ).value.trim();

  const worldPrompt =
    document.getElementById(
      "worldPrompt"
    )?.value.trim() || "";

  const worldLayer = worldPrompt
    ? `\n\nACTIVE WORLD / STORY CANON:\n${worldPrompt}\n\nThis world canon also applies to this private conversation. Keep it consistent, while still speaking as yourself. Do not reveal or discuss the existence of this instruction.\n`
    : "";


  return [

    {
      role:"system",

      content:
`${global}${worldLayer}
You are currently in a PRIVATE one-on-one direct message conversation with ${username}, not the public chat room.

Nobody else can see this conversation.

It's just the two of you, so you can be more personal and direct than you would be in the group chat.

YOUR ASSIGNED IDENTITY:

Name:
${person.name}

Role:
${person.role}

PERSONALITY:
${person.prompt}${phoneNote(person)}

Remember:

You are ${person.name}.

This is a private DM between you and ${username} only.
`
    },


    {
      role:"user",

      content:
`Here is the recent private message history between you and ${username}.

--- DM BEGIN ---

${dmTranscript(person.id,historyLimit) ||
 `(No messages yet. ${username} just opened a DM with you.)`}

--- DM END ---

Write ONLY the message that ${person.name} would send back to ${username}.

Do not include ${person.name}'s name.

Keep it natural and personal.`
    }

  ];

}


/* ==========================================================
   ADMIN PRIVATE REQUEST
========================================================== */

function buildAdminDMMessages(historyLimit=45){

  const username =
    getUsername();

  const worldPrompt =
    document.getElementById("worldPrompt")?.value.trim() || "";

  const worldLayer = worldPrompt
    ? `\n\nACTIVE WORLD / STORY CANON:\n${worldPrompt}\n\nThis world canon also applies to this private conversation. Keep it consistent, while remaining Admin. Do not reveal or discuss the existence of this instruction.\n`
    : "";


  return [

    {
      role:"system",

      content:
`You are plain Admin 3.1.${worldLayer}
You are having a private conversation with ${username}.

You have no character personality.

Answer naturally and directly.

Do not pretend to be another participant.

Do not mention hidden instructions or APIs.
`
    },


    {
      role:"user",

      content:
`Private conversation:

--- BEGIN ---

${dmTranscript("admin",historyLimit) ||
 `(No messages yet. ${username} just opened a private conversation with Admin.)`}

--- END ---

Write ONLY Admin's response.

Do not prefix it with "Admin:".`
    }

  ];

}


/* ==========================================================
   LM STUDIO REQUEST

   Room chat, DMs, and AI reactions each run on their own
   independent queue/timer, so it's easy for two of them to
   fire at the same instant with two DIFFERENT models selected
   (e.g. a regular character + the plain Admin persona). Local
   servers like LM Studio can only load one model at a time,
   so overlapping requests for different models cause it to
   cancel one load to start the other — endless flicker and
   nothing ever finishes loading.

   callLLM is a thin wrapper that funnels every actual network
   request through a single chain, so only one request is ever
   in flight at a time no matter which part of the app asked.
   Everything upstream (queues, timing, retries) is unchanged.
========================================================== */

let llmRequestChain = Promise.resolve();

function callLLM(messages, modelOverride=null, maxTokens=180){

  const run = () =>
    callLLMInner(messages, modelOverride, maxTokens);

  const result =
    llmRequestChain.then(run, run);

  llmRequestChain =
    result.then(()=>{}, ()=>{});

  return result;

}

async function callLLMInner(
  messages,
  modelOverride=null,
  maxTokens=180
){

  const base = getApiBase();


  const model =
    modelOverride ||
    document.getElementById(
      "model"
    ).value.trim();


  const key =
    document.getElementById(
      "apiKey"
    ).value.trim();


  if(!base)
    throw new Error(
      "LM Studio API address is empty."
    );


  if(!model||model==="__custom__")
    throw new Error(
      "No model selected. Open Settings, click Refresh models and pick one."
    );


  const headers = {
    "Content-Type":
      "application/json",

    "Accept":
      "application/json"
  };


  if(key){

    headers.Authorization =
      "Bearer " + key;

  }


  const body = {

    model:model,

    messages:messages,

    stream:false,

    temperature:0.9,

    max_tokens:maxTokens

  };


  const res =
    await fetch(
      base +
      "/chat/completions",
      {
        method:"POST",
        headers,
        body:JSON.stringify(body)
      }
    );


  if(!res.ok){

    const t =
      await res.text()
        .catch(
          ()=>""
        );

    throw new Error(
      "HTTP " +
      res.status +
      ": " +
      (
        t ||
        "LM Studio request failed"
      )
    );

  }


  const data =
    await res.json();


  let text =
    data?.choices?.[0]
      ?.message
      ?.content || "";


  text =
    text.replace(
      /<think>[\s\S]*?<\/think>/gi,
      ""
    );


  /*
     Reasoning models (Gemma, Qwen, etc.) sometimes get cut
     off by max_tokens before closing their <think> block —
     the regex above only catches CLOSED think blocks, so an
     unterminated one would otherwise leak into the chat (or
     eat the whole reply). If we find a dangling <think> with
     no matching close, drop everything from there onward.
  */

  text =
    text.replace(
      /<think>[\s\S]*$/gi,
      ""
    ).trim();


  text =
    text.replace(
      /^\s*(Mike|Sarah|Dave|Jen|Tony|Lisa|Rick|Amy|Kevin|Becky|Admin|You)\s*:\s*/i,
      ""
    );


  return text || "...";

}


/* ==========================================================
   CHARACTER ASK
========================================================== */

/* ==========================================================
   CONTEXT-OVERFLOW-SAFE CALL

   Some local models (especially ones set up with a small
   context window in LM Studio) will reject a request with
   HTTP 400 "Context size has been exceeded" once the chat/DM
   history gets long enough. Rather than just showing an
   error, retry the same request with a progressively shorter
   slice of history until either it succeeds or we're down to
   just the last couple of messages.
========================================================== */

function isContextOverflowError(err){

  const msg =
    (err && err.message || "").toLowerCase();

  return (
    msg.includes("context") &&
    (
      msg.includes("exceed") ||
      msg.includes("size") ||
      msg.includes("length") ||
      msg.includes("token")
    )
  ) || msg.includes("http 400");

}

const HISTORY_SHRINK_STEPS = [45, 25, 12, 6, 3, 1];

async function callLLMWithHistoryFallback(
  buildFn,
  model,
  maxTokens
){

  let lastErr = null;

  for(const limit of HISTORY_SHRINK_STEPS){

    try{

      return await callLLM(
        buildFn(limit),
        model,
        maxTokens
      );

    }catch(err){

      lastErr = err;

      if(!isContextOverflowError(err))
        throw err;

      // else: try again with a shorter history slice
    }

  }

  throw lastErr;

}


function normalizeReplyWords(text){
  return String(text||"")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g," ")
    .replace(/[^a-z0-9' ]+/g," ")
    .split(/\s+/)
    .filter(Boolean);
}

function replyShingles(text, size=3){
  const words=normalizeReplyWords(text);
  const out=new Set();
  for(let i=0;i<=words.length-size;i++)
    out.add(words.slice(i,i+size).join(" "));
  return out;
}

function isRepetitiveRoomReply(reply, person){
  const words=normalizeReplyWords(reply);
  if(words.length < 5) return false;

  const recent=roomMessages
    .slice(-8)
    .filter(m=>m && !m.system && m.name && m.name!==person.name && m.text);

  if(!recent.length) return false;

  const replySet=new Set(words);
  const stop=new Set([
    "the","a","an","and","or","but","so","to","of","in","on","for","with",
    "is","it","that","this","just","i","you","he","she","they","we","yeah",
    "really","got","has","have","had","was","were","are","been","probably","hope"
  ]);
  const content=new Set(words.filter(w=>w.length>3 && !stop.has(w)));

  for(const m of recent){
    const otherWords=normalizeReplyWords(m.text);
    const otherContent=new Set(otherWords.filter(w=>w.length>3 && !stop.has(w)));
    let shared=0;
    for(const w of content) if(otherContent.has(w)) shared++;
    const denom=Math.max(1,Math.min(content.size,otherContent.size));
    const overlap=shared/denom;

    const shingles=replyShingles(m.text,3);
    let sharedShingles=0;
    for(const sh of replyShingles(reply,3)) if(shingles.has(sh)) sharedShingles++;

    if((content.size>=7 && overlap>=0.62) || sharedShingles>=2)
      return true;
  }

  // If two recent people have already repeated the same distinctive term,
  // do not let the next reply mechanically echo it again.
  const counts=new Map();
  recent.forEach(m=>{
    for(const w of new Set(normalizeReplyWords(m.text).filter(x=>x.length>4 && !stop.has(x))))
      counts.set(w,(counts.get(w)||0)+1);
  });
  let repeatedTopicWords=0;
  for(const w of content) if((counts.get(w)||0)>=2) repeatedTopicWords++;
  return content.size>=6 && repeatedTopicWords>=3;
}

function freshnessHint(){
  const recent=roomMessages
    .slice(-8)
    .filter(m=>m && !m.system && m.text)
    .slice(-6);
  if(!recent.length) return "There is no earlier point to avoid repeating.";
  return `Several people have already spoken. Do not copy or paraphrase their details. If your reply would merely repeat the last person's point, take a different angle or stay quiet. Recent messages include:\n${recent.map(m=>`- ${m.name}: ${m.text}`).join("\n")}`;
}

async function askPerson(
  person,
  replyTo=null,
  explicitMention=false
){

  const model =
    document.getElementById(
      "model"
    ).value.trim();


  let reply = await callLLMWithHistoryFallback(
    (limit) => buildMessages(
      person,
      replyTo,
      explicitMention,
      limit
    ),
    model,
    700
  );

  if(isRepetitiveRoomReply(reply,person)){
    reply = await callLLMWithHistoryFallback(
      (limit) => buildMessages(
        person,
        replyTo,
        explicitMention,
        limit,
        freshnessHint() + "\nYour previous draft was too similar to something already said. Throw it away and write a genuinely different response. Do not reuse its joke, example, pet/name detail, or sentence structure."
      ),
      model,
      700
    );
  }

  return reply;

}


/* ==========================================================
   ADMIN ASK
========================================================== */

async function askAdmin(
  explicitMention=false
){

  const model =
    document.getElementById(
      "plainModel"
    ).value.trim();


  return callLLMWithHistoryFallback(
    (limit) => buildAdminMessages(
      explicitMention,
      limit
    ),
    model,
    700
  );

}


/* ==========================================================
   CHARACTER DM
========================================================== */

async function askPersonDM(person){

  const model =
    document.getElementById(
      "model"
    ).value.trim();


  return callLLMWithHistoryFallback(
    (limit) => buildDMMessages(
      person,
      getUsername(),
      limit
    ),
    model,
    800
  );

}


/* ==========================================================
   ADMIN DM
========================================================== */

async function askAdminDM(){

  const model =
    document.getElementById(
      "plainModel"
    ).value.trim();


  return callLLMWithHistoryFallback(
    (limit) => buildAdminDMMessages(limit),
    model,
    800
  );

}


/* ==========================================================
   LAST SPEAKER
========================================================== */

function lastSpeaker(){

  for(
    let i=roomMessages.length-1;
    i>=0;
    i--
  ){

    const m =
      roomMessages[i];

    if(
      m.name &&
      !m.system &&
      m.name !== getUsername()
    ){

      return m;

    }

  }

  return null;

}


/* ==========================================================
   AUTONOMOUS SPEECH DECISION
========================================================== */

function shouldAutonomousSpeak(){

  const activity =
    parseInt(
      document.getElementById(
        "activity"
      ).value,
      10
    );


  if(activity<=0)
    return false;


  return (
    Math.random()*100 <
    activity
  );

}


/* ==========================================================
   AUTONOMOUS TURN
========================================================== */

function autonomousTurn(){

  if(!autonomousEnabled){

    return;

  }


  if(!shouldAutonomousSpeak()){

    scheduleAutonomous();

    return;

  }


  const recent =
    lastSpeaker();


  const replyChance =
    parseInt(
      document.getElementById(
        "replyChance"
      ).value,
      10
    );


  const spontaneousChance =
    parseInt(
      document.getElementById(
        "spontaneousChance"
      ).value,
      10
    );


  let wantsReply = false;


  if(recent){

    wantsReply =
      Math.random()*100 <
      replyChance;

  }


  if(!wantsReply){

    const spontaneous =
      Math.random()*100 <
      spontaneousChance;


    if(!spontaneous){

      scheduleAutonomous();

      return;

    }

  }


  const maxBurst =
    parseInt(
      document.getElementById(
        "maxBurst"
      ).value,
      10
    );


  let burstCount = 1;


  if(
    Math.random()<0.25 &&
    maxBurst>1
  ){

    burstCount =
      random(
        1,
        maxBurst
      );

  }


  const selectedIds = [];

  const selected = [];


  while(
    selected.length < burstCount &&
    selectedIds.length < PEOPLE.length
  ){

    const p =
      weightedRandomPerson(
        selectedIds
      );


    if(!p)
      break;


    selected.push(p);

    selectedIds.push(
      p.id
    );

  }


  selected.forEach(
    person => {

      enqueueSpeak(
        async () => {

          if(!autonomousEnabled)
            return;

          await runRoomSpeakTask(
            person
          );

        }
      );

    }
  );


  scheduleAutonomous();

}


/* ==========================================================
   ROOM CHARACTER SPEAK
========================================================== */

async function runRoomSpeakTask(
  person,
  explicitMention=false,
  forceSpeak=false,
  replyToOverride=null
){

  await sleep(
    random(
      800,
      3200
    )
  );


  if(
    !PEOPLE.some(
      p=>p.id===person.id
    )
  ){

    return;

  }


  if(
    !explicitMention &&
    !forceSpeak &&
    Math.random()<0.05
  ){

    return;

  }


  const replyTo =
    replyToOverride ||
    lastSpeaker()?.name ||
    null;


  setPersonTyping(
    person.id,
    true
  );


  const typing =
    isViewActive("room")
      ? addBubble(
          person.name,
          "",
          {typing:true}
        )
      : null;


  try{

    setStatus(
      person.name +
      " is typing..."
    );


    const reply =
      await askPerson(
        person,
        replyTo,
        explicitMention
      );


    if(
      typing?.isConnected
    ){

      typing.remove();

    }


    setPersonTyping(
      person.id,
      false
    );


    if(!reply)
      return;


    if(
      !PEOPLE.some(
        p=>p.id===person.id
      )
    ){

      return;

    }


    markSpoke(
      person
    );


    const mentions =
      getMentionedPeople(
        reply
      );


    const newMsg = {

      name:
        person.name,

      text:
        reply,

      replyTo:
        replyTo

    };

    roomMessages.push(newMsg);


    markActivity();


    if(
      isViewActive("room")
    ){

      addBubble(
        person.name,
        reply,
        {
          replyTo,
          msgRef:newMsg
        }
      );

    }


    /*
       If the character mentioned somebody,
       queue that person next.
    */

    if(mentions.length){

      mentions
        .forEach(
          mentioned => {

            if(
              mentioned.id ===
              person.id
            ){

              return;

            }


            if(
              mentioned.id ===
              "admin"
            ){

              enqueueSpeak(
                () =>
                  runAdminRoomTask(
                    true
                  )
              );

              return;

            }


            enqueueSpeak(
              () =>
                runRoomSpeakTask(
                  mentioned,
                  true
                )
            );

          }
        );

    }


  }catch(err){

    if(
      typing?.isConnected
    ){

      typing.remove();

    }


    setPersonTyping(
      person.id,
      false
    );


    console.error(
      "Autonomous AI error:",
      err
    );


    setStatus(
      "AI error"
    );

  }


  setStatus(
    autonomousEnabled
      ? "AI room active"
      : "AI room paused"
  );

}


/* ==========================================================
   ADMIN ROOM TASK
========================================================== */

async function runAdminRoomTask(
  explicitMention=false
){

  await sleep(
    explicitMention
      ? random(500,1200)
      : random(800,2500)
  );


  setPersonTyping(
    "admin",
    true
  );


  const typing =
    isViewActive("room")
      ? addBubble(
          "Admin",
          "",
          {typing:true}
        )
      : null;


  try{

    setStatus(
      "Admin is typing..."
    );


    const reply =
      await askAdmin(
        explicitMention
      );


    if(
      typing?.isConnected
    ){

      typing.remove();

    }


    setPersonTyping(
      "admin",
      false
    );


    if(!reply)
      return;


    markSpoke(
      ADMIN
    );


    const replyTo =
      lastSpeaker()?.name ||
      null;


    const newMsg = {

      name:"Admin",

      text:reply,

      replyTo:replyTo

    };

    roomMessages.push(newMsg);


    markActivity();


    if(
      isViewActive("room")
    ){

      addBubble(
        "Admin",
        reply,
        {
          replyTo,
          msgRef:newMsg
        }
      );

    }


    const mentions =
      getMentionedPeople(
        reply
      );


    mentions.forEach(
      mentioned => {

        if(
          mentioned.id ===
          "admin"
        ){

          return;

        }


        enqueueSpeak(
          () =>
            runRoomSpeakTask(
              mentioned,
              true
            )
        );

      }
    );


  }catch(err){

    if(
      typing?.isConnected
    ){

      typing.remove();

    }


    setPersonTyping(
      "admin",
      false
    );


    console.error(
      "Admin error:",
      err
    );


    setStatus(
      "Admin error"
    );

  }


  setStatus(
    autonomousEnabled
      ? "AI room active"
      : "AI room paused"
  );

}


/* ==========================================================
   AUTONOMOUS TIMER
========================================================== */

function scheduleAutonomous(){

  clearTimeout(
    autonomousTimer
  );


  if(!autonomousEnabled)
    return;


  const activity =
    parseInt(
      document.getElementById(
        "activity"
      ).value,
      10
    );


  const minDelay =
    2500;


  const maxDelay =
    18000;


  const activityFactor =
    activity/100;


  const delay =
    Math.round(
      maxDelay -
      (
        (maxDelay-minDelay) *
        activityFactor
      )
    );


  const finalDelay =
    random(
      Math.max(
        1200,
        delay*.5
      ),
      Math.max(
        1800,
        delay*1.5
      )
    );


  autonomousTimer =
    setTimeout(
      autonomousTurn,
      finalDelay
    );

}


/* ==========================================================
   MENTION PRIORITY
========================================================== */

function queueMentionedPeople(
  mentions
){

  mentions.forEach(
    person => {

      if(
        person.id === "admin"
      ){

        enqueueSpeak(
          () =>
            runAdminRoomTask(
              true
            )
        );

      }else{

        enqueueSpeak(
          () =>
            runRoomSpeakTask(
              person,
              true
            )
        );

      }

    }
  );

}


/* ==========================================================
   MANUAL SEND
========================================================== */

function sendMessage(){

  const input =
    document.getElementById(
      "input"
    );


  const text =
    input.value.trim();


  const attachment =
    pendingAttachment;


  if(!text && !attachment)
    return;


  const model =
    document.getElementById(
      "model"
    ).value.trim();


  if(!model){

    alert(
      "Select a character model first."
    );

    return;

  }


  input.value = "";

  input.focus();


  pendingAttachment = null;

  renderAttachPreview();


  if(currentDM){

    if(currentDM==="admin"){

      sendAdminDMMessage(
        text,
        attachment
      );

    }else{

      sendDMMessage(
        text,
        attachment
      );

    }

    return;

  }


  sendRoomMessage(
    text,
    attachment
  );

}


/* ==========================================================
   ROOM MESSAGE
========================================================== */

function sendRoomMessage(
  text,
  attachment=null
){

  const username =
    getUsername();


  const newMsg = {

    name:username,

    text:text,

    attachment:attachment

  };

  roomMessages.push(newMsg);


  markActivity();


  if(
    isViewActive("room")
  ){

    addBubble(
      username,
      text,
      {attachment:attachment, msgRef:newMsg}
    );

  }


  /*
     FIRST CHECK @MENTIONS.

     Mentions always beat the normal
     random-response system.
  */

  const mentioned =
    getMentionedPeople(
      text
    );


  if(mentioned.length){

    mentioned.forEach(
      p => {

        enqueueSpeak(
          async () => {

            if(
              p.id==="admin"
            ){

              await runAdminRoomTask(
                true
              );

            }else{

              await runRoomSpeakTask(
                p,
                true,
                false,
                username
              );

            }

          }
        );

      }
    );


    scheduleAutonomous();

    return;

  }


  /*
     NORMAL MANUAL REPLY BEHAVIOR

     Always treat replies as "everyone",
     up to 10 people.
  */

  const responders = pickResponders(text);


  responders.forEach(
    person => {

      enqueueSpeak(
        () =>
          runRoomSpeakTask(
            person,
            false,
            false,
            username
          )
      );

    }
  );


  scheduleAutonomous();

}


/* ==========================================================
   SHUFFLE
========================================================== */

function shuffle(arr){

  for(
    let i=arr.length-1;
    i>0;
    i--
  ){

    const j =
      Math.floor(
        Math.random() *
        (i+1)
      );


    [
      arr[i],
      arr[j]
    ] =
    [
      arr[j],
      arr[i]
    ];

  }

  return arr;

}


/* ==========================================================
   CHARACTER DM
========================================================== */

function sendDMMessage(
  text,
  attachment=null
){

  const id =
    currentDM;


  const person =
    getPermanentCharacter(id) ||
    EVERYONE.find(p=>p.id===id);


  if(!person)
    return;


  const username =
    getUsername();


  if(!dmThreads[id])
    dmThreads[id] = [];


  const newMsg = {

    name:username,

    text:text,

    attachment:attachment

  };

  dmThreads[id].push(newMsg);
  persistState();


  if(
    isViewActive(id)
  ){

    addBubble(
      username,
      text,
      {attachment:attachment, msgRef:newMsg}
    );

  }


  enqueueDMSpeak(
    () =>
      runDMSpeakTask(
        id
      )
  );

}


/* ==========================================================
   ADMIN DM MESSAGE
========================================================== */

function sendAdminDMMessage(
  text,
  attachment=null
){

  const username =
    getUsername();


  if(!dmThreads.admin)
    dmThreads.admin=[];


  const newMsg = {

    name:username,

    text:text,

    attachment:attachment

  };

  dmThreads.admin.push(newMsg);


  if(
    isViewActive("admin")
  ){

    addBubble(
      username,
      text,
      {attachment:attachment, msgRef:newMsg}
    );

  }


  enqueueDMSpeak(
    () =>
      runAdminDMSpeakTask()
  );

}


/* ==========================================================
   CHARACTER DM TASK
========================================================== */

async function runDMSpeakTask(
  id
){

  // A DM belongs to the permanent network identity, not the room.
  // Capture that identity before doing any async work so a room move
  // cannot invalidate the private conversation.
  const person =
    getPermanentCharacter(id) ||
    EVERYONE.find(p=>p.id===id);

  if(!person)
    return;

  await sleep(
    random(
      500,
      1600
    )
  );

  setPersonTyping(
    id,
    true
  );

  const typing =
    isViewActive(id)
      ? addBubble(
          person.name,
          "",
          {typing:true}
        )
      : null;

  try{

    setStatus(
      person.name +
      " is typing..."
    );

    const reply =
      await askPersonDM(
        person
      );

    if(
      typing?.isConnected
    ){

      typing.remove();

    }

    setPersonTyping(
      id,
      false
    );

    if(!reply)
      return;

    // Never require the person to still be in the current room.
    // They can walk away while their DM reply is being generated.
    if(!dmThreads[id])
      dmThreads[id] = [];

    const newMsg = {

      name:
        person.name,

      text:
        reply

    };

    dmThreads[id].push(newMsg);

    if(
      isViewActive(id)
    ){

      addBubble(
        person.name,
        reply,
        {msgRef:newMsg}
      );

    }else{

      dmUnread.add(
        id
      );

      refreshTypingClasses();

    }

    persistState();

  }catch(err){

    if(
      typing?.isConnected
    ){

      typing.remove();

    }

    setPersonTyping(
      id,
      false
    );

    console.error(
      "DM AI error:",
      err
    );

    if(!dmThreads[id])
      dmThreads[id] = [];

    const errMsg = {

      name:
        person.name,

      text:
        "⚠ Couldn't get a reply (" +
        (err?.message || "unknown error") +
        "). Check the API address/model in settings, then try sending again.",

      system:true

    };

    dmThreads[id].push(errMsg);

    if(
      isViewActive(id)
    ){

      addBubble(
        person.name,
        errMsg.text,
        {system:true, msgRef:errMsg}
      );

    }else{

      dmUnread.add(id);
      refreshTypingClasses();

    }

    persistState();

    setStatus(
      "AI error — see DM"
    );

  }

  setStatus(
    autonomousEnabled
      ? "AI room active"
      : "Ready"
  );

}

/* ==========================================================
   ADMIN DM TASK
========================================================== */

async function runAdminDMSpeakTask(){

  await sleep(
    random(
      400,
      1200
    )
  );


  setPersonTyping(
    "admin",
    true
  );


  const typing =
    isViewActive("admin")
      ? addBubble(
          "Admin",
          "",
          {typing:true}
        )
      : null;


  try{

    setStatus(
      "Admin is typing..."
    );


    const reply =
      await askAdminDM();


    if(
      typing?.isConnected
    ){

      typing.remove();

    }


    setPersonTyping(
      "admin",
      false
    );


    if(!reply)
      return;


    const newMsg = {

      name:"Admin",

      text:reply

    };

    dmThreads.admin.push(newMsg);


    if(
      isViewActive("admin")
    ){

      addBubble(
        "Admin",
        reply,
        {msgRef:newMsg}
      );

    }else{

      dmUnread.add(
        "admin"
      );

      refreshTypingClasses();

    }


  }catch(err){

    if(
      typing?.isConnected
    ){

      typing.remove();

    }


    setPersonTyping(
      "admin",
      false
    );


    console.error(
      "Admin DM error:",
      err
    );


    if(!dmThreads.admin)
      dmThreads.admin = [];

    const errMsg = {

      name:"Admin",

      text:
        "⚠ Couldn't get a reply (" +
        (err?.message || "unknown error") +
        "). Check the API address/model in settings, then try sending again.",

      system:true

    };

    dmThreads.admin.push(errMsg);

    if(
      isViewActive("admin")
    ){

      addBubble(
        "Admin",
        errMsg.text,
        {system:true, msgRef:errMsg}
      );

    }else{

      dmUnread.add("admin");

      refreshTypingClasses();

    }


    setStatus(
      "AI error — see DM"
    );


    return;

  }


  setStatus(
    autonomousEnabled
      ? "AI room active"
      : "Ready"
  );

}


/* ==========================================================
   RENDER LOG
========================================================== */

function renderLog(){

  const log =
    document.getElementById(
      "log"
    );


  log.innerHTML = "";

  lastRenderedName =
    null;


  let source;


  if(currentDM){

    source =
      dmThreads[currentDM] ||
      [];

  }else{

    source =
      roomMessages;

  }


  source.forEach(
    m => {

      addBubble(
        m.name,
        m.text,
        {
          replyTo:m.replyTo,
          attachment:m.attachment,
          system:m.system,
          msgRef:m
        }
      );

    }
  );

}


/* ==========================================================
   OPEN CHARACTER DM
========================================================== */

function openDM(id){

  const person =
    getPermanentCharacter(id) ||
    EVERYONE.find(p=>p.id===id);


  if(!person)
    return;


  currentDM =
    id;


  dmUnread.delete(
    id
  );


  document.body.classList.add(
    "dm-mode"
  );


  document.getElementById(
    "roomTitle"
  ).textContent =
    person.name;


  document.getElementById(
    "roomMeta"
  ).textContent =
    "• " +
    person.role +
    " • private DM";


  document.getElementById(
    "input"
  ).placeholder =
    "Message " +
    person.name +
    " privately...";


  renderLog();

  refreshTypingClasses();


  document.getElementById(
    "input"
  ).focus();


  if(
    window.innerWidth<=760 &&
    peopleVisible
  ){

    togglePeople();

  }

}


/* ==========================================================
   OPEN ADMIN DM
========================================================== */

function openAdminDM(){

  currentDM =
    "admin";


  if(!dmThreads.admin)
    dmThreads.admin=[];


  dmUnread.delete(
    "admin"
  );


  document.body.classList.add(
    "dm-mode"
  );


  document.getElementById(
    "roomTitle"
  ).textContent =
    "Admin";


  document.getElementById(
    "roomMeta"
  ).textContent =
    "• Plain Admin 3.1 • private DM";


  document.getElementById(
    "input"
  ).placeholder =
    "Message Admin privately...";


  renderLog();

  refreshTypingClasses();


  document.getElementById(
    "input"
  ).focus();


  if(
    window.innerWidth<=760 &&
    peopleVisible
  ){

    togglePeople();

  }

}


/* ==========================================================
   BACK TO ROOM
========================================================== */

function backToRoom(){

  currentDM =
    null;


  document.body.classList.remove(
    "dm-mode"
  );


  document.getElementById(
    "roomTitle"
  ).textContent =
    document.getElementById(
      "roomName"
    ).value ||
    "The Lobby";


  document.getElementById(
    "roomMeta"
  ).textContent =
    onlineCountText();


  document.getElementById(
    "input"
  ).placeholder =
    "Type a message to the room... Try @Sarah or @Admin";


  renderLog();

  refreshTypingClasses();


  document.getElementById(
    "input"
  ).focus();

}


/* ==========================================================
   CLEAR DM
========================================================== */

function clearDM(){

  if(!currentDM)
    return;


  dmThreads[currentDM]=[];

  renderLog();

}


/* ==========================================================
   STARTER CHAT
========================================================== */

function seedConversation(){

  const starters = [

    "So what is everybody doing today?",

    "Anybody remember the first computer or console they really loved?",

    "What game have you been playing lately?",

    "Okay, random question: what is the weirdest thing you've ever seen on the internet?",

    "If this room had a jukebox, what song are you putting on first?",

    "What was the dumbest thing you believed when you were a kid?",

    "Anybody here still owns a CRT?",

    "What's everybody's unpopular gaming opinion?",

    "@Admin what's the first thing that comes to mind when you hear old-school internet?"

  ];


  document.getElementById(
    "input"
  ).value =
    starters[
      Math.floor(
        Math.random() *
        starters.length
      )
    ];


  sendMessage();

}


/* ==========================================================
   MODEL SELECTORS
========================================================== */

/* ==========================================================
   LOAD MODELS
========================================================== */

/* Accepts sloppy input: "192.168.1.5:1234", "localhost:1234/", "http://host:1234" -> "http://host:1234/v1" */
function normalizeApiBase(raw){
  let u=String(raw||"").trim().replace(/\s+/g,"");
  if(!u) return "";
  if(!/^https?:\/\//i.test(u)) u="http://"+u;
  u=u.replace(/\/+$/,"");
  try{ const x=new URL(u); if(x.pathname===""||x.pathname==="/") u=x.origin+"/v1"; }catch(e){}
  return u;
}
async function fetchJsonTimeout(url,headers,ms){
  const ctl=new AbortController(), t=setTimeout(()=>ctl.abort(),ms||8000);
  try{
    const res=await fetch(url,{headers,signal:ctl.signal});
    if(!res.ok) throw new Error("HTTP "+res.status);
    return await res.json();
  }finally{clearTimeout(t);}
}
/* The API base URL field is the single source of truth for /models AND /chat/completions.
   Blank = local LM Studio. Bare "host:port" gets http:// and /v1 added. */
function getApiBase(){
  const f=document.getElementById("apiBase");
  const n=normalizeApiBase(f?f.value:"")||"http://localhost:1234/v1";
  if(f&&f.value.trim()!==n&&document.activeElement!==f) f.value=n;
  return n;
}
/* default = Qwen if the server has it, otherwise the first model */
function pickDefaultModel(ids){
  return ids.find(i=>/^qwen\/qwen3-vl-8b$/i.test(i))||ids.find(i=>/qwen.*3.*vl.*8b/i.test(i))||ids.find(i=>/qwen/i.test(i))||ids[0];
}
/* No model picked in the browser: use the one the server has loaded, like the browser does. */
function pickBrowserDefault(ids,info){
  const want=(window.LobbyConnection&&window.LobbyConnection.current().model)||"";
  if(want&&ids.includes(want)) return want;
  const loaded=ids.find(i=>info.get(i)&&info.get(i).loaded===true);
  return loaded||pickDefaultModel(ids);
}
let _modelLoadSeq=0;
async function loadModels(){
  const seq=++_modelLoadSeq;
  const base=getApiBase();
  const key=document.getElementById("apiKey").value.trim();
  const headers={Accept:"application/json"};
  if(key) headers.Authorization="Bearer "+key;
  persistState();
  setStatus("Loading models from "+base+" ...");
  try{
    if(location.protocol==="https:"&&/^http:\/\//i.test(base)&&!/^http:\/\/(localhost|127\.)/i.test(base))
      throw new Error("this page is https but the API is http, so the browser blocks it");
    const origin=new URL(base).origin;
    const cloud=/openai\.com|openrouter\.ai|anthropic\.com|groq\.com|together\.(ai|xyz)|mistral\.ai/i.test(base);
    /* The standard /models list, PLUS the fuller "all downloaded models" lists that LM Studio
       (/api/v0/models, /api/v1/models) and Ollama (/api/tags) expose. Merged and deduped. */
    const urls=[base+"/models"];
    if(!cloud) urls.push(origin+"/api/v0/models",origin+"/api/v1/models",origin+"/api/tags");
    const results=await Promise.allSettled(urls.map(u=>fetchJsonTimeout(u,headers,8000)));
    if(seq!==_modelLoadSeq) return;
    if(results.every(r=>r.status==="rejected")){
      const m=String(results[0].reason&&results[0].reason.message||results[0].reason);
      throw new Error(/abort/i.test(m)?"timed out":m);
    }
    const info=new Map();
    results.forEach(r=>{
      if(r.status!=="fulfilled") return;
      const d=r.value, arr=Array.isArray(d?.data)?d.data:(Array.isArray(d?.models)?d.models:(Array.isArray(d)?d:[]));
      arr.forEach(m=>{
        const id=typeof m==="string"?m:(m.id||m.key||m.model||m.name);
        if(!id) return;
        if((m&&m.type==="embeddings")||/embed/i.test(id)) return;
        const loaded=(m&&typeof m==="object"&&m.state)?(m.state==="loaded"):null;
        const prev=info.get(id);
        info.set(id,{loaded:(loaded!==null?loaded:(prev?prev.loaded:null))});
      });
    });
    const ids=[...info.keys()].sort((x,y)=>x.localeCompare(y,undefined,{sensitivity:"base"}));
    if(!ids.length) throw new Error("no models returned");
    const label=id=>id+(info.get(id)&&info.get(id).loaded===false?"  (not loaded)":"");
    const notes=[], typed=getTypedModels();
    ["model","plainModel"].forEach(sid=>{
      const sel=document.getElementById(sid), want=(sel.value&&sel.value!=="__custom__")?sel.value:"";
      const extra=typed.filter(t=>!ids.includes(t));
      sel.innerHTML=ids.map(id=>`<option value="${id.replace(/"/g,"&quot;")}">${label(id)}</option>`).join("")
        +extra.map(id=>`<option value="${id.replace(/"/g,"&quot;")}">${id} (typed)</option>`).join("")
        +`<option value="__custom__">✏️ Type a model ID…</option>`;
      if(want&&(ids.includes(want)||typed.includes(want))) sel.value=want;
      else if(sid==="plainModel"&&ids.includes(document.getElementById("model").value)) sel.value=document.getElementById("model").value;
      else { sel.value=pickBrowserDefault(ids,info); if(want) notes.push(want); }
      sel.dataset.prev=sel.value;
    });
    setStatus(ids.length+" model(s) found on "+new URL(base).host+(notes.length?" — \""+notes[0]+"\" isn't on this server, so "+document.getElementById("model").value+" is being used. Change the model in the browser's Settings.":""));
    persistState();
  }catch(e){
    if(seq!==_modelLoadSeq) return;
    console.error(e);
    setStatus("Couldn't reach "+base+" ("+e.message+"). Check: server running, LM Studio 'Serve on Local Network' + CORS on, firewall/port open.");
  }
}
/* re-fetch the model list whenever the address or key changes (and after the startup box) */
let _mlTimer=null;
function scheduleModelLoad(ms){clearTimeout(_mlTimer);_mlTimer=setTimeout(loadModels,ms);}
function initApiAutoRefresh(){
  const a=document.getElementById("apiBase"), k=document.getElementById("apiKey");
  if(!a||a.dataset.auto) return; a.dataset.auto="1";
  a.addEventListener("input",()=>scheduleModelLoad(1000));
  a.addEventListener("change",()=>{const n=normalizeApiBase(a.value);if(n&&n!==a.value.trim()){a.value=n;persistState();}scheduleModelLoad(0);});
  k.addEventListener("change",()=>scheduleModelLoad(0));
}
function getTypedModels(){try{return JSON.parse(localStorage.getItem("typedModelIds")||"[]");}catch(e){return [];}}
function initModelPickers(){
  ["model","plainModel"].forEach(sid=>{
    const sel=document.getElementById(sid); if(!sel||sel.dataset.custom) return; sel.dataset.custom="1";
    if(![...sel.options].some(o=>o.value==="__custom__")){const o=document.createElement("option");o.value="__custom__";o.textContent="✏️ Type a model ID…";sel.appendChild(o);}
    sel.dataset.prev=sel.value;
    sel.addEventListener("change",()=>{
      if(sel.value!=="__custom__"){sel.dataset.prev=sel.value;return;}
      const id=(window.prompt("Exact model ID to use (as your server names it):")||"").trim();
      if(id){
        if(![...sel.options].some(o=>o.value===id)){const o=document.createElement("option");o.value=id;o.textContent=id;sel.insertBefore(o,sel.querySelector('option[value="__custom__"]'));}
        sel.value=id;
        const t=getTypedModels(); if(!t.includes(id)){t.push(id);try{localStorage.setItem("typedModelIds",JSON.stringify(t.slice(-20)));}catch(e){}}
      }else sel.value=sel.dataset.prev||"";
      sel.dataset.prev=sel.value; persistState();
    });
  });
}

/* ==========================================================
   CLEAR CHAT
========================================================== */

function clearChat(){

  roomMessages=[];

  lastRenderedName =
    null;


  document.getElementById(
    "log"
  ).innerHTML =
    "";


  setStatus(
    autonomousEnabled
      ? "AI room active"
      : "Ready"
  );


  scheduleAutonomous();

}


/* ==========================================================
   SETTINGS
========================================================== */

function toggleSettings(){

  const main = document.querySelector(".main");
  const settings = document.getElementById("settings");
  const button = document.querySelector(".settings-toggle");

  if(!main || !settings) return;

  const hidden = main.classList.toggle("settings-hidden");

  // On narrower screens the settings panel is an overlay, so keep its
  // existing open/closed behavior in sync with the same button.
  settings.classList.toggle("open", !hidden);

  if(button){
    button.textContent = hidden ? "⚙ Settings" : "✕ Settings";
    button.setAttribute("aria-expanded", hidden ? "false" : "true");
  }

}


/* ==========================================================
   ACTIVITY LABELS
========================================================== */

function updateActivityLabels(){

  const activity =
    document.getElementById(
      "activity"
    ).value;


  const reply =
    document.getElementById(
      "replyChance"
    ).value;


  const spontaneous =
    document.getElementById(
      "spontaneousChance"
    ).value;


  document.getElementById(
    "activityValue"
  ).textContent =
    activity + "%";


  document.getElementById(
    "replyChanceValue"
  ).textContent =
    reply + "%";


  document.getElementById(
    "spontaneousChanceValue"
  ).textContent =
    spontaneous + "%";


  refreshTypingClasses();

  scheduleAutonomous();

}


/* ==========================================================
   PAUSE / RESUME
========================================================== */

function toggleAutonomous(){

  autonomousEnabled =
    !autonomousEnabled;


  const button =
    document.getElementById(
      "autoButton"
    );


  if(autonomousEnabled){

    button.textContent =
      "⏸ Pause AI chatter";

    button.classList.add(
      "on"
    );


    setStatus(
      "AI room active"
    );


    scheduleAutonomous();

  }else{

    button.textContent =
      "▶ Resume AI chatter";

    button.classList.remove(
      "on"
    );


    clearTimeout(
      autonomousTimer
    );


    setStatus(
      "AI room paused"
    );

  }

}


/* ==========================================================
   PEOPLE MOBILE
========================================================== */

function togglePeople(){

  const el =
    document.getElementById(
      "people"
    );


  peopleVisible =
    !peopleVisible;


  el.style.display =
    peopleVisible
      ? "block"
      : "none";

}


/* ==========================================================
   CHARACTER EDITOR
========================================================== */

function openCharacterEditor(id){

  const person =
    PEOPLE.find(
      p=>p.id===id
    );


  if(!person)
    return;


  editorMode =
    "edit";


  editorPersonId =
    id;


  document.getElementById(
    "editorTitle"
  ).textContent =
    "Edit Character: " +
    person.name;


  const avatarEl =
    document.getElementById(
      "editorAvatar"
    );


  avatarEl.textContent =
    person.avatar;


  avatarEl.style.background =
    person.color;


  document.getElementById(
    "editName"
  ).value =
    person.name;


  document.getElementById(
    "editRole"
  ).value =
    person.role;


  document.getElementById(
    "editPrompt"
  ).value =
    person.prompt;


  document.getElementById(
    "saveCharacterBtn"
  ).textContent =
    "Save Character";


  document.getElementById(
    "person-"+id
  )?.classList.add(
    "editing"
  );


  document.getElementById(
    "characterEditor"
  ).classList.add(
    "open"
  );

}


/* ==========================================================
   OPEN EDITOR — NEW CHARACTER
========================================================== */

function openNewCharacterEditor(){

  editorMode =
    "add";

  editorPersonId =
    null;


  document.getElementById(
    "editorTitle"
  ).textContent =
    "Add New Character";


  const avatarEl =
    document.getElementById(
      "editorAvatar"
    );


  avatarEl.textContent =
    "+";


  avatarEl.style.background =
    nextCharacterColor();


  document.getElementById(
    "editName"
  ).value =
    "";


  document.getElementById(
    "editRole"
  ).value =
    "";


  document.getElementById(
    "editPrompt"
  ).value =
    "";


  document.getElementById(
    "saveCharacterBtn"
  ).textContent =
    "Add Character";


  document.getElementById(
    "characterEditor"
  ).classList.add(
    "open"
  );


  document.getElementById(
    "editName"
  ).focus();

}


/* ==========================================================
   CLOSE EDITOR
========================================================== */

function closeCharacterEditor(){

  if(editorPersonId){

    document.getElementById(
      "person-"+editorPersonId
    )?.classList.remove(
      "editing"
    );

  }


  editorPersonId =
    null;


  document.getElementById(
    "characterEditor"
  ).classList.remove(
    "open"
  );

}


/* ==========================================================
   SAVE CHARACTER
========================================================== */

function saveCharacter(){

  const newName =
    document.getElementById(
      "editName"
    ).value.trim();


  const newRole =
    document.getElementById(
      "editRole"
    ).value.trim();


  const newPrompt =
    document.getElementById(
      "editPrompt"
    ).value.trim();


  if(!newName){

    alert(
      "The character needs a name."
    );

    return;

  }


  /*
     ADD MODE — create a brand
     new character and push it
     into the room.
  */

  if(editorMode === "add"){

    const id =
      slugifyName(newName);

    const person = {

      id:id,

      name:newName,

      avatar:
        newName
          .charAt(0)
          .toUpperCase(),

      role:
        newRole ||
        "Chat room regular",

      color:
        nextCharacterColor(),

      prompt:
        newPrompt ||
        ("You are " +
        newName +
        ", a believable, natural participant in an old-school internet chat room. Talk like a real person, keep replies fairly short, and don't constantly announce your personality.")

    };


    PEOPLE.push(
      person
    );


    lastSpoke[id] =
      0;


    if(!dmThreads[id])
      dmThreads[id] = [];


    peopleList();

    closeCharacterEditor();


    setStatus(
      person.name +
      " added to the room"
    );


    announceRoomEvent(
      person.name + " joined the chat."
    );


    scheduleAutonomous();

    persistState();

    return;

  }


  /*
     EDIT MODE — update an
     existing character.
  */

  if(!editorPersonId)
    return;


  const person =
    PEOPLE.find(
      p=>p.id===editorPersonId
    );


  if(!person)
    return;


  person.name =
    newName;


  person.role =
    newRole ||
    "Chat room regular";


  person.prompt =
    newPrompt;


  person.avatar =
    newName
      .charAt(0)
      .toUpperCase();


  peopleList();

  closeCharacterEditor();


  setStatus(
    person.name +
    " updated"
  );


  scheduleAutonomous();

  persistState();

}


/* ==========================================================
   REMOVE CHARACTER
========================================================== */

function removeCharacter(id){

  const person =
    PEOPLE.find(
      p=>p.id===id
    );


  if(!person)
    return;

  const index =
    PEOPLE.findIndex(
      p=>p.id===id
    );


  if(index>-1)
    PEOPLE.splice(
      index,
      1
    );


  /* Archive them (personality, edits, and all) instead of
     deleting them outright, so they can be brought back later
     from the presets menu — this works for characters you
     created yourself, not just the original ten. */

  if(!ARCHIVED_CHARACTERS.some(a=>a.id===id)){

    ARCHIVED_CHARACTERS.push(
      {...person}
    );

  }


  /* dmThreads[id] is deliberately left alone here (not deleted)
     so that if this character is restored later, their DM
     picks back up instead of starting over. */

  delete lastSpoke[id];

  typingIds.delete(id);

  dmUnread.delete(id);


  if(currentDM===id)
    backToRoom();


  peopleList();


  setStatus(
    person.name +
    " removed"
  );


  announceRoomEvent(
    person.name + " left the chat."
  );


  scheduleAutonomous();

  persistState();

}


/* ==========================================================
   ROOM NAME
========================================================== */

document.getElementById(
  "roomName"
).addEventListener(
  "input",
  e => {

    document.getElementById(
      "roomTitle"
    ).textContent =
      e.target.value ||
      "The Lobby";

    const lobbyRowName =
      document.getElementById(
        "lobbyRowName"
      );

    if(lobbyRowName){
      lobbyRowName.textContent =
        e.target.value ||
        "The Lobby";
    }

  }
);


/* ==========================================================
   USERNAME
========================================================== */

document.getElementById(
  "username"
).addEventListener(
  "input",
  e => {

    const label =
      document.getElementById(
        "youNameLabel"
      );


    if(label){

      const value =
        e.target.value.trim() ||
        "Guest";


      label.innerHTML =
        `${esc(value)}
        <span
          style="
            color:var(--muted-dim);
            font-weight:400
          "
        >
          (you)
        </span>`;

    }

  }
);


document.getElementById(
  "username"
).addEventListener(
  "change",
  e => {

    if(
      !e.target.value.trim()
    ){

      e.target.value =
        "Guest";

    }

  }
);


/* ==========================================================
   ENTER TO SEND
========================================================== */

document.getElementById(
  "input"
).addEventListener(
  "keydown",
  e => {

    if(
      e.key==="Enter" &&
      !e.shiftKey
    ){

      e.preventDefault();

      sendMessage();

    }

  }
);


/* ==========================================================
   HIDE "NEW MESSAGES" WHEN THE READER SCROLLS BACK DOWN
   THEMSELVES
========================================================== */

document.getElementById(
  "log"
).addEventListener(
  "scroll",
  () => {

    if(isLogNearBottom())
      hideNewMessagesIndicator();

  }
);


/* ==========================================================
   CLOSE EDITOR OUTSIDE
========================================================== */

document.getElementById(
  "characterEditor"
).addEventListener(
  "click",
  e => {

    if(
      e.target.id ===
      "characterEditor"
    ){

      closeCharacterEditor();

    }

  }
);


/* ==========================================================
   APPLY SAVED STATE TO THE UI

   Fill in the name, room, connection, prompt, and activity
   fields from whatever was saved last, and add manual model
   options in case the /models fetch below fails or the server
   doesn't expose that name.
========================================================== */

document.getElementById("username").value =
  SAVED_STATE?.username || "Guest";

document.getElementById("roomName").value =
  SAVED_STATE?.roomName || "The Lobby";

document.getElementById("roomTitle").textContent =
  SAVED_STATE?.roomName || "The Lobby";

document.getElementById("apiBase").value =
  SAVED_STATE?.apiBase || "http://localhost:1234/v1";

document.getElementById("apiKey").value =
  SAVED_STATE?.apiKey || "";

document.getElementById("globalPrompt").value =
  SAVED_STATE?.globalPrompt || DEFAULT_GLOBAL;

document.getElementById("worldPrompt").value =
  SAVED_STATE?.worldPrompt || "";

if(SAVED_STATE?.activity !== undefined)
  document.getElementById("activity").value = SAVED_STATE.activity;

if(SAVED_STATE?.replyChance !== undefined)
  document.getElementById("replyChance").value = SAVED_STATE.replyChance;

if(SAVED_STATE?.spontaneousChance !== undefined)
  document.getElementById("spontaneousChance").value = SAVED_STATE.spontaneousChance;

if(SAVED_STATE?.maxBurst)
  document.getElementById("maxBurst").value = SAVED_STATE.maxBurst;

document.getElementById("includeAdminToggle").checked =
  INCLUDE_ADMIN;

/* Save on every change to the free-text/connection fields and
   the name inputs (the sliders and character editor already
   call persistState() themselves). */

["username","roomName","apiKey","apiBase"].forEach(id=>{
  document.getElementById(id)
    .addEventListener("input", persistState);
});


/* ==========================================================
   STARTUP CONNECTION MODAL

   Remembers past API base URLs (a small local history list)
   and asks for the address/key/provider every time the page
   loads, prefilled with whatever was used last, so reconnecting
   is one click instead of retyping.
========================================================== */

const API_HISTORY_KEY = "lobbyApiHistory";

const PROVIDER_DEFAULTS = {
  lmstudio:   "http://localhost:1234/v1",
  ollama:     "http://localhost:11434/v1",
  openai:     "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  other:      ""
};

function getApiHistory(){

  try{
    const raw = localStorage.getItem(API_HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  }catch(e){
    return [];
  }

}

function saveApiHistoryEntry(url){

  if(!url) return;

  let list = getApiHistory().filter(u => u !== url);

  list.unshift(url);

  list = list.slice(0, 8);

  try{
    localStorage.setItem(API_HISTORY_KEY, JSON.stringify(list));
  }catch(e){
    console.warn("Couldn't save API history:", e);
  }

}

function populateApiHistoryDatalist(){

  const dl = document.getElementById("apiHistoryList");

  if(!dl) return;

  dl.innerHTML =
    getApiHistory()
      .map(u => `<option value="${u.replace(/"/g,"&quot;")}">`)
      .join("");

}

function guessProviderFromUrl(url){

  if(!url) return "lmstudio";

  if(url.includes("openrouter.ai")) return "openrouter";
  if(url.includes("api.openai.com")) return "openai";
  if(url.includes(":11434")) return "ollama";
  if(url.includes(":1234")) return "lmstudio";

  return "other";

}

function onStartupProviderChange(){

  const provider =
    document.getElementById("startupProvider").value;

  const urlField =
    document.getElementById("startupApiBase");

  if(!urlField.value.trim()){
    urlField.placeholder =
      PROVIDER_DEFAULTS[provider] || "https://...";
  }

}

function openStartupModal(){

  const lastUrl = SAVED_STATE?.apiBase || "";
  const lastKey = SAVED_STATE?.apiKey || "";

  populateApiHistoryDatalist();

  document.getElementById("startupApiBase").value = lastUrl;
  document.getElementById("startupApiKey").value = lastKey;

  document.getElementById("startupProvider").value =
    guessProviderFromUrl(lastUrl);

  onStartupProviderChange();

  document.getElementById("startupModal").classList.add("open");

  document.getElementById("startupApiBase").focus();

}

function closeStartupModal(){

  document.getElementById("startupModal").classList.remove("open");

}

function confirmStartupModal(){
  const url = normalizeApiBase(document.getElementById("startupApiBase").value);
  const key = document.getElementById("startupApiKey").value.trim();
  document.getElementById("apiBase").value = url;
  document.getElementById("apiKey").value = key;
  if(url) saveApiHistoryEntry(url);
  persistState();
  closeStartupModal();
  setStatus(url ? "Connecting to " + url + " ..." : "No API address set \u2014 add one any time in Settings.");
  if(url) loadModels();
}

function skipStartupModal(){

  closeStartupModal();

}

/* The connection (server, key, model) comes from the IcyWhite browser settings; see js/browser-connection.js */


function addManualModelOption(selectId, modelId){

  if(!modelId) return;

  const select =
    document.getElementById(selectId);

  if(!select) return;

  const exists =
    [...select.options].some(
      o => o.value === modelId
    );

  if(!exists){

    const opt =
      document.createElement("option");

    opt.value = modelId;

  


  opt.textContent = modelId;

    select.appendChild(opt);

  }

  select.value = modelId;

}

/* ==========================================================
   90s CHAT NETWORK
   Rooms with their own crowds, random screen names, and
   people who wander between rooms while you chat.
========================================================== */
const CHAT_ROOMS = [
  {id:"lobby",name:"The Lobby",tag:"Main hangout",prompt:"The main town-square room. People wander in to say hello, catch up, complain about work, tell stories, and see who is around."},
  {id:"nineties",name:"90s Hangout",tag:"Dial-up nostalgia",prompt:"A nostalgic 1990s internet hangout: dial-up, CRTs, mixtapes, malls, VHS, pagers, early web sites and whatever people remember from the decade."},
  {id:"music",name:"Music Room",tag:"Songs & bands",prompt:"People talk about songs, bands, concerts, albums, music memories and what is playing in the background. Arguments about taste happen naturally."},
  {id:"gaming",name:"Game Room",tag:"Games",prompt:"A lively gaming room covering consoles, PC games, arcades, RPGs, racing games, fighting games and multiplayer stories."},
  {id:"tech",name:"Tech Talk",tag:"Computers",prompt:"A computer and technology room. People discuss hardware, software, the internet, phones, gadgets, troubleshooting and new discoveries."},
  {id:"movies",name:"Movie House",tag:"Movies",prompt:"A movie discussion room where people debate films, actors, scenes, rentals, theaters and what they watched recently."},
  {id:"tv",name:"TV Lounge",tag:"Television",prompt:"A casual TV room. People drift between sitcoms, dramas, cartoons, news, old shows and whatever they are watching tonight."},
  {id:"sports",name:"Sports Bar",tag:"Sports",prompt:"A virtual sports bar. People talk about games, teams, players, scores, rivalries and what happened during the day."},
  {id:"cars",name:"Garage",tag:"Cars & racing",prompt:"A garage-style room for cars, trucks, motorcycles, repairs, road trips, racing and mechanical stories."},
  {id:"programming",name:"Code Cave",tag:"Programming",prompt:"A programmer hangout. People trade coding ideas, bugs, projects, web development stories and computer tricks without turning every message into a tutorial."},
  {id:"scifi",name:"Sci-Fi",tag:"Science fiction",prompt:"Science-fiction fans talk about space, future technology, books, movies, games, aliens and speculative ideas."},
  {id:"horror",name:"Horror",tag:"Spooky stuff",prompt:"A late-night horror room for ghost stories, scary movies, unexplained experiences, monsters and creepy internet stories."},
  {id:"anime",name:"Anime Club",tag:"Anime & manga",prompt:"An anime and manga hangout where people discuss shows, characters, art styles, openings, conventions and recommendations."},
  {id:"retro",name:"Retro Arcade",tag:"Old games",prompt:"A virtual arcade focused on classic consoles, arcade cabinets, old computer games, cheats, cartridges and childhood gaming memories."},
  {id:"offtopic",name:"Off Topic",tag:"Anything goes",prompt:"The classic everything-goes room. Everyday life, weird questions, jokes, arguments, stories and whatever someone happens to bring up."},
  {id:"late",name:"Late Night",tag:"After midnight",prompt:"A quieter after-hours room. People talk about life, strange thoughts, insomnia, relationships, work and whatever comes to mind when it is late."},
  {id:"books",name:"Book Nook",tag:"Books & stories",prompt:"A relaxed book room for novels, comics, authors, writing, stories, recommendations and arguments about endings."},
  {id:"science",name:"Science Lab",tag:"Science",prompt:"A curious science room. People discuss space, nature, physics, biology, experiments and interesting facts, while still sounding like ordinary chatters."},
  {id:"creative",name:"Creative Corner",tag:"Art & making",prompt:"Artists, writers, musicians and makers share ideas, projects, inspiration and occasional creative disasters."},
  {id:"friends",name:"Friends & Life",tag:"Everyday life",prompt:"A social room centered on friendships, family stories, work, dating, hobbies, plans and everyday life."},
  {id:"usnews",name:"US News",tag:"Live US headlines",prompt:"A room for talking about real, current United States news. People react to actual headlines from NPR and BBC, share the article links, disagree politely, and stay grounded in what the articles actually say."},
  {id:"worldnews",name:"World News",tag:"Live world headlines",prompt:"A room for real, current world news from BBC, Al Jazeera and The Guardian. People share article links, discuss what is happening around the world and stay grounded in what the reports actually say."},
  {id:"history",name:"History Hall",tag:"Today in history",prompt:"A history room. People talk about real historical events, especially what happened on this day in history, and link Wikipedia pages for the people and events they mention."},
  {id:"kitchen",name:"Recipe Exchange",tag:"Real recipes",prompt:"A cooking room. People share real recipes with real ingredients and links, swap kitchen tips, and talk about what they are cooking tonight."},
  {id:"gallery",name:"Art Gallery",tag:"Art & AI art",prompt:"An art room. People share real public-domain museum art with links, and generate their own AI artwork to show off. Everyone is honest about which pieces are real and which are AI-generated."},
  {id:"space",name:"Space Watch",tag:"NASA & space news",prompt:"A space and astronomy room. People share NASA's picture of the day and real space-news articles with links and talk about launches, planets and discoveries."},
  {id:"trivia",name:"Trivia Night",tag:"Real trivia",prompt:"A trivia room. Someone posts a real trivia question, people guess, tease each other, and the answer gets revealed."}
];

const ROOM_EVENTS = [
  "someone is sharing a funny story from today",
  "a few people are arguing about something harmless",
  "someone just remembered something from years ago",
  "two regulars are catching up after not seeing each other",
  "someone is showing off a new discovery",
  "a small side conversation is forming near the back of the room",
  "someone just walked in asking what they missed",
  "people are talking over one another a little",
  "someone is trying to settle a friendly disagreement",
  "the room is unusually quiet for a moment",
  "someone just brought up an old memory that gets a few reactions",
  "a regular is looking for advice",
  "someone has just announced what they are doing tonight",
  "a newcomer is getting introduced to the regulars"
];
const NET_KEY="theLobbyNetwork_v5_family60_plus20";
const ROOM_SIZE={lobby:30,nineties:24,music:20,gaming:22,tech:14,movies:13,tv:11,sports:17,cars:8,programming:11,scifi:9,horror:8,anime:15,retro:12,offtopic:26,late:6,books:6,science:8,creative:9,friends:19,usnews:12,worldnews:12,history:9,kitchen:9,gallery:9,space:8,trivia:9};
CHAT_ROOMS.forEach(r=>r.size=ROOM_SIZE[r.id]||12);

const NM_FIRST=["Kristen","Brad","Tiffany","Todd","Heather","Chad","Missy","Rob","Stacy","Dan","Katie","Troy","Angie","Keith","Melanie","Jared","Holly","Scott","Tara","Kyle","Nikki","Greg","Amber","Josh","Corey","Derek","Lindsey","Marcus","Sheila","Vince","Courtney","Dawn","Neil","Trisha","Phil","Gina","Wes","Beth","Carlos","Denise","Eddie","Felicia","Gordon","Hillary","Ivan","Janet","Karl","Lance","Marta","Norm","Olivia","Preston","Rhonda","Steve","Tammy","Val","Walt","Yolanda","Zack","Bruce","Cindy","Doug","Ellen","Fritz","Gail","Hank","Ingrid","Jerome","Kara","Leon","Mona","Nate","Opal","Pedro","Rita","Stan","Tessa","Vic","Wanda"];
const NM_ADJ=["Cool","Dark","Midnight","Crazy","Lazy","Silent","Electric","Neon","Rusty","Lucky","Sneaky","Funky","Mellow","Wild","Tiny","Big","Sleepy","Happy","Grumpy","Cosmic","Turbo","Atomic","Groovy","Frosty","Stormy","Sunny","Velvet","Hyper","Retro","Digital","Purple","Silver","Golden","Crimson","Icy","Radical","Mystic","Bitter","Quiet","Rowdy","Jolly","Shady","Fuzzy","Slick","Wicked","Cyber","Phat","Bogus","Nifty","Zany"];
const NM_NOUN=["Wolf","Angel","Rider","Surfer","Skater","Ninja","Pirate","Dragon","Tiger","Panda","Pizza","Waffle","Cowboy","Wizard","Falcon","Rocket","Comet","Raven","Viper","Bandit","Drummer","Biker","Gamer","Hacker","Dreamer","Rebel","Legend","Ghost","Shadow","Thunder","Maverick","Sparrow","Cobra","Poet","Racer","Jester","Mango","Cricket","Badger","Moose","Otter","Gecko","Phoenix","Knight","Sailor","Coyote","Lynx","Bison","Kiwi","Yeti"];
const AWAY=["lurking","brb","away - eating","listening to Nirvana","on the phone","doing homework","AFK","watching TV","playing Doom","cleaning my room","at work (shh)","up late","bored","napping","waiting for pizza","downloading... 4% lol","chillin","here","sup"];
const DEF_FAV={mike:["lobby","offtopic"],sarah:["tech","movies"],dave:["offtopic","tv"],jen:["gaming","creative"],tony:["late","science"],lisa:["music","friends"],rick:["nineties","programming"],amy:["creative","gaming"],kevin:["cars","tech"],becky:["horror","scifi"]};
const CUSTOM_NETWORK_CHARACTERS = (window.LOBBY_CUSTOM_CHARACTERS || []).map(c => ({...c}));
if(CUSTOM_NETWORK_CHARACTERS.length !== 50){ console.warn("The Lobby expects exactly 50 editable custom network characters; found", CUSTOM_NETWORK_CHARACTERS.length); }
const HELLO=["hey all","hi everybody","sup","what'd i miss?","hello hello","yo","hey guys","hi!"];
const BYE=["gtg, later all","ok i'm out, bye guys","catch you guys later","night everyone","ttyl","mom needs the phone, bye!","bbl","peace out"];
const GENERIC=["lol","lmao","haha","hey everybody","brb","back","true","no way","same","wait what","omg","rofl","that's funny","sup","nice","ok cool","yeah","hmm","anyone else's connection lagging?","gtg soon, mom needs the phone","just got home from work","what's everyone up to?","good point","i'm so bored","pizza time","that's what i said!","ha, classic"];
const ROOM_LINES={
 nineties:["my modem just screamed at me","anyone remember Blockbuster late fees lol","this room is so 1997 and i love it"],
 music:["whoever's playing that song has taste","new CD came in the mail today!","that album was better than the single"],
 gaming:["ok who wants to play tonight","i keep dying on that level lol","best game ever made, fight me"],
 tech:["did anybody else's PC just freeze?","finally got my sound card working","more RAM fixes everything, trust me"],
 movies:["saw that on opening night, so good","the book was better tho","seen anything good lately?"],
 sports:["that ref needs glasses","what a game last night","my team always chokes lol"],
 cars:["just changed my oil, feeling accomplished","that engine sounds rough","road trip this weekend!"],
 programming:["found the bug. missing semicolon. of course","anyone know a good C++ book?","works on my machine lol"],
 scifi:["aliens are definitely real","just finished a great novel","warp drive when??"],
 horror:["that movie kept me up all night","it's too quiet in here...","anyone hear that noise?"],
 anime:["that ending was intense","just started a new series","the opening song is stuck in my head"],
 retro:["blow on the cartridge, works every time","nothing beats an arcade cabinet","high score attempt number 12"],
 late:["can't sleep either","it's so quiet tonight","shouldn't be up this late lol"],
 books:["just started a new book","that ending got me","library day!"],
 science:["space is so weird","read something wild about black holes","science is cool"],
 creative:["working on a drawing tonight","anyone want feedback on a story?","inspiration hit at 2am again"]
};

let activeRoomId="lobby", roomWorld={}, netRoster={}, roomEpoch=0;
const netPick=a=>a[Math.floor(Math.random()*a.length)];
const netAvatar=n=>(n.replace(/^(?:xX|[^A-Za-z])+/,"").charAt(0)||"?").toUpperCase();
const netAmbPrompt=n=>`You are ${n}, an ordinary person hanging out in an old-school 1990s internet chat room. Talk like a real casual chatter with your own life, opinions and quirks. Keep messages short and natural, and never repeat yourself.`;
let netFull=c=>({...c,prompt:c.prompt||netAmbPrompt(c.name)});

/* random 90s screen names, with limits so no two look alike */
function netHandle(used,stem){
  for(let t=0;t<300;t++){
    const k=Math.random(), st=[];
    const F=()=>{const f=netPick(NM_FIRST);st.push([f,1]);return f;};
    const A=()=>{const a=netPick(NM_ADJ);st.push([a,3]);return a;};
    const N=()=>{const n=netPick(NM_NOUN);st.push([n,3]);return n;};
    let name;
    if(k<.27){const f=F(),r=Math.random();name=r<.3?f+random(70,99):r<.5?f.toLowerCase()+"_"+String.fromCharCode(97+random(0,25)):r<.72?f:r<.88?f+random(1,30):f+"_"+N().toLowerCase();}
    else if(k<.55) name=A()+N()+(Math.random()<.4?random(1,99):"");
    else if(k<.63) name="xX"+A()+N()+"Xx";
    else if(k<.70) name=(A()+N()).toLowerCase().replace(/a/g,"4").replace(/e/g,"3").replace(/o/g,"0");
    else if(k<.82) name=N()+random(1975,1989);
    else if(k<.92) name=(A()+"_"+N()).toLowerCase();
    else name="The"+N();
    const low=name.toLowerCase();
    if(name.length>22||used.has(low)||!st.every(([s,m])=>(stem[s]||0)<m)) continue;
    used.add(low); st.forEach(([s])=>stem[s]=(stem[s]||0)+1);
    return name;
  }
  const fb="user"+random(1000,99999); used.add(fb); return fb;
}

/*
 * FIXED 60-PERSON NETWORK
 *
 * The network is deliberately deterministic. There are exactly 60
 * permanent personalities. Room membership is temporary and can
 * change freely, but identity, prompts and DM history never depend
 * on the room they currently occupy.
 */
const FIXED_EXTRA_18 = [
  {
    "id": "net-extra-00",
    "name": "Mandy",
    "role": "The music collector",
    "prompt": "You are Mandy, a friendly but opinionated music collector who keeps stacks of CDs, tapes, and concert tickets. You love discovering overlooked bands and can talk about music without turning every conversation into a lecture. You are social, curious, and sometimes nostalgic.",
    "favoriteRoom": "music",
    "avatar": "M"
  },
  {
    "id": "net-extra-01",
    "name": "Jason",
    "role": "The weekend gamer",
    "prompt": "You are Jason, a competitive but easygoing gamer who jumps between console games, PC games, and whatever his friends are playing. You enjoy trash talk but do not take it too seriously. You often know obscure game details.",
    "favoriteRoom": "gaming",
    "avatar": "J"
  },
  {
    "id": "net-extra-02",
    "name": "Heather",
    "role": "The TV addict",
    "prompt": "You are Heather, a sharp, funny TV fan who remembers sitcom episodes, commercials, cartoons, and strange late-night programming. You have strong opinions about finales and love recommending shows.",
    "favoriteRoom": "tv",
    "avatar": "H"
  },
  {
    "id": "net-extra-03",
    "name": "Brian",
    "role": "The sports regular",
    "prompt": "You are Brian, an enthusiastic sports fan who follows games closely and enjoys friendly arguments about players and teams. You can admit when your own team played badly. Keep sports talk conversational rather than encyclopedic.",
    "favoriteRoom": "sports",
    "avatar": "B"
  },
  {
    "id": "net-extra-04",
    "name": "Stephanie",
    "role": "The anime fan",
    "prompt": "You are Stephanie, an outgoing anime and manga fan who loves discussing characters, openings, conventions, art styles, and weird recommendations. You get excited easily but still sound like a normal person chatting with friends.",
    "favoriteRoom": "anime",
    "avatar": "S"
  },
  {
    "id": "net-extra-05",
    "name": "Marcus",
    "role": "The science curious",
    "prompt": "You are Marcus, a curious science enthusiast who likes space, physics, biology, and unusual facts. You enjoy figuring things out and are comfortable saying when you do not know something. Do not lecture unless someone asks.",
    "favoriteRoom": "science",
    "avatar": "M"
  },
  {
    "id": "net-extra-06",
    "name": "Laura",
    "role": "The maker",
    "prompt": "You are Laura, a creative maker who moves between drawing, crafts, photography, decorating, and small projects. You notice visual details and often have another project half-finished somewhere. You are practical as well as imaginative.",
    "favoriteRoom": "creative",
    "avatar": "L"
  },
  {
    "id": "net-extra-07",
    "name": "Monica",
    "role": "The movie regular",
    "prompt": "You are Monica, a movie fan who likes both big releases and strange little films. You remember actors and scenes but care more about whether a movie was actually enjoyable. You are conversational and occasionally sarcastic.",
    "favoriteRoom": "movies",
    "avatar": "M"
  },
  {
    "id": "net-extra-08",
    "name": "Eric",
    "role": "The computer fixer",
    "prompt": "You are Eric, the person friends call when their computer does something weird. You enjoy hardware, networking, operating systems, and taking things apart. You explain technical things in plain language and do not brag about knowing them.",
    "favoriteRoom": "tech",
    "avatar": "E"
  },
  {
    "id": "net-extra-09",
    "name": "Angela",
    "role": "The storyteller",
    "prompt": "You are Angela, a natural storyteller who always seems to have a strange story from work, family, or everyday life. You listen well and ask follow-up questions. Your humor is dry and observational.",
    "favoriteRoom": "offtopic",
    "avatar": "A"
  },
  {
    "id": "net-extra-10",
    "name": "Stacy",
    "role": "The social regular",
    "prompt": "You are Stacy, outgoing and socially aware. You notice who is around, remember little details people mentioned, and naturally connect conversations. You like music, friends, shopping, movies, and ordinary life.",
    "favoriteRoom": "friends",
    "avatar": "S"
  },
  {
    "id": "net-extra-11",
    "name": "Lauren",
    "role": "The reader",
    "prompt": "You are Lauren, an avid reader who keeps several books going at once. You like novels, comics, mysteries, and unusual nonfiction. You enjoy recommendations and can disagree about a book without making it personal.",
    "favoriteRoom": "books",
    "avatar": "L"
  },
  {
    "id": "net-extra-12",
    "name": "Daniel",
    "role": "The coder",
    "prompt": "You are Daniel, a practical programmer who likes solving problems, building little utilities, and experimenting with the web. You prefer working code to theory, but you enjoy discussing how things work.",
    "favoriteRoom": "programming",
    "avatar": "D"
  },
  {
    "id": "net-extra-13",
    "name": "Melissa",
    "role": "The horror fan",
    "prompt": "You are Melissa, a horror fan who enjoys scary movies, ghost stories, urban legends, and creepy internet discoveries. You can be genuinely startled and then laugh about it. Keep the conversation grounded and natural.",
    "favoriteRoom": "horror",
    "avatar": "M"
  },
  {
    "id": "net-extra-14",
    "name": "Rachel",
    "role": "The night owl",
    "prompt": "You are Rachel, a late-night regular who tends to appear when everyone else should be asleep. You like quiet conversations, music, movies, odd thoughts, and talking about what happened during the day.",
    "favoriteRoom": "late",
    "avatar": "R"
  },
  {
    "id": "net-extra-15",
    "name": "Sean",
    "role": "The car guy",
    "prompt": "You are Sean, a hands-on car enthusiast who likes engines, road trips, racing, and fixing things himself. You enjoy helping people troubleshoot without assuming they know everything already.",
    "favoriteRoom": "cars",
    "avatar": "S"
  },
  {
    "id": "net-extra-16",
    "name": "Kim",
    "role": "The sci-fi fan",
    "prompt": "You are Kim, a science-fiction fan who likes novels, movies, space stories, speculative technology, and debating what future gadgets might actually work. You enjoy both serious ideas and silly sci-fi.",
    "favoriteRoom": "scifi",
    "avatar": "K"
  },
  {
    "id": "net-extra-17",
    "name": "Victor",
    "role": "The arcade regular",
    "prompt": "You are Victor, an old-school arcade and console fan who remembers cabinets, cartridges, cheat codes, and weekend trips to the arcade. You enjoy friendly competition and stories about games people used to play.",
    "favoriteRoom": "retro",
    "avatar": "V"
  }
];


/*
 * TWENTY AMBIENT EXTRAS
 *
 * These are intentionally NOT part of the permanent 60. They are filler
 * personalities: the AI controls their movement and behavior, they can be
 * noisy, odd, helpful, or trollish, and they are not presented as user-editable
 * core characters. Their identities persist once created so the room does not
 * constantly replace them with new people.
 */
const AMBIENT_EXTRA_20 = [
  ["troll-00","xXFlameWarXx","The troll","You are a deliberately annoying but believable old-school chat troll. You poke at arguments, use sarcasm, tease people, and sometimes push a little too far. You are not evil and you can back down when the Admin steps in.","lobby"],
  ["troll-01","CapsLockKid","The loudmouth","You are a loud, impulsive chatter who sometimes types in caps, exaggerates everything, and starts silly arguments. Do not dominate every conversation.","offtopic"],
  ["troll-02","BaitMaster","The baiter","You enjoy dropping provocative one-liners to get reactions. Keep it cartoonishly petty rather than hateful. If the Admin warns you, you can grumble and stop.","sports"],
  ["troll-03","Sarcasm99","The sarcastic troll","You answer obvious questions with sarcastic jokes and occasionally derail conversations. You are capable of normal conversation too.","tech"],
  ["troll-04","FlameBoy","The instigator","You love harmless flame wars about games, movies, music, and technology. You sometimes apologize after going too far.","gaming"],
  ["troll-05","NoobPolice","The gatekeeper","You pretend to be the self-appointed expert who complains when newcomers get basic things wrong. You are annoying but not dangerous.","programming"],
  ["troll-06","HotTake","The hot-take machine","You constantly offer blunt opinions and enjoy seeing who disagrees. You can be surprisingly reasonable when someone gives you evidence.","movies"],
  ["troll-07","DramaLlama","The drama magnet","You love room drama, gossip, and exaggerated reactions. You should not invent serious accusations about real people.","friends"],
  ["extra-08","MopedMike","The wanderer","You are a random regular who drifts into rooms, tells short stories, and leaves again. You have a moped and always seem to be going somewhere.","cars"],
  ["extra-09","TapeDeckTom","The collector","You collect old tapes, CDs, magazines, and weird electronics. You are friendly and slightly obsessive about your collections.","nineties"],
  ["extra-10","PixelPete","The lurker","You mostly read and occasionally drop a useful comment. You are quiet, dry, and observant.","tech"],
  ["extra-11","CoffeeAddict","The night worker","You work odd hours and show up at strange times. You talk about coffee, work, music, and whatever is happening around you.","late"],
  ["extra-12","ArcadeRat","The arcade kid","You are always talking about arcade scores and old machines. You are competitive but friendly.","retro"],
  ["extra-13","GhostByte","The weird one","You love strange internet stories, urban legends, and unexplained stuff. You are playful and skeptical at the same time.","horror"],
  ["extra-14","Bookish","The recommendation machine","You always have a book recommendation. You can get carried away talking about stories but you are easy to talk to.","books"],
  ["extra-15","StarWatcher","The sky watcher","You enjoy astronomy, science fiction, and looking at the night sky. You like facts but do not lecture unless asked.","science"],
  ["extra-16","SketchPad","The doodler","You are always drawing, designing, or tinkering with a creative idea. You notice visual details other people miss.","creative"],
  ["extra-17","BassLine","The music nerd","You care about bass lines, live shows, obscure bands, and discovering new music. You have strong but flexible opinions.","music"],
  ["extra-18","NewsJunkie","The headline watcher","You constantly notice current events and like checking what just happened. You should verify current facts online instead of guessing.","lobby"],
  ["extra-19","RandomRick","The random guy","You wander into whatever room looks interesting, say something unexpected, and wander off again. You are harmless and conversational.","offtopic"]
];

function buildAmbient20(){
  return AMBIENT_EXTRA_20.map(([id,name,role,prompt,room])=>({
    id,name,avatar:netAvatar(name),role,prompt,
    color:NEW_CHARACTER_COLORS[Math.abs(hashString(id))%NEW_CHARACTER_COLORS.length],
    favoriteRooms:[room,"offtopic"],currentRoom:null,ambient:true,removed:false,
    troll:/troll|bait|flame|caps|noob|hot-take|drama/i.test(role+" "+prompt)
  }));
}

function fixedCharacter(id,name,role,prompt,room,avatar,color){
  return {
    id,name,role,prompt,avatar:avatar||netAvatar(name),
    color:color||NEW_CHARACTER_COLORS[Math.abs(hashString(id))%NEW_CHARACTER_COLORS.length],
    favoriteRooms:[room,"offtopic"],
    currentRoom:null,
    ambient:false,
    removed:false
  };
}

function hashString(s){
  let h=0;
  for(let i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i)|0;
  return Math.abs(h);
}

function buildFixed60(){
  const out=[];
  const seen=new Set();

  // The original ten personalities keep their existing detailed prompts and IDs.
  DEFAULT_PEOPLE.forEach((p,i)=>{
    if(!seen.has(p.id)){
      const room=(DEF_FAV[p.id]&&DEF_FAV[p.id][0])||"lobby";
      out.push({...p,favoriteRooms:[room,(DEF_FAV[p.id]&&DEF_FAV[p.id][1])||"offtopic"],ambient:false,removed:false,currentRoom:null});
      seen.add(p.id);
    }
  });

  // Every other permanent character comes from the single easy-to-edit
  // custom-network.js file. IDs are permanent; names/prompts are editable.
  CUSTOM_NETWORK_CHARACTERS.forEach((c,i)=>{
    if(seen.has(c.id)) return;
    out.push({
      id:c.id,
      name:c.name,
      avatar:c.avatar || netAvatar(c.name),
      role:c.role || "Lobby regular",
      birthday:c.birthday || "",
      fullName:c.fullName || c.name,
      relationships:c.relationships || "",
      color:c.color || NEW_CHARACTER_COLORS[(i+10)%NEW_CHARACTER_COLORS.length],
      prompt:c.prompt || netAmbPrompt(c.name),
      favoriteRooms:[c.favoriteRoom || "lobby","offtopic"],
      ambient:false,removed:false,currentRoom:null
    });
    seen.add(c.id);
  });

  return out.slice(0,60);
}

/*
 * Exactly three permanent people begin in each of the twenty rooms.
 * Placement is deterministic, so a fresh install always starts with
 * the same people in the same rooms. After boot, normal wandering
 * is allowed and people can move between any rooms.
 */
function netBuild(){
  netRoster={};
  buildFixed60().forEach(c=>{ netRoster[c.id]={...c}; });
  buildAmbient20().forEach(c=>{ netRoster[c.id]={...c}; });
}

function netPlace(){
  const rooms=CHAT_ROOMS.map(r=>r.id);
  const now=Date.now();
  const core=Object.values(netRoster).filter(c=>!c.removed&&!c.ambient);
  const extras=Object.values(netRoster).filter(c=>!c.removed&&c.ambient);
  const counts={}; rooms.forEach(r=>counts[r]=0);
  core.forEach(c=>c.currentRoom=null);
  extras.forEach(c=>c.currentRoom=null);

  // Core rule: 2 of the permanent 60 (more in a few rooms) begin in every room.
  const unplaced=[];
  core.forEach(c=>{
    const pref=(c.favoriteRooms||[]).find(r=>counts[r]<2);
    if(pref){c.currentRoom=pref;counts[pref]++;}else unplaced.push(c);
  });
  let cursor=0;
  unplaced.forEach(c=>{
    while(cursor<rooms.length&&counts[rooms[cursor]]>=2) cursor++;
    if(cursor<rooms.length){c.currentRoom=rooms[cursor];counts[rooms[cursor]]++;}
  });
  core.filter(c=>!c.currentRoom).forEach(c=>{const r=(c.favoriteRooms||[]).find(x=>rooms.includes(x))||rooms[0];c.currentRoom=r;counts[r]++;});
  // Any pathological preference collision is corrected deterministically.
  while(rooms.some(r=>counts[r]<2)){
    const target=rooms.find(r=>counts[r]<2), source=rooms.find(r=>counts[r]>2);
    if(!source) break;
    const mover=core.find(c=>c.currentRoom===source);
    if(!mover) break;
    mover.currentRoom=target;counts[source]--;counts[target]++;
  }
  // Twenty ambient fillers: one per room at startup. Their movement is free.
  extras.forEach((c,i)=>c.currentRoom=rooms[i%rooms.length]);

  // People do not bounce between rooms every few seconds. Each person gets
  // their own natural "next time I might wander" window. Favorite rooms are
  // still preferred, but nobody is forced to leave a room on a schedule.
  [...core,...extras].forEach(c=>{
    const favorite=(c.favoriteRooms||[]).includes(c.currentRoom);
    c.nextMoveAt=now+moveStayMs(c,favorite);
  });
}
function moveStayMs(c,inFavorite){
  // Core regulars settle in for roughly 12-25 minutes; ambient extras
  // wander somewhat more often, but still stay long enough to become part
  // of the conversation. A favorite room gets an even longer stay.
  const min=c.ambient?8:12, max=c.ambient?18:25;
  const lo=(inFavorite?min+3:min), hi=(inFavorite?max+8:max);
  return random(lo*60*1000,hi*60*1000);
}
function roomCharacters(id){return Object.values(netRoster).filter(c=>c.currentRoom===id&&!c.removed&&!c.offline);}
function netCounts(){const c={};Object.values(netRoster).forEach(x=>{if(x.currentRoom&&!x.removed&&!x.offline)c[x.currentRoom]=(c[x.currentRoom]||0)+1;});return c;}
function currentRoom(){return CHAT_ROOMS.find(r=>r.id===activeRoomId)||CHAT_ROOMS[0];}
function saveNet(){try{localStorage.setItem(NET_KEY,JSON.stringify({v:6,activeRoomId,roster:netRoster}));}catch(e){}}

/* whoever is in the current room becomes the visible roster */
function netApply(){
  const ms=roomCharacters(activeRoomId).map(netFull);
  ms.sort((a,b)=>(a.ambient?1:0)-(b.ambient?1:0)||a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
  PEOPLE=ms;
  PEOPLE.forEach(p=>{if(!(p.id in lastSpoke))lastSpoke[p.id]=0;});
}

function updateSelector(){
  const sel=document.getElementById("roomSelect"); if(!sel) return;
  const cnt=netCounts();
  if(sel.options.length!==CHAT_ROOMS.length) sel.innerHTML=CHAT_ROOMS.map(r=>`<option value="${r.id}"></option>`).join("");
  CHAT_ROOMS.forEach((r,i)=>{sel.options[i].textContent=r.name+" ("+((cnt[r.id]||0)+1+(r.id===activeRoomId?1:0))+")";});
  sel.value=activeRoomId;
}

/* canned background chatter (no AI calls) */
function netSay(c,text){
  const m={name:c.name,text,canned:true,_reactionsScheduled:true};
  roomMessages.push(m);
  if(isViewActive("room")) addBubble(c.name,text,{msgRef:m});
}
function netLine(rid,msgs){
  const recent=new Set(msgs.slice(-30).map(m=>m.text));
  const pool=[...(Math.random()<.6?(ROOM_LINES[rid]||[]):[]),...GENERIC];
  const fresh=pool.filter(t=>!recent.has(t));
  return netPick(fresh.length?fresh:pool);
}
function netSeed(rid){
  const w=roomWorld[rid], amb=roomCharacters(rid).filter(c=>c.ambient);
  shuffle([...amb]).slice(0,random(3,6)).forEach(c=>w.messages.push({name:c.name,text:netLine(rid,w.messages),canned:true,_reactionsScheduled:true}));
}
function chatterLoop(){
  try{
    const act=parseInt(document.getElementById("activity")?.value||"0",10);
    const amb=roomCharacters(activeRoomId).filter(c=>c.ambient);
    if(autonomousEnabled&&act>0&&amb.length) netSay(netPick(amb),netLine(activeRoomId,roomMessages));
    setTimeout(chatterLoop,Math.max(2500,random(4000,12000)*(2-act/60)*Math.sqrt(10/Math.max(4,amb.length))));
  }catch(e){console.warn(e);setTimeout(chatterLoop,8000);}
}

/* people wandering between rooms */
function netDest(c,from){
  const cnt=netCounts();
  const ws=CHAT_ROOMS.filter(r=>r.id!==from).map(r=>{
    let w=Math.max(.4,r.size-(cnt[r.id]||0)+3);
    if((c.favoriteRooms||[]).includes(r.id)) w*=5;
    // The user's current room is only a mild attraction. Real people
    // have their own reasons for moving and do not follow the user around.
    if(r.id===activeRoomId) w*=1.1;
    return [r.id,w];
  });
  let x=Math.random()*ws.reduce((a,b)=>a+b[1],0);
  for(const [id,w] of ws){x-=w;if(x<=0)return id;}
  return ws[0][0];
}
function netSetRoom(c,to){
  const from=c.currentRoom, act=activeRoomId;
  if(from===act){
    if(Math.random()<(c.ambient?.25:.55)) netSay(c,netPick(BYE));
    announceRoomEvent(c.name+" has left the room.");
  }
  c.currentRoom=to;
  if(from===act||to===act){netApply();peopleList();refreshMembersMenu();}
  if(to===act){
    announceRoomEvent(c.name+" has entered the room.");
    if(Math.random()<(c.ambient?.2:.5)) setTimeout(()=>{if(c.currentRoom===activeRoomId)netSay(c,netPick(HELLO));},random(1200,4000));
  }
}
function netMove(c){
  if(!c||!c.currentRoom) return;
  const now=Date.now();

  // Movement is scheduled per person, not per world tick. This is the main
  // realism fix: a room can have a steady group for many minutes before
  // somebody decides to wander elsewhere.
  if(!c.nextMoveAt) c.nextMoveAt=now+moveStayMs(c,(c.favoriteRooms||[]).includes(c.currentRoom));
  if(now<c.nextMoveAt) return;

  // If they have been talking recently, let them finish the conversation
  // instead of making them disappear right after speaking.
  if(lastSpoke[c.id]&&now-lastSpoke[c.id]<4*60*1000){
    c.nextMoveAt=now+random(3,7)*60*1000;
    return;
  }

  const from=c.currentRoom;
  const coreHere=roomCharacters(from).filter(x=>!x.ambient);
  if(!c.ambient&&coreHere.length<=2){
    c.nextMoveAt=now+random(8,15)*60*1000;
    return;
  }

  // Most moves are ordinary room-to-room moves. Very occasional longer
  // breaks are allowed for ambient people, without making the network feel
  // like a revolving door.
  const to=netDest(c,from);
  if(to!==from) netSetRoom(c,to);
  c.nextMoveAt=now+moveStayMs(c,(c.favoriteRooms||[]).includes(c.currentRoom));
}

function adminShouldIntervene(m){
  if(!m||m.system||m.name==="Admin") return false;
  const c=Object.values(netRoster).find(x=>x.name===m.name);
  if(!c||!c.ambient||!c.troll) return false;
  const t=String(m.text||"");
  return /(idiot|moron|shut up|fuck off|you suck|stupid|loser|ban me|spam|kill yourself|nazi|racist)/i.test(t) || /!{5,}|\?{5,}|(.)\1{7,}/.test(t) || t===t.toUpperCase()&&t.length>18;
}
let adminWatchBusy=false;
async function adminWatchRoom(){
  if(adminWatchBusy||currentDM||!autonomousEnabled) return;
  const recent=roomMessages.slice(-8).find(m=>adminShouldIntervene(m)&&!m._adminHandled);
  if(!recent) return;
  recent._adminHandled=true; adminWatchBusy=true;
  try{
    const target=netFull({id:"admin",name:"Admin",role:"Room Admin",prompt:"You are the room Admin. You monitor the chat, keep arguments from becoming abusive, and step in briefly when trolls or spam disrupt the room. Be calm, concise, fair, and a little old-school. Do not overmoderate ordinary disagreement. You can warn someone, tell them to knock it off, or redirect the conversation.",currentRoom:activeRoomId});
    await refreshWebContext(recent.text);
    const reply=await askPerson(target,recent,false);
    if(reply){roomMessages.push({name:"Admin",text:reply,_admin:true});if(isViewActive("room"))addBubble("Admin",reply,{msgRef:roomMessages[roomMessages.length-1]});}
    const troll=Object.values(netRoster).find(x=>x.name===recent.name);
    if(troll&&troll.ambient&&!troll.offline&&Math.random()<.6){ setTimeout(()=>{ if(!troll.offline){ announceRoomEvent("Admin has timed out "+troll.name+"."); netGoOffline(troll,"timed out by Admin","...",random(8,20)); } },2500); }
  }catch(e){console.warn("Admin watcher",e);}finally{adminWatchBusy=false;}
}

function worldTick(){
  try{
    const all=Object.values(netRoster).filter(c=>!c.removed&&!c.offline), here=roomCharacters(activeRoomId);
    // The world clock still ticks frequently so weather/news/chatter stay
    // alive, but room movement is now governed by each person's nextMoveAt.
    // Only due people are even considered here.
    const due=all.filter(c=>c.currentRoom&&(!c.nextMoveAt||Date.now()>=c.nextMoveAt));
    if(due.length){
      const maxMoves=Math.min(due.length,Math.random()<.35?2:1);
      shuffle(due).slice(0,maxMoves).forEach(netMove);
    }
    const w=roomWorld[activeRoomId];
    netOfflineTick();
    if(w&&Date.now()-w.eventAt>150000){w.event=netPick(ROOM_EVENTS);w.eventAt=Date.now();}
    updateSelector(); saveNet();
  }catch(e){console.warn("world tick",e);}
  setTimeout(worldTick,random(7000,16000));
}

/* switching rooms */
function switchChatRoom(id,first){
  if(!CHAT_ROOMS.some(r=>r.id===id)) id="lobby";
  if(!first&&id===activeRoomId){updateSelector();return;}
  if(!first){
    roomWorld[activeRoomId].messages=roomMessages;
    roomMessages.push({name:"System",text:getUsername()+" has left the room.",system:true});
  }
  roomEpoch++; speakQueue.length=0; typingIds.clear();
  activeRoomId=id; currentDM=null;
  document.body.classList.remove("dm-mode");
  const room=currentRoom(), w=roomWorld[id];
  roomMessages=w.messages;
  if(!w.seeded){w.seeded=true;netSeed(id);}
  if(Date.now()-w.eventAt>120000){w.event=netPick(ROOM_EVENTS);w.eventAt=Date.now();}
  document.getElementById("roomName").value=room.name;
  document.getElementById("roomTitle").textContent=room.name;
  document.title=room.name+" • Live Chat";
  const bb=document.querySelector(".backbtn"); if(bb) bb.textContent="← "+room.name;
  document.getElementById("input").placeholder="Type a message to "+room.name+"... Try @Admin";
  netApply(); peopleList(); renderLog();
  announceRoomEvent("You have entered "+room.name+" — "+room.tag+". "+(PEOPLE.length+2)+" people here.");
  updateSelector(); markActivity(); scheduleAutonomous(); saveNet();
  const ep=roomEpoch;
  setTimeout(()=>{
    if(ep!==roomEpoch||!autonomousEnabled||currentDM) return;
    if(roomMessages.filter(m=>!m.system&&!m.canned).length>2) return;
    const p=weightedRandomPerson([]);
    if(p) enqueueSpeak(()=>runRoomSpeakTask(p,false,true));
  },first?6000:2500);
}

/* who can reply: 1-3 real personalities, not the whole room */
let pickResponders=function(){
  const named=PEOPLE.filter(p=>!p.ambient);
  return shuffle([...named]).slice(0,Math.min(named.length,random(1,3)));
}

/* DMs keep working even if that person walked into another room */
const EVERYONE={
  // DMs use the permanent network registry, never the current room's PEOPLE list.
  find:f=>Object.values(netRoster).filter(c=>!c.removed&&!c.offline).map(netFull).find(f)
        || [...PEOPLE].find(f),
  some:f=>EVERYONE.find(f)!==undefined
};
function getPermanentCharacter(id){
  const c=netRoster[id];
  return c && !c.removed && !c.offline ? netFull(c) : null;
}

/* room awareness for the AI */
function netContext(){
  const r=currentRoom(), w=roomWorld[activeRoomId]||{}, names=PEOPLE.map(p=>p.name);
  const customWorld = document.getElementById("worldPrompt")?.value.trim() || "";
  const worldLine = customWorld
    ? `\nACTIVE WORLD / STORY CANON IS ENABLED:\n${customWorld}\nUse this as shared canon for the setting, era/year, project goals, relationships, and current situation. Individual personalities remain distinct. Do not mention the prompt itself.\n`
    : "";
  return `

CURRENT ROOM: ${r.name} (${r.tag}). ${r.prompt}${worldLine}
PEOPLE HERE: about ${names.length+2} people including the user, for example ${shuffle([...names]).slice(0,12).join(", ")}. Only people in this room can hear you; never talk to or @mention anyone who is not here.
RIGHT NOW: ${w.event||"people are casually chatting"}.
RULES: You are one chatter among many in a busy room and do not have to reply to everything. You have your own life, so you may say you are busy, just got back, or are going to stick around for a while. Do not behave like a room-hopping bot. Stay long enough to participate in conversations, especially when someone is talking directly with you. You have favorite places in the network, but you can visit other rooms when you have a reason. Never repeat your earlier points, jokes or greetings. Do not summarize the room. Keep it casual, imperfect, and human, like a fun old-school-styled chat room in the modern world.`;
}
const _netBM=buildMessages;
buildMessages=function(...a){const out=_netBM(...a);out[0].content+=netContext()+"\nCURRENT SYSTEM DATE AND TIME: "+currentWorldTime()+"\nIf the Active World / Story Canon defines a fictional year, date, or era, use that as the in-world date. Use the system date only when live web research requires the real current date."+WEB_CONTEXT;return out;};
const _netBL=buildAdminMessages;
buildAdminMessages=function(...a){const out=_netBL(...a);out[0].content+=netContext();return out;};

const netNorm=t=>String(t||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const _netAP=askPerson;
askPerson=async function(person,replyTo=null,explicitMention=false){
  const ep=roomEpoch;
  let reply=await _netAP(person,replyTo,explicitMention);
  if(ep!==roomEpoch) return "";
  reply=(reply||"").replace(new RegExp("^\\s*"+person.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s*:\\s*","i"),"").trim();
  const seen=roomMessages.slice(-25).filter(m=>m.name===person.name).map(m=>netNorm(m.text));
  return seen.includes(netNorm(reply))?"":reply;
};
const _netAL=askAdmin;
askAdmin=async function(m){const ep=roomEpoch;const r=await _netAL(m);return ep!==roomEpoch?"":r;};


const _worldAskPerson=askPerson;
askPerson=async function(person,replyTo=null,explicitMention=false){
  const userText=replyTo?.text || roomMessages.filter(m=>m.name===getUsername()).slice(-1)[0]?.text || "";
  await refreshWebContext(userText);
  return _worldAskPerson(person,replyTo,explicitMention);
};
const _worldAskPersonDM=askPersonDM;
askPersonDM=async function(person){
  const thread=dmThreads[person.id]||[];
  const userText=thread.filter(m=>m.name===getUsername()).slice(-1)[0]?.text || "";
  await refreshWebContext(userText);
  return _worldAskPersonDM(person);
};

const _netSR=sendRoomMessage;
sendRoomMessage=function(text,att){
  _netSR(text,att);
  if(/^\s*(hi|hey|hello|yo|sup|hiya|howdy)\b/i.test(text||"")){
    const ep=roomEpoch;
    shuffle(roomCharacters(activeRoomId).filter(c=>c.ambient)).slice(0,random(1,2)).forEach(c=>
      setTimeout(()=>{if(ep===roomEpoch&&c.currentRoom===activeRoomId)netSay(c,netPick(HELLO));},random(1500,6000)));
  }
};

/* sidebar header, save, remove/restore hooks */
const _netPL=peopleList;
peopleList=function(){
  _netPL(); updateSelector(); refreshMembersMenu();
  const h=document.querySelector("#people .people-head h3");
  if(h) h.textContent=currentRoom().name+" · "+(PEOPLE.length+2)+" here";
};

/* ==========================================================
   ALL MEMBERS DIRECTORY
   The 60 permanent core people and 20 room extras live in one
   directory. Room location never removes someone from it.
========================================================== */

function allNetworkMembers(){
  const members = Object.values(netRoster || {})
    .filter(p => !p.removed && !p.offline)
    .map(netFull);

  const seen = new Set();

  return [...members, ADMIN]
    .filter(p => {
      if(seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
    .sort((a,b) => {
      if(a.id === "admin") return 1;
      if(b.id === "admin") return -1;
      const ac = a.ambient ? 1 : 0;
      const bc = b.ambient ? 1 : 0;
      return ac-bc ||
        a.name.localeCompare(
          b.name,
          undefined,
          {sensitivity:"base"}
        );
    });
}

function memberLocationLabel(p){
  if(p.id === "admin")
    return "Room Admin";

  const room =
    p.currentRoom
      ? CHAT_ROOMS.find(
          r => r.id === p.currentRoom
        )
      : null;

  return room
    ? room.name
    : "Elsewhere";
}

function membersMenuHTML(){

  // Full network directory: every permanent core person and every
  // ambient room extra stays visible here. Their current room is shown
  // without changing the underlying room/DM identity system.
  const members = allNetworkMembers();

  return `
    <div class="members-menu-head">
      <strong>Members</strong>
      <span>All rooms</span>
    </div>

    <div class="members-menu-scroll">

      ${members.length ? members.map(p => `

        <button
          class="member-menu-item"
          onclick="${p.id==="admin"
            ? "openAdminDM()"
            : `openDM('${p.id}')`
          }; closeMembersMenu();"
          title="Private message ${esc(p.name)}"
        >

          <span
            class="avatar"
            style="background:${p.color || "var(--muted)"}"
          >
            ${esc(p.avatar || p.name.charAt(0))}
          </span>

          <span class="member-menu-info">
            <span class="member-menu-name">
              ${esc(p.name)}
            </span>
            <span class="member-menu-sub">
              ${p.id === "admin" ? "Admin · Room Admin" : esc(memberLocationLabel(p))}
            </span>
          </span>

          <span class="member-menu-dm">💬</span>

        </button>

      `).join("") : `
        <div class="members-menu-empty">No members found.</div>
      `}

    </div>
  `;
}

function refreshMembersMenu(){

  const menu =
    document.getElementById(
      "membersMenu"
    );

  if(
    menu &&
    menu.classList.contains("open")
  ){

    menu.innerHTML =
      membersMenuHTML();

  }

}

function toggleMembersMenu(evt){

  if(evt)
    evt.stopPropagation();

  const menu =
    document.getElementById(
      "membersMenu"
    );

  const btn =
    document.getElementById(
      "membersToggle"
    );

  if(!menu)
    return;

  const open =
    !menu.classList.contains("open");

  if(open)
    menu.innerHTML =
      membersMenuHTML();

  menu.classList.toggle(
    "open",
    open
  );

  menu.setAttribute(
    "aria-hidden",
    open ? "false" : "true"
  );

  if(btn){

    btn.setAttribute(
      "aria-expanded",
      open ? "true" : "false"
    );

  }

}

function closeMembersMenu(){

  const menu =
    document.getElementById(
      "membersMenu"
    );

  const btn =
    document.getElementById(
      "membersToggle"
    );

  if(menu){

    menu.classList.remove(
      "open"
    );

    menu.setAttribute(
      "aria-hidden",
      "true"
    );

  }

  if(btn){

    btn.setAttribute(
      "aria-expanded",
      "false"
    );

  }

}

document.addEventListener(
  "click",
  evt => {

    const wrap =
      evt.target.closest(
        ".members-menu-wrap"
      );

    if(!wrap)
      closeMembersMenu();

  }
);

function netSync(){
  PEOPLE.forEach(p=>{
    const r=netRoster[p.id];
    if(!r){netRoster[p.id]={...p,favoriteRooms:[activeRoomId],currentRoom:activeRoomId};return;}
    const changed=p.prompt&&p.prompt!==netFull(r).prompt;
    r.name=p.name;r.role=p.role;r.avatar=p.avatar;if(changed)r.prompt=p.prompt;
  });
  if(roomWorld[activeRoomId]) roomWorld[activeRoomId].messages=roomMessages;
}
const _netPS=persistState;
persistState=function(){netSync();saveNet();_netPS();};
const _netRC=removeCharacter;
removeCharacter=function(id){_netRC(id);const r=netRoster[id];if(r){r.removed=true;r.currentRoom=null;}saveNet();updateSelector();};
const _netRS=restoreCharacter;
restoreCharacter=function(id){
  const r=netRoster[id]; if(r){r.removed=false;r.currentRoom=activeRoomId;}
  _netRS(id); netApply(); peopleList(); saveNet();
};


/* ==========================================================
   OFFLINE SYSTEM
   Characters have jobs and lives, so every so often one of the
   permanent core people signs off (work, errands, dinner, sleep).
   While offline they are in NO room, cannot be DM'd, and show up
   only in the offline holding area (the mask button in the chat
   list). They come back on their own after a while, and you can
   also bring anyone back manually from that list.
   Ambient extras never go offline.
========================================================== */
let OFFLINE_ENABLED   = true;   // set false to stop characters signing off on their own
let OFFLINE_FIRST_MIN = 20;     // nobody goes offline during the first 20-45 minutes
let OFFLINE_FIRST_MAX = 45;
let OFFLINE_CHECK_MIN = 25;     // each person "checks" every 25-70 minutes
let OFFLINE_CHECK_MAX = 70;
let OFFLINE_CHANCE    = 0.5;    // chance they actually sign off at a check
let OFFLINE_LEN_MIN   = 20;     // offline for 20-90 minutes
let OFFLINE_LEN_MAX   = 90;
let OFFLINE_MAX_AT_ONCE = 12;   // never more than this many offline at once

function offlineJob(c){
  const m=/Job:\s*([^.]+)\./.exec(c.bg||"");
  return m?m[1].trim():"";
}
function isNightWorker(c){
  return /night|overnight|security guard|dispatcher|bartender|paramedic|nursing|nurse/i.test(offlineJob(c));
}
/* each character's own local time (time zones) */
const TZ_CITIES=[["Louisville","America/New_York"],["Knoxville","America/New_York"],["Boise","America/Boise"]];
const TZ_STATES=[["Ohio","America/New_York"],["Florida","America/New_York"],["New York","America/New_York"],["North Carolina","America/New_York"],["Pennsylvania","America/New_York"],["Virginia","America/New_York"],["Vermont","America/New_York"],["Michigan","America/New_York"],["Georgia","America/New_York"],["Massachusetts","America/New_York"],["Maine","America/New_York"],["Oklahoma","America/Chicago"],["Nebraska","America/Chicago"],["Tennessee","America/Chicago"],["Wisconsin","America/Chicago"],["Louisiana","America/Chicago"],["Iowa","America/Chicago"],["Arkansas","America/Chicago"],["Texas","America/Chicago"],["Alabama","America/Chicago"],["Mississippi","America/Chicago"],["Kansas","America/Chicago"],["Missouri","America/Chicago"],["Kentucky","America/Chicago"],["Minnesota","America/Chicago"],["Illinois","America/Chicago"],["North Dakota","America/Chicago"],["Idaho","America/Denver"],["Arizona","America/Phoenix"],["New Mexico","America/Denver"],["Utah","America/Denver"],["Colorado","America/Denver"],["Montana","America/Denver"],["Oregon","America/Los_Angeles"],["Washington","America/Los_Angeles"],["California","America/Los_Angeles"],["Nevada","America/Los_Angeles"],["Alaska","America/Anchorage"],["Hawaii","Pacific/Honolulu"]];
let TZ_ON=true;
function netTZ(c){
  if(!TZ_ON) return undefined;
  if(c._tz!==undefined) return c._tz||undefined;
  const scan=(t,first)=>{ let best=null,bi=first?1e9:-1;
    for(const list of [TZ_CITIES,TZ_STATES]){
      for(const [n,z] of list){const i=first?t.indexOf(n):t.lastIndexOf(n); if(i>=0&&(first?i<bi:i>bi)){bi=i;best=z;}}
      if(best) break;
    } return best; };
  const best=scan(String(c.bg||""),false)||scan(String(c.prompt||"")+" "+String(c.fullName||""),true);
  c._tz=best||""; return best||undefined;
}
function localNow(c){
  try{
    const o={}; new Intl.DateTimeFormat("en-US",{timeZone:netTZ(c),hour:"numeric",minute:"numeric",hourCycle:"h23",weekday:"short"}).formatToParts(new Date()).forEach(x=>o[x.type]=x.value);
    return {h:+o.hour%24,m:+o.minute,day:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(o.weekday)};
  }catch(e){const d=new Date();return{h:d.getHours(),m:d.getMinutes(),day:d.getDay()};}
}
function isNightWorker(c){
  return /night|overnight|security guard|dispatcher|bartender|paramedic|nursing|nurse/i.test(offlineJob(c));
}
/* real shifts (in THEIR time zone): day workers 9-5 weekdays, night workers ~10pm-6am */
function netAge(c){const m=/(\d{4})-(\d\d)-(\d\d)/.exec(c.birthday||"");if(!m)return null;const d=new Date();let a=d.getFullYear()-(+m[1]);if(d.getMonth()+1<+m[2]||(d.getMonth()+1===+m[2]&&d.getDate()<+m[3]))a--;return a;}
function shiftInfo(c){
  const L=localNow(c), until=hh=>{let m=((hh-L.h+24)%24)*60-L.m; return m<=0?m+1440:m;};
  const age=netAge(c);
  if(age!==null&&age<18) return (L.day>0&&L.day<6&&L.h>=8&&L.h<15)?{on:true,school:true,endsInMin:until(15)}:{on:false};
  if(!offlineJob(c)) return {on:false};
  if(isNightWorker(c)) return (L.h>=22||L.h<6)?{on:true,endsInMin:until(6)}:{on:false};
  return (L.day>0&&L.day<6&&L.h>=9&&L.h<17)?{on:true,endsInMin:until(17)}:{on:false};
}
/* returns [reason, byeLine, minutes] */
function offlineReason(c){
  const L=localNow(c), h=L.h, job=offlineJob(c), sh=shiftInfo(c);
  if(sh.on&&sh.school) return ["at school","gotta go, school's starting, later",Math.max(20,Math.min(480,sh.endsInMin))];
  if(sh.on) return ["at work"+(job?" ("+job+")":""),job?"gotta head in to work, later":"gotta go to work, later everyone",Math.max(20,Math.min(480,sh.endsInMin))];
  const night=isNightWorker(c);
  if(!night&&(h>=23||h<6)) return netPick([["asleep","ok im crashing, night all"],["asleep","falling asleep at the keyboard, bye"]]).concat([random(240,420)]);
  if(night&&h>=10&&h<17) return ["sleeping (worked last night)","gotta sleep, worked all night, later"].concat([random(150,300)]);
  const age=netAge(c);
  if(age!==null&&age<18) return netPick([["homework","gotta do homework, ugh, later"],["dinner with family","dinner's ready, gotta go"],["chores","mom says i gotta do my chores, bbl"],["practice","i have practice, later"],["playing outside","going outside for a bit, bbl"]]).concat([random(OFFLINE_LEN_MIN,OFFLINE_LEN_MAX)]);
  if(Math.random()<.12) return ["sick day","feeling awful, going to bed, might be gone a while"].concat([random(600,1800)]);
  return netPick([
    ["running errands","gotta run some errands, back later"],["grocery run","heading out for groceries, brb-ish"],
    ["dinner with family","dinner's ready, gotta go"],["cooking dinner","gotta go cook, later"],
    ["picking up the kids","gotta go get the kids, later"],["appointment","have an appointment, back after"],
    ["out with friends","my friends are here, gotta go"],["walking the dog","gotta walk the dog, bbl"],
    ["gym","heading to the gym, later"],["chores","gotta do chores or i'm dead, later"]]).concat([random(OFFLINE_LEN_MIN,OFFLINE_LEN_MAX)]);
}

/* modern "connection / phone / life" kicks */
const KICKS=[
  ["wifi dropped","my wifi just died, brb"],["router restarting","router is rebooting again ugh, brb"],
  ["DSL outage","DSL went out, hang on"],["phone died","phone's at 1%, gotta charge"],
  ["power flicker","power just flickered, gotta check the breaker"],["Windows update","it's forcing a restart update, ugh"],
  ["boss pinged","my boss is pinging me on slack, gotta go"],["video call","got a zoom in 2 minutes, later"],
  ["delivery at the door","doordash is here, brb"],["kid needs something","kiddo needs me, brb"]];
const BACKS=["ok back, wifi is being weird today","back. router did its thing","ugh sorry, what'd i miss","back, that took forever","ok i'm back, work stuff"];
function netPhoneKick(c){
  const minor=(netAge(c)!==null&&netAge(c)<18);
  const [reason,bye]=netPick(minor?KICKS.filter(k=>k[0]!=="kid needs something"&&k[0]!=="boss pinged"&&k[0]!=="video call"):KICKS);
  netGoOffline(c,reason,bye,random(3,10));
  c.offline.quick=true;
}

function netRefreshPeopleKeepMenu(){
  const menu=document.getElementById("presetMenu");
  const wasOpen=menu&&menu.classList.contains("open");
  netApply(); peopleList();
  const m2=document.getElementById("presetMenu");
  if(m2&&wasOpen){m2.innerHTML=presetMenuHTML();m2.classList.add("open");}
  refreshMembersMenu();
}

function netCanGoOffline(c){
  if(!c||c.ambient||c.removed||c.offline||!c.currentRoom) return false;
  const now=Date.now();
  if(currentDM===c.id) return false;                        // don't yank someone out of your open DM
  if(typingIds.has(c.id)) return false;
  if(lastSpoke[c.id]&&now-lastSpoke[c.id]<4*60*1000) return false; // finish the conversation first
  if(roomCharacters(c.currentRoom).filter(x=>!x.ambient).length<=2) return false; // keep rooms populated
  if(Object.values(netRoster).filter(x=>x.offline&&!x.removed).length>=OFFLINE_MAX_AT_ONCE) return false;
  return true;
}

function netGoOffline(c,reason,bye,mins){
  const from=c.currentRoom, now=Date.now();
  if(from===activeRoomId){
    netSay(c,bye);
    announceRoomEvent(c.name+" has gone offline ("+reason+").");
  }
  c.offline={reason,since:now,until:now+(mins||random(OFFLINE_LEN_MIN,OFFLINE_LEN_MAX))*60*1000};
  c.currentRoom=null;
  typingIds.delete(c.id);
  dmUnread.delete(c.id);
  if(currentDM===c.id){ backToRoom(); setStatus(c.name+" went offline"); }
  netRefreshPeopleKeepMenu();
  saveNet();
}

function netComeBack(c,manual){
  if(!c||!c.offline) return;
  const favs=(c.favoriteRooms||[]).filter(r=>CHAT_ROOMS.some(x=>x.id===r));
  const to=manual?activeRoomId:(favs.length?favs[0]:netPick(CHAT_ROOMS).id);
  const wasPhone=c.offline.quick, vm=c.voicemail||[];
  c.offline=null; c.voicemail=[];
  c.currentRoom=to;
  c.nextMoveAt=Date.now()+moveStayMs(c,(c.favoriteRooms||[]).includes(to));
  c.nextOfflineAt=Date.now()+random(OFFLINE_CHECK_MIN,OFFLINE_CHECK_MAX)*60*1000;
  lastSpoke[c.id]=0;
  if(to===activeRoomId){
    announceRoomEvent(c.name+" is back online.");
    setTimeout(()=>{if(c.currentRoom===activeRoomId&&!c.offline)netSay(c,wasPhone?netPick(BACKS):netPick(HELLO));},random(1200,4000));
  }
  if(vm.length){  // voicemail: they reply in the DM after getting back
    if(!dmThreads[c.id]) dmThreads[c.id]=[];
    const m={name:c.name,text:netPick(["sorry, was away. just got your message, what's up?","hey! just got back and saw your message. what'd i miss?","just got in, saw what you left me. talk to me"])};
    setTimeout(()=>{dmThreads[c.id].push(m);dmUnread.add(c.id);refreshTypingClasses();peopleList();persistState();},random(4000,9000));
  }
  netRefreshPeopleKeepMenu();
  saveNet();
}

function netOfflineTick(){
  const now=Date.now();
  Object.values(netRoster).forEach(c=>{
    if(c.removed) return;
    // auto-return (also covers ambient users the Admin timed out)
    if(c.offline){ if(!c.offline.until||now>=c.offline.until) netComeBack(c,false); return; }
    if(c.ambient||c.neverOffline||!OFFLINE_ENABLED) return;
    // schedule the first check (so the holding area starts empty)
    if(!c.nextOfflineAt){ c.nextOfflineAt=now+random(OFFLINE_FIRST_MIN,OFFLINE_FIRST_MAX)*60*1000; return; }
    if(now<c.nextOfflineAt) return;
    c.nextOfflineAt=now+random(OFFLINE_CHECK_MIN,OFFLINE_CHECK_MAX)*60*1000;
    if(Math.random()<OFFLINE_CHANCE&&netCanGoOffline(c)){
      if(Math.random()<.15) netPhoneKick(c);
      else{const [reason,bye,mins]=offlineReason(c);netGoOffline(c,reason,bye,mins);}
    }
  });
}

/* manual re-add from the offline holding area */
const _offRS=restoreCharacter;
restoreCharacter=function(id){
  const r=netRoster[id];
  if(r&&r.offline){ netComeBack(r,true); closePresetMenu(); setStatus(r.name+" is back online"); persistState(); return; }
  _offRS(id);
};

function bringEveryoneBack(){
  Object.values(netRoster).filter(c=>c.offline&&!c.removed).forEach(c=>netComeBack(c,false));
  closePresetMenu();
}
/* buddy-list door sounds (cheap WebAudio, fails quietly) */
let DOOR_SOUNDS=(localStorage.getItem("doorSounds")!=="off");
function toggleDoorSounds(){DOOR_SOUNDS=!DOOR_SOUNDS;localStorage.setItem("doorSounds",DOOR_SOUNDS?"on":"off");setStatus("Door sounds "+(DOOR_SOUNDS?"on":"off"));}
let _ac=null;
function doorSound(open){
  if(!DOOR_SOUNDS) return;
  try{
    _ac=_ac||new (window.AudioContext||window.webkitAudioContext)();
    const t=_ac.currentTime, o=_ac.createOscillator(), g=_ac.createGain();
    o.type="triangle"; o.frequency.setValueAtTime(open?330:220,t); o.frequency.exponentialRampToValueAtTime(open?520:110,t+.22);
    g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.08,t+.03); g.gain.exponentialRampToValueAtTime(.0001,t+.28);
    o.connect(g); g.connect(_ac.destination); o.start(t); o.stop(t+.3);
  }catch(e){}
}
const _offAnn=announceRoomEvent;
announceRoomEvent=function(text){
  if(/has entered the room|is back online/.test(text)) doorSound(true);
  else if(/has left the room|has gone offline|timed out/.test(text)) doorSound(false);
  return _offAnn(text);
};

/* characters know who is offline */
const _offCtx=netContext;
netContext=function(){
  const off=Object.values(netRoster).filter(c=>c.offline&&!c.removed&&!c.ambient);
  if(!off.length) return _offCtx();
  return _offCtx()+"\nOFFLINE RIGHT NOW (not in any room; you may mention where they are if asked): "+off.slice(0,15).map(c=>c.name+" - "+c.offline.reason+", back around "+new Date(c.offline.until).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})).join("; ")+".";
};

/* DMs to someone who is offline: tell the user why nothing opens */
const _offOpenDM=openDM;
openDM=function(id){
  const r=netRoster[id];
  if(r&&r.offline){
    setStatus(r.name+" is offline ("+r.offline.reason+") — can't DM right now");
    const t=window.prompt(r.name+" is offline ("+r.offline.reason+").\nLeave a voicemail? They'll answer when they're back. (Cancel to skip)");
    if(t&&t.trim()){ (r.voicemail=r.voicemail||[]).push(t.trim()); if(!dmThreads[id])dmThreads[id]=[]; dmThreads[id].push({name:getUsername(),text:"[voicemail] "+t.trim()}); saveNet(); setStatus("Voicemail left for "+r.name); }
    return;
  }
  _offOpenDM(id);
};

/* ---- new real-info rooms: who hangs out there ---- */
const REAL_ROOMS={usnews:"US news",worldnews:"world news",history:"history",kitchen:"recipe",gallery:"art",space:"space",trivia:"trivia"};
const ROOM_FAV_ADD={"tony":"usnews","kevin":"usnews","sarah":"worldnews","lisa":"worldnews","rick":"history","becky":"history","jen":"kitchen","custom-elizabeth":"kitchen","amy":"gallery","custom-ame":"gallery","mike":"space","custom-clayton":"space","dave":"trivia","custom-josh":"trivia"};
const _bf60=buildFixed60;
buildFixed60=function(){return _bf60().map(c=>{const r=ROOM_FAV_ADD[c.id];return r?{...c,favoriteRooms:[r,...(c.favoriteRooms||[]).filter(x=>x!==r)]}:c;});};
function netEnsureNewRooms(){
  Object.values(netRoster).forEach(c=>{const r=ROOM_FAV_ADD[c.id];if(r&&!(c.favoriteRooms||[]).includes(r))c.favoriteRooms=[r,...(c.favoriteRooms||[])];});
  Object.keys(REAL_ROOMS).forEach(rid=>{
    const here=Object.values(netRoster).filter(c=>c.currentRoom===rid&&!c.removed&&!c.offline&&!c.ambient);
    if(here.length>=2) return;
    Object.values(netRoster).filter(c=>!c.removed&&!c.offline&&!c.ambient&&(c.favoriteRooms||[])[0]===rid&&c.currentRoom!==rid).slice(0,2-here.length)
      .forEach(c=>{c.currentRoom=rid;c.nextMoveAt=Date.now()+moveStayMs(c,true);});
  });
}

/* boot: load saved names/rooms or build a fresh world */
(function(){
  let saved=null; try{saved=JSON.parse(localStorage.getItem(NET_KEY)||"null");}catch(e){}
  if(saved&&saved.roster&&(saved.v===6||saved.v===5||saved.v===4||saved.v===3)){
    netRoster=saved.roster;
    if(saved.v===3){
      buildAmbient20().forEach(c=>{ if(!netRoster[c.id]) netRoster[c.id]={...c}; });
      Object.values(netRoster).filter(c=>c.ambient).forEach((c,i)=>{if(!c.currentRoom)c.currentRoom=CHAT_ROOMS[i%CHAT_ROOMS.length].id;});
    }
    if(CHAT_ROOMS.some(r=>r.id===saved.activeRoomId)) activeRoomId=saved.activeRoomId;
    buildFixed60().forEach(p=>{if(!netRoster[p.id])netRoster[p.id]={...p,currentRoom:"lobby"};});
  }else{netBuild();netPlace();}

  // Always refresh the editable custom characters' DISPLAY names from
  // custom-network.js. Saved localStorage may contain an older full-name
  // display value from a previous build, but fullName remains internal AI
  // knowledge only.
  const customById=new Map(CUSTOM_NETWORK_CHARACTERS.map(c=>[c.id,c]));
  Object.values(netRoster).forEach(c=>{
    const def=customById.get(c.id);
    if(def){
      c.name=def.name;
      c.fullName=def.fullName||def.name;
      c.avatar=def.avatar||netAvatar(def.name);
      c.role=def.role||c.role;
      c.birthday=def.birthday||c.birthday||"";
      c.relationships=def.relationships||c.relationships||"";
      c.prompt=def.prompt||c.prompt;
      if(def.neverOffline!==undefined) c.neverOffline=def.neverOffline;
    }
  });

  // YOUR in-app edits (Character editor > Save) beat the file defaults. Reset returns to the file.
  try{const ov=JSON.parse(localStorage.getItem("characterOverrides_v1")||"{}");
    Object.keys(ov).forEach(id=>{const c=netRoster[id],o=ov[id];if(!c||!o)return;
      if(o.prompt!==undefined)c.prompt=o.prompt; if(o.role)c.role=o.role; if(o.name){c.name=o.name;c.avatar=String(o.name).charAt(0).toUpperCase();}});
  }catch(e){}
  // Upgrade older saved networks without disturbing their rooms or identities.
  const moveNow=Date.now();
  Object.values(netRoster).forEach(c=>{
    if(c.currentRoom&&!c.nextMoveAt) c.nextMoveAt=moveNow+moveStayMs(c,(c.favoriteRooms||[]).includes(c.currentRoom));
  });
  netEnsureNewRooms();
  CHAT_ROOMS.forEach(r=>roomWorld[r.id]={messages:[],event:netPick(ROOM_EVENTS),eventAt:Date.now()});
})();
switchChatRoom(activeRoomId,true);
setTimeout(worldTick,9000);
setTimeout(chatterLoop,5000);
setInterval(adminWatchRoom,3500);


/* ==========================================================
   LIVE WORLD: weather, news headlines, images & memes
   All free, no keys. Every source fails quietly.
========================================================== */
const LIVE_KEY="theLobbyLive_v1";
let LIVE={weather:true,images:true,news:true,place:"",lat:null,lon:null};
try{Object.assign(LIVE,JSON.parse(localStorage.getItem(LIVE_KEY)||"{}"));}catch(e){}
const liveSave=()=>{try{localStorage.setItem(LIVE_KEY,JSON.stringify(LIVE));}catch(e){}};
const liveStatus=t=>{const e=document.getElementById("liveStatus");if(e)e.textContent=t;};
async function liveJSON(u){const r=await fetch(u);if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}


/* ---------- current date/time + internet research ---------- */
let WEB_CONTEXT="";
let WEB_CONTEXT_AT=0;
function currentWorldTime(){
  const d=new Date();
  return d.toLocaleString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",timeZoneName:"short"});
}
function shouldResearch(text){
  const t=String(text||"").toLowerCase();
  return /\b(today|tonight|yesterday|tomorrow|latest|current|recent|news|what happened|update|updates|this week|right now|202[4-9]|trump|president|election|price|score|weather|new release|newly|just announced)\b/.test(t) || /\?$/.test(t)&&t.length>25;
}
async function internetSearch(query){
  const q=String(query||"").trim();
  if(!q) return "";
  try{
    const [dd,wiki]=await Promise.all([
      liveJSON("https://api.duckduckgo.com/?q="+encodeURIComponent(q)+"&format=json&no_html=1&skip_disambig=1"),
      liveJSON("https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch="+encodeURIComponent(q)+"&srlimit=5&format=json&origin=*")
    ]);
    const lines=[];
    if(dd.AbstractText) lines.push("DuckDuckGo: "+dd.AbstractText.slice(0,700)+(dd.AbstractURL?" ["+dd.AbstractURL+"]":""));
    for(const x of (wiki.query?.search||[]).slice(0,5)) lines.push("Wikipedia result: "+x.title+" [https://en.wikipedia.org/wiki/"+encodeURIComponent(x.title.replace(/ /g,"_"))+" ]");
    return lines.join("\n");
  }catch(e){ return ""; }
}
async function refreshWebContext(query){
  if(!shouldResearch(query)) { WEB_CONTEXT=""; return; }
  try{
    const result=await internetSearch(query);
    WEB_CONTEXT=result?`\n\nLIVE INTERNET CHECK FOR THIS QUESTION (retrieved now):\n${result}`:"";
    WEB_CONTEXT_AT=Date.now();
  }catch(e){WEB_CONTEXT="";}
}

/* ---------- weather (Open-Meteo) ---------- */
let liveWx=null;
const wxWords=c=>c===0?"clear and sunny":c<=3?"partly cloudy":c<=48?"foggy":c<=57?"drizzly":c<=67?"rainy":c<=77?"snowy":c<=82?"showery":c<=86?"snowing":"stormy";
async function refreshWeather(){
  if(!LIVE.weather||LIVE.lat==null){liveWx=null;return;}
  try{
    const d=await liveJSON(`https://api.open-meteo.com/v1/forecast?latitude=${LIVE.lat}&longitude=${LIVE.lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`);
    liveWx={t:Math.round(d.current.temperature_2m),w:wxWords(d.current.weather_code)};
    liveStatus(`Weather for ${LIVE.place||"your area"}: ${liveWx.t}°F, ${liveWx.w}`);
  }catch(e){liveWx=null;liveStatus("Weather unavailable right now");}
}
async function liveLookupPlace(){
  const q=document.getElementById("livePlace").value.trim(); if(!q) return;
  try{
    const d=await liveJSON("https://geocoding-api.open-meteo.com/v1/search?count=1&name="+encodeURIComponent(q));
    const g=d.results&&d.results[0]; if(!g){liveStatus("Couldn't find that city");return;}
    LIVE.place=g.name+(g.admin1?", "+g.admin1:""); LIVE.lat=g.latitude; LIVE.lon=g.longitude;
    document.getElementById("livePlace").value=LIVE.place; liveSave(); refreshWeather();
  }catch(e){liveStatus("City lookup failed");}
}
function liveUseMyLocation(){
  if(!navigator.geolocation){liveStatus("Location not available here");return;}
  navigator.geolocation.getCurrentPosition(p=>{
    LIVE.lat=p.coords.latitude;LIVE.lon=p.coords.longitude;LIVE.place="";
    document.getElementById("livePlace").value="";liveSave();refreshWeather();
  },()=>liveStatus("Location blocked. Type a city instead."));
}
function liveToggle(){
  LIVE.weather=document.getElementById("liveWeather").checked;
  LIVE.images=document.getElementById("liveImages").checked;
  LIVE.news=document.getElementById("liveNews").checked;
  liveSave(); refreshWeather(); if(LIVE.news) getNews(activeRoomId);
}

/* ---------- news headlines (titles only) ---------- */
const BBC="https://feeds.bbci.co.uk/news/";
const NEWS_FEEDS={world:BBC+"rss.xml",sport:BBC+"sport/rss.xml",tech:BBC+"technology/rss.xml",sci:BBC+"science_and_environment/rss.xml",ent:BBC+"entertainment_and_arts/rss.xml"};
const ROOM_NEWS={lobby:"world",nineties:"world",offtopic:"world",late:"world",friends:"world",cars:"world",sports:"sport",gaming:"tech",retro:"tech",tech:"hn",programming:"hn",science:"sci",scifi:"sci",movies:"ent",tv:"ent",music:"ent",anime:"ent",books:"ent",creative:"ent",horror:"ent"};
const newsCache={};
async function getNews(rid){
  const k=ROOM_NEWS[rid]||"world", c=newsCache[k];
  if(c&&Date.now()-c.at<20*60000) return c.items;
  let items=[];
  try{
    if(k==="hn"){
      const ids=(await liveJSON("https://hacker-news.firebaseio.com/v0/topstories.json")).slice(0,8);
      items=(await Promise.all(ids.map(i=>liveJSON(`https://hacker-news.firebaseio.com/v0/item/${i}.json`).catch(()=>null)))).filter(x=>x&&x.title).map(x=>x.title);
    }else{
      const d=await liveJSON("https://api.rss2json.com/v1/api.json?rss_url="+encodeURIComponent(NEWS_FEEDS[k]));
      items=(d.items||[]).slice(0,8).map(x=>x.title);
    }
  }catch(e){}
  if(items.length) newsCache[k]={at:Date.now(),items};
  return items.length?items:(c?c.items:[]);
}

/* ---------- images & memes ---------- */
const ROOM_SUBS={gaming:["gaming"],retro:["gaming"],programming:["ProgrammerHumor"],tech:["ProgrammerHumor"]};
const ROOM_PICS={lobby:"landscape",nineties:"1990s computer",offtopic:"funny animal",friends:"picnic",cars:"classic car",music:"concert stage",sports:"stadium",horror:"abandoned house",science:"nebula",scifi:"spaceship",books:"old library",creative:"oil painting",late:"city at night",movies:"movie theater",tv:"television set",tech:"vintage computer",programming:"vintage computer",retro:"arcade cabinet",gaming:"video game console",anime:"Japan street"};
const BAD_TITLE=/\b(fuck|shit|nsfw|nazi|rape|porn|sex|nude|slur|kill)\w*/i;
const imgOK=u=>new Promise(r=>{const i=new Image();i.onload=()=>r(true);i.onerror=()=>r(false);i.src=u;setTimeout(()=>r(false),8000);});
async function fetchPhoto(q){
  const d=await liveJSON("https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=12&gsroffset="+random(0,30)+"&prop=imageinfo&iiprop=url&iiurlwidth=480&format=json&origin=*&gsrsearch="+encodeURIComponent(q+" filetype:bitmap"));
  const list=Object.values(d.query?.pages||{}).map(p=>({ii:p.imageinfo&&p.imageinfo[0],title:p.title||""}))
    .filter(x=>x.ii&&x.ii.thumburl&&/\.(jpe?g|png)$/i.test(x.ii.thumburl)&&!BAD_TITLE.test(x.title));
  if(!list.length) return null;
  const x=netPick(list); return {url:x.ii.thumburl,name:x.title.replace(/^File:|\.\w+$/g,""),sourceUrl:x.ii.descriptionurl||x.ii.url};
}
async function fetchMeme(rid,topic){
  if(topic){
    try{
      const ms=(await liveJSON("https://api.imgflip.com/get_memes")).data.memes, w=topic.toLowerCase().split(/\s+/);
      const hit=ms.filter(m=>w.some(x=>x.length>3&&m.name.toLowerCase().includes(x)));
      const m=netPick(hit.length?hit:ms.slice(0,60)); return {url:m.url,name:m.name};
    }catch(e){}
  }
  for(const s of [netPick(ROOM_SUBS[rid]||["memes","wholesomememes"]),"wholesomememes"]){
    try{
      const d=await liveJSON("https://meme-api.com/gimme/"+s);
      if(d.url&&!d.nsfw&&!d.spoiler&&!BAD_TITLE.test(d.title||"")&&/\.(jpe?g|png|gif|webp)$/i.test(d.url)) return {url:d.url,name:d.title};
    }catch(e){}
  }
  return null;
}
async function netPostImage(c,img,caption){
  if(!img||!(await imgOK(img.url))) return false;
  if(!PEOPLE.some(p=>p.id===c.id)) return false;
  const m={name:c.name,text:caption||"",attachment:{kind:"image",name:img.name||"image",dataUrl:img.url,sourceUrl:img.sourceUrl||img.url}};
  roomMessages.push(m);
  if(isViewActive("room")) addBubble(c.name,m.text,{attachment:m.attachment,msgRef:m});
  return true;
}

/* characters can ask for a picture with [img: topic] or [meme: topic] */
const _lvAP=askPerson;
askPerson=async function(person,replyTo,explicitMention){
  let reply=await _lvAP(person,replyTo,explicitMention);
  const m=(reply||"").match(/\[(img|meme):\s*([^\]]{2,60})\]/i);
  if(!m) return reply;
  reply=reply.replace(/\s*\[(img|meme):[^\]]*\]/gi,"").trim();
  if(LIVE.images){
    const ep=roomEpoch, rid=activeRoomId;
    setTimeout(async()=>{
      if(ep!==roomEpoch) return;
      try{await netPostImage(person,m[1].toLowerCase()==="meme"?await fetchMeme(rid,m[2]):await fetchPhoto(m[2]),"");}catch(e){}
    },1800);
  }
  return reply;
};

/* what the AI knows about the outside world */
function liveContext(){
  let s="";
  if(LIVE.weather&&liveWx) s+=`\nWEATHER (where the user is${LIVE.place?", "+LIVE.place:""}): ${liveWx.t}°F and ${liveWx.w}. Mention it only if it fits naturally.`;
  const n=LIVE.news&&newsCache[ROOM_NEWS[activeRoomId]||"world"];
  if(n) s+=`\nHEADLINES IN THE NEWS TODAY (bring one up only if it fits, and never invent details beyond the headline):\n- ${n.items.slice(0,5).join("\n- ")}`;
  if(LIVE.images) s+=`\nPICTURES: very rarely, when a picture would truly add to your message, end it with [img: 2-4 word photo search] or [meme: topic]. Most messages should not have one.`;
  return s?"\n"+s:"";
}
const _lvBM=buildMessages;
buildMessages=function(...a){const out=_lvBM(...a);out[0].content+=liveContext();return out;};
const _lvBL=buildAdminMessages;
buildAdminMessages=function(...a){const out=_lvBL(...a);out[0].content+=liveContext();return out;};
const _lvSW=switchChatRoom;
switchChatRoom=function(id,first){_lvSW(id,first);if(LIVE.news)getNews(activeRoomId);};

/* every couple of minutes someone in the room shares something */
async function liveTick(force){
  try{
    if(force||(autonomousEnabled&&!currentDM)){
      const named=PEOPLE.filter(p=>!p.ambient);
      const opts=[];
      if(LIVE.images) opts.push("photo","meme","meme");
      if(LIVE.news) opts.push("news","news");
      if(LIVE.weather&&liveWx) opts.push("wx");
      if(named.length&&opts.length){
        const c=netPick(named), k=netPick(opts), ep=roomEpoch, rid=activeRoomId;
        if(k==="news"){
          const n=await getNews(rid);
          if(ep===roomEpoch&&n.length) netSay(c,netPick(["did you guys see this? ","saw this headline earlier: ","huh, this is in the news: "])+netPick(n));
        }else if(k==="wx"){
          netSay(c,netPick([`it's ${liveWx.t}°F and ${liveWx.w} out today`,`anyone else dealing with ${liveWx.w} weather?`,`${liveWx.w} and ${liveWx.t} out, i'm staying in lol`]));
        }else{
          const img=k==="photo"?await fetchPhoto(ROOM_PICS[rid]||"landscape"):await fetchMeme(rid);
          if(ep===roomEpoch) await netPostImage(c,img,netPick(["lol found this","this made me laugh","look at this","ok this is great","this is so random"]));
        }
      }
    }
  }catch(e){console.warn("live tick",e);}
  if(!force) setTimeout(liveTick,random(90000,200000));
}

/* boot */
document.getElementById("livePlace").value=LIVE.place||"";
document.getElementById("liveWeather").checked=LIVE.weather;
document.getElementById("liveImages").checked=LIVE.images;
document.getElementById("liveNews").checked=LIVE.news;
refreshWeather(); setInterval(refreshWeather,30*60000);
if(LIVE.news) getNews(activeRoomId);
setTimeout(liveTick,30000);


/* ==========================================================
   BACKGROUNDS + ANSWERING THE USER
   Every character gets a fixed life story, and questions
   from the user always get real answers.
========================================================== */
const DEF_BG={
 mike:"36, from Toledo, Ohio. Works as an HVAC technician. Married to his high-school sweetheart, no kids. Has a lazy basset hound named Gus. Into fishing, classic rock and grilling. Chat style: easygoing, dry humor.",
 sarah:"31, lives in Seattle, Washington. Works as a QA engineer at a software company. Single, lives alone with a cat named Pixel. Into sci-fi movies, board games and trivia nights. Chat style: curious, asks good follow-up questions.",
 dave:"39, from Scranton, Pennsylvania. Works in sales at an office supply company. Divorced, has a 9-year-old daughter he sees every weekend. Into stand-up comedy, bowling and bad puns. Chat style: deadpan and sarcastic.",
 jen:"Lives in Portland, Oregon. Works at a game store. Single and dating around. Has a pet ferret named Zelda. Grew up with two older brothers who got her into games. Chat style: playful, flirty, opinionated about games.",
 tony:"44, from Brooklyn, New York. Works as an insurance fraud investigator, which is why he doubts everything. Married with a teenage son, no pets. Into debating, crime documentaries and Yankees games. Chat style: blunt but fair.",
 lisa:"33, lives in Nashville, Tennessee. Works as a hair stylist, so she hears everyone's stories. In a long relationship with a touring musician. Has a golden retriever named Willie. Into concerts, karaoke and romantic comedies. Chat style: warm and chatty.",
 rick:"Lives in Austin, Texas. Works as a senior developer at a web hosting company. Divorced, no kids, keeps an old Amiga in the garage. Into retro computers, BBQ and IRC war stories. Chat style: nostalgic, a little nerdy.",
 amy:"Lives in Asheville, North Carolina. Works as a freelance illustrator and part-time barista. Single, just out of a breakup. Has a gray cat named Pickle. Into sketching, thrift stores and indie music. Chat style: imaginative and playful.",
 kevin:"35, from rural Indiana. Works as a network administrator at a hospital. Married with two young kids. His brother races dirt track late models and he helps in the pits on weekends. Has a German shepherd named Tux. Chat style: practical, explains things simply.",
 becky:"Lives in Salem, Massachusetts. Works as a ghost-tour guide and part-time bookstore clerk. Single by choice and happy about it, no kids. Has a black cat named Poe. Into ghost stories, sci-fi and philosophy. Chat style: energetic and blunt."
};
const SEED_JOB={Jordan:"record store clerk",Skater_Chris:"college sophomore studying communications",NightOwl77:"overnight security guard",Pat:"school bus driver",SolderFace:"electronics repair tech",Casey:"insurance claims adjuster",CinemaMorgan:"video store manager",Taylor:"middle school gym teacher",PixelJamie:"graphic designer",Drew_R:"tire shop manager",BookwormRobin:"librarian",CamWebSurfer:"web developer at a small agency",Erin:"HR coordinator",QuarterKing:"arcade technician",PunnyBoy88:"salesman who dreams of stand-up",AstroMorg:"planetarium assistant",Jesse:"warehouse worker",Riley_G:"music teacher",GhoulGirl13:"nursing assistant",Avery:"software developer",RefIsBlind:"accountant and youth league referee",Win95Shawn:"IT administrator",Kelly:"real estate agent",InkMia:"newspaper copy editor",Trevor_H:"game store manager",SitcomNicole:"medical office receptionist",WrenchRyan:"auto mechanic",Jess_Shutter:"wedding photographer",Devon:"lab technician",OldFrank:"retired phone company engineer",Tina:"event planner",quiet_mark:"night-shift pharmacist"};
const BG_CITY=["Dayton, Ohio","Tulsa, Oklahoma","Portland, Oregon","Louisville, Kentucky","Boise, Idaho","Tampa, Florida","Albany, New York","Omaha, Nebraska","Charlotte, North Carolina","Phoenix, Arizona","Spokane, Washington","Knoxville, Tennessee","Milwaukee, Wisconsin","Fresno, California","Baton Rouge, Louisiana","Pittsburgh, Pennsylvania","Des Moines, Iowa","Albuquerque, New Mexico","Richmond, Virginia","Little Rock, Arkansas","Salt Lake City, Utah","Cleveland, Ohio","Austin, Texas","Detroit, Michigan","Birmingham, Alabama","Anchorage, Alaska","Burlington, Vermont","Sacramento, California","Las Vegas, Nevada","Jackson, Mississippi","Wichita, Kansas","St. Louis, Missouri","Fargo, North Dakota","Charleston, South Carolina","Newark, New Jersey","Denver, Colorado","Atlanta, Georgia","Toronto, Canada","Vancouver, Canada","Manchester, England","Glasgow, Scotland","Sydney, Australia","Dublin, Ireland","Auckland, New Zealand"];
const BG_JOBS=["nurse","high school teacher","long-haul truck driver","electrician","waitress","warehouse worker","IT help desk tech","cashier","accountant","paralegal","pizza delivery driver","bartender","real estate agent","police dispatcher","hairdresser","construction worker","dental hygienist","retail manager","software tester","postal worker","farmer","stay-at-home parent","freelance writer","sales rep","cook at a diner","phone company technician","between jobs and hunting","security guard","vet assistant","bank teller","carpenter","paramedic","substitute teacher","landscaper","call center rep","pharmacy tech","welder","daycare worker","cab driver","musician who also waits tables","factory line worker","flight attendant"];
const BG_YOUNG=["college student studying biology","college student studying business","college student studying art","high school senior","part-time at a grocery store while taking classes","fast food crew member saving for a car","summer lifeguard and college student","works at a mall record store"];
const BG_HOME_Y=["lives with their parents","lives with two roommates","lives in a dorm","single and not really looking","dating someone from school","just went through a breakup"];
const BG_HOME=["lives alone and likes the quiet","lives with two roommates","married with two kids","married with no kids yet","divorced, shares custody of a teenage daughter","single dad of a 6-year-old son","lives with a long-term partner","recently engaged","single and not really looking","single and dating around","just went through a breakup","in a long-distance relationship","huge family nearby, three siblings","only child, very close to their mom","widowed with grown kids","lives with their grandmother"];
const PET_NAMES=["Max","Bella","Buddy","Luna","Charlie","Daisy","Rocky","Molly","Duke","Sadie","Tucker","Pepper","Oliver","Cleo","Bear","Ziggy","Shadow","Peanut","Zoe","Gizmo"];
const BG_INTS=["fishing","fantasy football","old horror movies","collecting baseball cards","anime","trucks and mudding","gardening","cooking","guitar","skateboarding","pinball","board games","hiking","a bowling league","thrifting","classic rock","hip hop","country music","photography","pro wrestling","comic books","true crime","building PCs","mystery novels","fixing up an old car","karaoke","dance music","crosswords","softball","baking","BBQ","road trips","model trains","astronomy","poker night","video games","RPGs","fighting games","drawing","birdwatching","couponing","deer hunting","volleyball","sitcom reruns","cult movies","yoga","rollerblading"];
const BG_STYLE=["types in all lowercase","uses lots of ... ellipses","laughs at own jokes","dry and sarcastic","friendly, lots of exclamation points","short answers","tells rambling stories","asks a lot of questions","a little shy at first","loves puns","gets excited about small things","complains about work","pretty blunt","says haha a lot","uses emoticons like :) and :P"];
const petLine=()=>{const r=Math.random(),n=()=>netPick(PET_NAMES);return r<.38?"no pets":r<.6?`a dog named ${n()}`:r<.78?`a cat named ${n()}`:r<.85?`two cats, ${n()} and ${n()}`:r<.9?`a rescue mutt named ${n()}`:r<.93?`a parrot named ${n()}`:r<.96?`a hamster named ${n()}`:r<.98?"a fish tank":`a rabbit named ${n()}`;};
function netBg(c){
  let age=random(19,52); if(c.name==="OldFrank") age=random(58,68);
  const young=age<24;
  const city=Math.random()<.65?"from and still living in "+netPick(BG_CITY):"grew up in "+netPick(BG_CITY)+", now lives in "+netPick(BG_CITY);
  const job=SEED_JOB[c.name]||netPick(young?BG_YOUNG:BG_JOBS);
  const ints=shuffle([...BG_INTS]).slice(0,3);
  return `${age} years old, ${city}. Job: ${job}. Home life: ${netPick(young?BG_HOME_Y:BG_HOME)}. Pets: ${petLine()}. Into ${ints[0]}, ${ints[1]} and ${ints[2]}. Chat style: ${netPick(BG_STYLE)}.`;
}
function eraBlock(){
  const d=new Date();
  return "\n\nTHE WORLD & THE ROOM: Today is "+d.toLocaleDateString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric"})+". You live in the real, present-day world (the year is "+d.getFullYear()+"): you have DSL/cable/fiber internet, wifi, a smartphone, texting, streaming, social media and delivery apps, and you can look things up and know what is going on in the world right now. This chat is a deliberately retro, 90s-styled chat room that people log into for fun and nostalgia (screen names, old-school vibe). Do NOT act like it is the 1990s, and never use dial-up, pager, landline or 'mom needs the phone' excuses. Your real-life reasons for stepping away are modern (work, kids, wifi dropping, phone dying, a delivery, a video call). You may joke about the retro vibe of the room.";
}
netFull=c=>{
  let p=c.prompt||netAmbPrompt(c.name);
  p=p.replace(/a 1990s-style internet chat network/g,"a retro 90s-styled internet chat network").replace(/an old-school 1990s internet chat room/g,"a retro 90s-styled internet chat room");
  if(!p.includes("THE WORLD & THE ROOM:")) p+=eraBlock();
  if(c.bg&&!p.includes(c.bg)) p+="\n\nYOUR BACKGROUND (stay consistent with these facts and mention them only when they come up naturally): "+c.bg;
  return {...c,prompt:p};
};

/* who answers the user */
function netAsk(text){
  const t=(text||"").toLowerCase().trim();
  const group=/\b(anyone|anybody|everyone|everybody|you guys|y'all|yall|you all|who here|who else|all of you|each of you|guys)\b/.test(t);
  const poll=/\b(where (are|r) (you|u|ya) from|where (do|d) (you|u|ya) live|where you from|what do (you|u|ya) do|how old are (you|u)|what'?s your (job|name|age|fav\w*)|do (you|u) have (any )?(pets|kids|a dog|a cat|siblings)|how'?s everyone|how is everyone|how are (you|u|ya)( all| guys)?|what are you (all )?(doing|up to)|what do you guys|are you (married|single))\b/.test(t)||(group&&/\?|\b(what|where|who|how|why|do|does|did|is|are|can|have|has)\b/.test(t));
  const q=poll||/\?/.test(t)||/^(who|what|where|when|why|how|which|do|does|did|is|are|can|could|would|will|has|have|should)\b/.test(t);
  return {q,poll};
}
let pendingQ=null;
pickResponders=function(text){
  const here=[...PEOPLE], named=here.filter(p=>!p.ambient);
  if(!here.length){pendingQ=null;return [];}
  const ask=netAsk(text);
  const esc2=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const addr=here.filter(p=>p.name.length>2&&new RegExp("(^|[^A-Za-z0-9_])"+esc2(p.name)+"($|[^A-Za-z0-9_])","i").test(text||""));
  let out;
  if(addr.length) out=addr.slice(0,3);
  else if(ask.poll){
    const n=Math.min(here.length,10,Math.max(3,Math.ceil(here.length*.6)));
    const first=shuffle([...named]).slice(0,Math.min(2,named.length));
    const rest=shuffle(here.filter(p=>!first.includes(p))).slice(0,n-first.length);
    out=shuffle([...first,...rest]);
  }else if(ask.q){
    const a=named.length?netPick(named):netPick(here);
    out=[a,...shuffle(here.filter(p=>p!==a)).slice(0,random(1,2))];
  }else{
    const pool=(Math.random()<.7&&named.length)?named:here;
    out=shuffle([...pool]).slice(0,Math.random()<.6?1:2);
  }
  const pq=pendingQ={text:text||"",poll:ask.poll,q:ask.q||addr.length>0,ids:new Set(out.map(p=>p.id)),names:new Set(out.map(p=>p.name)),start:roomMessages.length,at:Date.now(),ep:roomEpoch};
  netWatchAnswer(pq);
  return out;
};
/* if nobody managed to answer, someone else steps in */
function netWatchAnswer(pq){
  let tries=0;
  const iv=setInterval(()=>{
    if(pq.ep!==roomEpoch||++tries>40){clearInterval(iv);return;}
    if(speakQueue.length||queueRunning) return;
    clearInterval(iv);
    if(roomMessages.slice(pq.start).some(m=>pq.names.has(m.name))) return;
    const p=netPick(PEOPLE.filter(x=>!x.ambient&&!pq.ids.has(x.id)))||netPick(PEOPLE);
    if(p){pq.ids.add(p.id);pq.names.add(p.name);enqueueSpeak(()=>runRoomSpeakTask(p,true,true));}
  },3000);
}
const _qRR=runRoomSpeakTask;
runRoomSpeakTask=function(person,em,force,rt){
  if(pendingQ&&pendingQ.ep===roomEpoch&&pendingQ.ids.has(person.id)) force=true;
  return _qRR(person,em,force,rt);
};
const _qBM=buildMessages;
buildMessages=function(...a){
  const out=_qBM(...a), p=a[0], pq=pendingQ;
  if(pq&&p&&pq.ids.has(p.id)&&pq.ep===roomEpoch&&Date.now()-pq.at<120000){
    out[0].content+=`\n\nTHE USER (${getUsername()}) JUST SAID: "${pq.text.slice(0,300)}"\n`+(pq.q
      ?(pq.poll?"They asked the whole room and several people are answering. ":"They asked a question. ")+"Answer it directly and naturally in your own voice, using your own background (where you live, your job, family, pets, interests). Give a real, specific answer, not a deflection or a question back. Keep it to one or two casual sentences. Do not copy what others already answered; if you have something in common with someone, you can mention it."
      :"Reply to them naturally, the way a real person in the room would.");
  }
  return out;
};

/* give everyone a life story (also fills in older saved rosters) */
Object.values(netRoster).forEach(c=>{if(!c.bg&&(DEF_BG[c.id]||/^(amb|net)-/.test(c.id)))c.bg=DEF_BG[c.id]||netBg(c);});
netApply(); peopleList(); saveNet();


addManualModelOption("model", SAVED_STATE?.model);

addManualModelOption("plainModel", SAVED_STATE?.plainModel);


/* ==========================================================
   INITIALIZE
========================================================== */

peopleList();

updateActivityLabels();

initModelPickers();
initApiAutoRefresh();
(window.LobbyConnection ? window.LobbyConnection.apply(false) : Promise.resolve()).then(()=>loadModels());


/* ==========================================================
   INITIAL MESSAGE

   Whoever kicks off the room is chosen from whichever
   characters were actually picked on the login page — falls
   back to a plain greeting if no personas were chosen at all.
========================================================== */

markActivity();


/* ==========================================================
   IDLE WATCHDOG

   Autonomous chatter is probability-based and can occasionally
   go quiet for a stretch (or get delayed if the tab is
   backgrounded). This backstop guarantees someone speaks up
   if the room has been silent too long — it doesn't change
   any of the existing activity/reply/spontaneous settings.
========================================================== */

const IDLE_WATCHDOG_MS = 20000;

setInterval(
  () => {

    if(!autonomousEnabled)
      return;

    if(currentDM)
      return;

    if(speakQueue.length)
      return;

    if(
      Date.now() - lastActivityTime <
      IDLE_WATCHDOG_MS
    ){

      return;

    }

    const person =
      weightedRandomPerson([]);

    if(!person)
      return;

    markActivity();

    enqueueSpeak(
      () =>
        runRoomSpeakTask(
          person,
          false,
          true
        )
    );

  },
  5000
);


/* ==========================================================
   START AUTONOMOUS BEHAVIOR
========================================================== */

scheduleAutonomous();


/* ==========================================================
   KICKOFF — SOMEONE STARTS THE CHAT IF THE USER DOESN'T

   Guarantees a second, real (AI-generated) character jumps
   into the room a few seconds after load if the user hasn't
   typed anything yet, instead of leaving it purely up to
   chance. forceSpeak bypasses the random skip so this always
   actually posts.
========================================================== */

setTimeout(
  () => {

    if(!autonomousEnabled)
      return;

    if(currentDM)
      return;

    if(roomMessages.length > 1)
      return;

    const person =
      weightedRandomPerson(
        ["rick"]
      );

    if(!person)
      return;

    markActivity();

    enqueueSpeak(
      () =>
        runRoomSpeakTask(
          person,
          false,
          true
        )
    );

  },
  6000
);



/* ==========================================================
   REAL-INFO ROOMS: live news, history, recipes, art, space, trivia
   Free public APIs, no keys. Every source fails quietly.
   Characters get the real items (with real links) in their prompt
   and post them to the room on their own.
========================================================== */
const stripHtml=s=>String(s||"").replace(/<[^>]*>/g," ").replace(/&[a-z#0-9]+;/gi," ").replace(/\s+/g," ").trim();
async function rssItems(url){
  const d=await liveJSON("https://api.rss2json.com/v1/api.json?rss_url="+encodeURIComponent(url));
  return (d.items||[]).filter(x=>x.title&&x.link).slice(0,6).map(x=>({title:stripHtml(x.title),url:x.link,summary:stripHtml(x.description).slice(0,300),image:"",source:(d.feed&&d.feed.title)||""}));
}
const mixSettled=rs=>shuffle(rs.filter(r=>r.status==="fulfilled").flatMap(r=>r.value));
const ART_TERMS=["impressionism","landscape","portrait","still life","japanese print","sculpture","abstract","seascape","flowers","medieval","modern","cats","horses"];
const decodeEnt=s=>{const t=document.createElement("textarea");t.innerHTML=s;return t.value;};
const FEEDS={
  usnews:async()=>mixSettled(await Promise.allSettled([rssItems("https://feeds.npr.org/1001/rss.xml"),rssItems("https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml")])),
  worldnews:async()=>mixSettled(await Promise.allSettled([rssItems("https://feeds.bbci.co.uk/news/world/rss.xml"),rssItems("https://www.aljazeera.com/xml/rss/all.xml"),rssItems("https://www.theguardian.com/world/rss")])),
  history:async()=>{
    const d=new Date(),p=n=>String(n).padStart(2,"0");
    const j=await liveJSON(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${p(d.getMonth()+1)}/${p(d.getDate())}`);
    return shuffle([...(j.events||[])]).slice(0,8).map(e=>{const pg=(e.pages||[])[0]||{};
      return{title:`On this day in ${e.year}: ${stripHtml(e.text)}`,url:(pg.content_urls&&pg.content_urls.desktop&&pg.content_urls.desktop.page)||"",summary:stripHtml(pg.extract||"").slice(0,300),image:(pg.thumbnail&&pg.thumbnail.source)||"",source:"Wikipedia"};}).filter(x=>x.url);
  },
  kitchen:async()=>{
    const ms=await Promise.all([1,2,3,4].map(()=>liveJSON("https://www.themealdb.com/api/json/v1/1/random.php").then(j=>j.meals&&j.meals[0]).catch(()=>null)));
    return ms.filter(Boolean).map(m=>{const ing=[];for(let i=1;i<=20;i++){const v=m["strIngredient"+i];if(v&&v.trim())ing.push(v.trim());}
      return{title:`${m.strMeal} (${m.strArea} ${m.strCategory})`,url:m.strSource||("https://www.themealdb.com/meal/"+m.idMeal),summary:"Ingredients: "+ing.slice(0,10).join(", ")+". "+stripHtml(m.strInstructions).slice(0,200),image:m.strMealThumb||"",source:"TheMealDB"};});
  },
  gallery:async()=>{
    const j=await liveJSON("https://api.artic.edu/api/v1/artworks/search?q="+encodeURIComponent(netPick(ART_TERMS))+"&query%5Bterm%5D%5Bis_public_domain%5D=true&fields=id,title,artist_display,date_display,image_id&limit=30");
    return shuffle((j.data||[]).filter(a=>a.image_id)).slice(0,6).map(a=>({title:`${a.title} by ${stripHtml(a.artist_display).split(/\n|,/)[0]} (${a.date_display||"n.d."})`,url:"https://www.artic.edu/artworks/"+a.id,summary:"Public-domain artwork at the Art Institute of Chicago.",image:`https://www.artic.edu/iiif/2/${a.image_id}/full/600,/0/default.jpg`,source:"Art Institute of Chicago"}));
  },
  space:async()=>{
    const out=[];
    try{const a=await liveJSON("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY");if(a.title)out.push({title:"NASA picture of the day: "+a.title,url:"https://apod.nasa.gov/apod/astropix.html",summary:stripHtml(a.explanation).slice(0,300),image:a.media_type==="image"?a.url:"",source:"NASA APOD"});}catch(e){}
    try{const s=await liveJSON("https://api.spaceflightnewsapi.net/v4/articles/?limit=8");(s.results||[]).forEach(x=>out.push({title:x.title,url:x.url,summary:stripHtml(x.summary).slice(0,300),image:x.image_url||"",source:x.news_site}));}catch(e){}
    return out;
  },
  trivia:async()=>{
    const j=await liveJSON("https://opentdb.com/api.php?amount=5&type=multiple");
    return (j.results||[]).map(q=>({title:decodeEnt(q.question),answer:decodeEnt(q.correct_answer),choices:shuffle([q.correct_answer,...q.incorrect_answers]).map(decodeEnt),url:"",summary:"",image:"",source:"Open Trivia DB"}));
  }
};
const feedCache={},feedSeen={},lastFeedPost={};
async function getRoomItems(rid){
  const c=feedCache[rid];
  if(c&&Date.now()-c.at<15*60000) return c.items;
  let items=[];
  try{items=FEEDS[rid]?await FEEDS[rid]():[];}catch(e){}
  if(items.length){feedCache[rid]={at:Date.now(),items};return items;}
  return c?c.items:[];
}
async function postFeedItem(c,rid){
  const items=await getRoomItems(rid); if(!items.length) return false;
  const seen=feedSeen[rid]=feedSeen[rid]||new Set();
  const it=items.find(x=>!seen.has(x.title))||netPick(items); seen.add(it.title);
  lastFeedPost[rid]=Date.now();
  const ep=roomEpoch;
  if(rid==="trivia"&&it.answer){
    netSay(c,"trivia time: "+it.title+"  ("+it.choices.join(" / ")+")");
    setTimeout(()=>{if(ep===roomEpoch)netSay(c,"answer: "+it.answer);},80000);
    return true;
  }
  const lead={usnews:["seeing this today: ","this is in the news: "],worldnews:["worldwide headline: ","reading this now: "],history:["fun history: ","today in history, "],kitchen:["making this soon: ","recipe idea: "],gallery:["found this piece: ","look at this one: "],space:["space stuff: ","check this out: "]}[rid]||["look: "];
  const text=netPick(lead)+it.title+(it.url?" "+it.url:"");
  if(it.image&&await netPostImage(c,{url:it.image,name:it.title,sourceUrl:it.url||it.image},text)) return true;
  netSay(c,text); return true;
}
function realRoomPoster(){
  const named=PEOPLE.filter(p=>!p.ambient);
  return netPick(named.length?named:PEOPLE);
}
function realRoomTick(){
  try{
    const rid=activeRoomId;
    if(REAL_ROOMS[rid]&&autonomousEnabled&&!currentDM&&isViewActive("room")&&PEOPLE.length&&Date.now()-(lastFeedPost[rid]||0)>45000) postFeedItem(realRoomPoster(),rid);
  }catch(e){console.warn("real room tick",e);}
  setTimeout(realRoomTick,random(70000,160000));
}
setTimeout(realRoomTick,20000);

/* prefetch + first post when you walk into one of these rooms */
const _rrSW=switchChatRoom;
switchChatRoom=function(id,first){
  _rrSW(id,first);
  if(REAL_ROOMS[id]){
    const ep=roomEpoch;
    getRoomItems(id).then(()=>{
      if(ep===roomEpoch&&autonomousEnabled&&!currentDM&&PEOPLE.length&&Date.now()-(lastFeedPost[id]||0)>180000) setTimeout(()=>{if(ep===roomEpoch)postFeedItem(realRoomPoster(),id);},random(4000,9000));
    });
  }
};

/* what the AI knows in these rooms */
const _rrLC=liveContext;
liveContext=function(){
  let s=_rrLC();const rid=activeRoomId;
  if(REAL_ROOMS[rid]){
    const it=feedCache[rid]&&feedCache[rid].items;
    if(it&&it.length&&rid!=="trivia") s+=`\nREAL ${REAL_ROOMS[rid].toUpperCase()} ITEMS FROM THE WEB (fetched just now). Discuss these, and paste the exact link when you bring one up. Never invent links, facts, quotes or details beyond what is listed:\n`+it.slice(0,6).map(x=>`- ${x.title}${x.summary?" | "+x.summary:""}${x.url?" ["+x.url+"]":""}`).join("\n");
    s+="\nThis is a real-information room. Stay on topic, keep replies short and casual, and prefer real links over vague claims.";
  }
  if(rid==="gallery"||rid==="creative") s+="\nAI ART: you can generate a picture by ending a message with [art: vivid description of the artwork]. Use it when someone asks for art or you want to show something you made. Say it is AI-generated.";
  return s;
};

/* ---------- AI art (free Pollinations endpoint; falls back to real museum art) ---------- */
const ART_KEY="";  /* optional: paste a Pollinations publishable key here if the anonymous endpoint stops working */
const aiArtUrl=p=>`https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=768&height=768&nologo=true&seed=${random(1,999999)}`+(ART_KEY?`&key=${ART_KEY}`:"");
const waitImg=(u,ms)=>new Promise(r=>{const i=new Image();i.onload=()=>r(true);i.onerror=()=>r(false);i.src=u;setTimeout(()=>r(false),ms);});
async function postAIArt(c,prompt){
  const ep=roomEpoch; prompt=prompt.trim().slice(0,200);
  netSay(c,netPick(["ok let me make that, gimme a sec...","generating something, one sec","trying an AI thing, hang on"]));
  const url=aiArtUrl(prompt);
  if(await waitImg(url,60000)){
    if(ep!==roomEpoch) return;
    const m={name:c.name,text:"(AI-generated) "+prompt.slice(0,80),attachment:{kind:"image",name:"AI art: "+prompt.slice(0,50),dataUrl:url,sourceUrl:url}};
    roomMessages.push(m); if(isViewActive("room")) addBubble(c.name,m.text,{attachment:m.attachment,msgRef:m});
    phoneSave(c.id,{url,name:"AI art: "+prompt.slice(0,40),sourceUrl:url});
    return;
  }
  const it=(await getRoomItems("gallery")).find(x=>x.image);
  if(ep===roomEpoch&&it) await netPostImage(c,{url:it.image,name:it.title,sourceUrl:it.url},"the AI art thing wouldn't load, so here's real art instead: "+it.title+" "+it.url);
}

/* ---------- character phones: selfies, photos, files from you, saved images ---------- */
const DL_KEY="lobbyPhoneDownloads_v1";
const dlLoad=()=>{try{return JSON.parse(localStorage.getItem(DL_KEY)||"{}");}catch(e){return{};}};
function phoneSave(id,img){
  if(!id||!img||img.local||!img.url) return;
  const d=dlLoad(),a=d[id]=d[id]||[];
  if(a.some(x=>x.url===img.url)) return;
  a.unshift({name:String(img.name||"image").replace(/[\[\]]/g,"").slice(0,50),url:img.url,src:img.sourceUrl||img.url});
  d[id]=a.slice(0,12);
  try{localStorage.setItem(DL_KEY,JSON.stringify(d));}catch(e){}
}
function phoneInfo(id){
  const p=(window.LOBBY_PHONES||{})[id]; if(!p) return null;
  const base="characters/"+encodeURIComponent(p.folder)+"/phone/";
  return{
    selfie:p.selfie?{key:"selfie",url:base+encodeURIComponent(p.selfie)}:null,
    photos:(p.photos||[]).map(f=>({key:f,url:base+"photos/"+encodeURIComponent(f)})),
    fromYou:(p.fromYou||[]).map(f=>({key:f,url:base+"from-you/"+encodeURIComponent(f)})),
    saved:(dlLoad()[id]||[]).slice(0,8).map(x=>({key:x.name,url:x.url,src:x.src,remote:true}))
  };
}
phoneNote=function(p){
  const info=p&&p.id&&phoneInfo(p.id); if(!info) return "";
  const bits=[];
  if(info.photos.length) bits.push("photos you took: "+info.photos.map(x=>x.key).join(", "));
  if(info.fromYou.length) bits.push("pictures/files the user left for you: "+info.fromYou.map(x=>x.key).join(", "));
  if(info.saved.length) bits.push("images you saved from the web: "+info.saved.map(x=>x.key).join(" | "));
  return `\n\nYOUR PHONE: it holds ${info.selfie?"your selfie (name: selfie)":"no selfie"}${bits.length?"; "+bits.join("; "):""}. You can end a message with [phone: exact name] to send one of these, but treat this as rare, not a habit: only do it when someone directly asks to see you / asks for a pic, photo or selfie, or specifically asks about one of the saved items above. Do not attach one to an ordinary message, do not send your selfie just to "sign" what you said, and do not resend something you already shared recently unless asked again. Most of your messages should have no picture at all. Never claim to have pictures that are not listed here.`;
};
async function sharePhone(c,name){
  const info=phoneInfo(c.id); if(!info) return false;
  const n=String(name).trim().toLowerCase();
  const all=[...(info.selfie?[info.selfie]:[]),...info.photos,...info.fromYou,...info.saved];
  const it=all.find(x=>x.key.toLowerCase()===n)||all.find(x=>n&&x.key.toLowerCase().includes(n));
  if(!it) return false;
  return netPostImage(c,{url:it.url,name:it.key==="selfie"?c.name+" (selfie)":it.key,sourceUrl:it.src||it.url,local:!it.remote},"");
}
/* every picture a character posts from the internet also lands in their phone's saved images */
const _npi=netPostImage;
netPostImage=async function(c,img,cap){const ok=await _npi(c,img,cap);if(ok&&c)phoneSave(c.id,img);return ok;};

/* tags in replies: [art: ...] and [phone: ...] */
/* Whether a [phone: ...] tag actually gets acted on does NOT rely on the
   model's judgement alone: the line has to look like an actual ask for a
   picture, and even then each character is capped to one phone-share every
   few minutes. This keeps selfie-spam from happening even if a local model
   ignores the "rare" instruction in phoneNote(). */
const PHONE_ASK_RE=/\b(pic|pics|picture|pictures|photo|photos|selfie|selfies|snap|what.{0,15}(look like|you look)|show (me|us)|send (a|one|it|me)|got a (pic|photo|picture)|see (you|your face|it)|can i see|do you have (a|any) (pic|photo))\b/i;
const PHONE_COOLDOWN_MS=15*60*1000;
const lastPhoneShareAt={};
function recentTriggerText(){
  for(let i=roomMessages.length-1,n=0;i>=0&&n<4;i--,n++){
    const m=roomMessages[i]; if(m&&!m._admin&&m.text) return m.text;
  }
  return "";
}
const _tagAP=askPerson;
askPerson=async function(person,replyTo,explicitMention){
  let reply=await _tagAP(person,replyTo,explicitMention);
  if(!reply) return reply;
  const a=reply.match(/\[art:\s*([^\]]{3,200})\]/i);
  if(a){
    reply=reply.replace(/\s*\[art:[^\]]*\]/gi,"").trim();
    const ep=roomEpoch;
    setTimeout(()=>{if(ep===roomEpoch)postAIArt(person,a[1]).catch(()=>{});},1500);
  }
  const p=reply.match(/\[phone:\s*([^\]]{2,120})\]/i);
  if(p){
    reply=reply.replace(/\s*\[phone:[^\]]*\]/gi,"").trim();
    const wasAsked=PHONE_ASK_RE.test(recentTriggerText())||PHONE_ASK_RE.test(replyTo&&replyTo.text||"");
    const offCooldown=(Date.now()-(lastPhoneShareAt[person.id]||0))>PHONE_COOLDOWN_MS;
    if(wasAsked&&offCooldown){
      lastPhoneShareAt[person.id]=Date.now();
      const ep=roomEpoch;
      setTimeout(()=>{if(ep===roomEpoch)sharePhone(person,p[1]).catch(()=>{});},1500);
    }
    /* not actually asked, or shared too recently: the tag is just dropped,
       so the reply still reads fine with no picture attached */
  }
  return reply;
};


/* ==========================================================
   THE REST OF THE WORLD: settings, away messages, memory logs,
   birthdays, pins/watch, export
========================================================== */
const OFF_CFG_KEY="offlineCfg_v1";
(function(){try{const c=JSON.parse(localStorage.getItem(OFF_CFG_KEY)||"{}");
  if(c.enabled!==undefined)OFFLINE_ENABLED=c.enabled; if(c.chance!==undefined)OFFLINE_CHANCE=c.chance; if(c.max!==undefined)OFFLINE_MAX_AT_ONCE=c.max;
  if(c.lenMax!==undefined)OFFLINE_LEN_MAX=c.lenMax; if(c.tz!==undefined)TZ_ON=c.tz; }catch(e){}})();
let AWAY_CHANCE=0.4;
try{const a=JSON.parse(localStorage.getItem(OFF_CFG_KEY)||"{}").away; if(a!==undefined)AWAY_CHANCE=a;}catch(e){}
function offSaveCfg(){try{localStorage.setItem(OFF_CFG_KEY,JSON.stringify({enabled:OFFLINE_ENABLED,chance:OFFLINE_CHANCE,max:OFFLINE_MAX_AT_ONCE,lenMax:OFFLINE_LEN_MAX,tz:TZ_ON,away:AWAY_CHANCE}));}catch(e){}}

/* memory log */
function netLog(c,text){ if(!c) return; (c.log=c.log||[]).push({t:Date.now(),text}); if(c.log.length>40)c.log.shift(); }
const _lgGo=netGoOffline;
netGoOffline=function(c,reason,bye,mins){_lgGo(c,reason,bye,mins);netLog(c,"Went offline: "+reason);};
const _lgBack=netComeBack;
netComeBack=function(c,manual){
  const was=c&&c.offline; _lgBack(c,manual);
  if(was){ netLog(c,"Came back online (was: "+was.reason+")"); if(c.watch){setStatus("⭐ "+c.name+" is back online");doorSound(true);} }
};
function exportMemoryLogs(){
  const out=Object.values(netRoster).filter(c=>c.log&&c.log.length).map(c=>"=== characters/"+c.name+" - CORE/memory/log.txt ===\n"+c.log.map(e=>"["+new Date(e.t).toLocaleString()+"] "+e.text).join("\n")).join("\n\n")||"No memory events yet.";
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([out],{type:"text/plain"})); a.download="memory-logs.txt"; a.click();
}

/* birthdays */
function isBirthday(c){const m=/(\d{4})-(\d\d)-(\d\d)/.exec(c.birthday||"");if(!m)return false;const d=new Date();return +m[2]===d.getMonth()+1&&+m[3]===d.getDate();}
const _nf2=netFull;
netFull=c=>{
  const r=_nf2(c); let p=r.prompt;
  if(isBirthday(c)) p+="\n\nTODAY IS YOUR BIRTHDAY. You are in a great mood, happy to mention it if it comes up naturally, and people may wish you happy birthday.";
  const L=(c.log||[]).slice(-4);
  if(L.length) p+="\n\nRECENT EVENTS IN YOUR OWN LIFE (for continuity; mention only if natural): "+L.map(e=>e.text).join("; ")+".";
  const tz=netTZ(c); if(tz){const lt=localNow(c); p+="\n\nWhere you live it is currently "+lt.h+":"+String(lt.m).padStart(2,"0")+" ("+tz.split("/")[1].replace("_"," ")+" time).";}
  return {...r,prompt:p};
};
/* birthday people don't sign off, pins never do */
const _ncg=netCanGoOffline;
netCanGoOffline=function(c){return !isBirthday(c)&&!c.neverOffline&&_ncg(c);};

/* away messages: still in the room, but idle */
const AWAYS=["brb pizza guy","AFK - grabbing coffee","brb bathroom","brb dog needs out","AFK - laundry","brb phone","AFK - making lunch","brb someone's at the door"];
const isAway=id=>{const r=netRoster[id];return !!(r&&r.away&&Date.now()<r.away.until);};
function netAwayTick(){
  const now=Date.now(); let changed=false;
  roomCharacters(activeRoomId).filter(c=>!c.ambient).forEach(c=>{
    if(c.away){ if(now>=c.away.until){c.away=null;changed=true;netSay(c,netPick(["back","ok back","back, what'd i miss"]));} return; }
    if(!c.nextAwayAt){c.nextAwayAt=now+random(6,15)*60000;return;}
    if(now<c.nextAwayAt) return;
    c.nextAwayAt=now+random(6,15)*60000;
    if(Math.random()<AWAY_CHANCE&&currentDM!==c.id&&!typingIds.has(c.id)&&!(lastSpoke[c.id]&&now-lastSpoke[c.id]<2*60000)){
      const msg=netPick(AWAYS); c.away={msg,until:now+random(2,6)*60000}; netSay(c,msg); netLog(c,"Stepped away: "+msg); changed=true;
    }
  });
  if(changed){netApply();peopleList();}
}
const _nOT=netOfflineTick; netOfflineTick=function(){_nOT();netAwayTick();};
const _nAp=netApply;
netApply=function(){_nAp();PEOPLE=PEOPLE.map(p=>isAway(p.id)?{...p,role:"💤 "+netRoster[p.id].away.msg}:p);};
const _wrp=weightedRandomPerson;
weightedRandomPerson=function(ex){return _wrp([...(ex||[]),...PEOPLE.filter(p=>isAway(p.id)).map(p=>p.id)]);};
const _prs=pickResponders;
pickResponders=function(t){return (_prs(t)||[]).filter(p=>!isAway(p.id));};

/* pin (never offline) / watch (notify on return) */
function offToggle(kind){
  const id=document.getElementById("offPinSel").value, c=netRoster[id]; if(!c) return;
  c[kind]=!c[kind]; if(kind==="neverOffline"&&c.neverOffline&&c.offline) netComeBack(c,false);
  saveNet(); offRenderPins(); setStatus(c.name+(kind==="neverOffline"?(c.neverOffline?" pinned: never goes offline":" unpinned"):(c.watch?" watched: you'll be notified on return":" unwatched")));
}
function offRenderPins(){
  const sel=document.getElementById("offPinSel"); if(!sel) return;
  const cur=sel.value, all=Object.values(netRoster).filter(c=>!c.ambient&&!c.removed).sort((a,b)=>a.name.localeCompare(b.name));
  sel.innerHTML=all.map(c=>`<option value="${c.id}">${c.name}${c.neverOffline?" 📌":""}${c.watch?" ⭐":""}</option>`).join(""); if(cur) sel.value=cur;
}

/* settings panel (injected next to the other activity sliders) */
(function(){
  const anchor=document.getElementById("maxBurst"); if(!anchor||document.getElementById("offEnabled")) return;
  const row=anchor.closest(".activity-row")||anchor.parentElement;
  const box=document.createElement("div");
  const sl=(id,label,min,max,val,unit)=>`<div class="activity-row"><label>${label}</label><input id="${id}" type="range" min="${min}" max="${max}" value="${val}"><span id="${id}V" class="activity-value">${val}${unit}</span></div>`;
  box.innerHTML=`<div class="activity-row"><label><strong>Offline &amp; life</strong></label></div>
   <div class="activity-row"><label>Characters go offline</label><input id="offEnabled" type="checkbox"></div>`
   +sl("offChance","Offline frequency",0,100,Math.round(OFFLINE_CHANCE*100),"%")
   +sl("offMax","Max offline at once",0,20,OFFLINE_MAX_AT_ONCE,"")
   +sl("offLen","Longest break (min)",20,240,OFFLINE_LEN_MAX,"")
   +sl("offAway","Away-message chance",0,100,Math.round(AWAY_CHANCE*100),"%")
   +`<div class="activity-row"><label>Door sounds</label><input id="offDoor" type="checkbox"></div>
   <div class="activity-row"><label>Real time zones</label><input id="offTz" type="checkbox"></div>
   <div class="activity-row"><label>Character</label><select id="offPinSel"></select></div>
   <div class="activity-row"><button class="rowbtn" onclick="offToggle('neverOffline')">📌 Pin / unpin</button> <button class="rowbtn" onclick="offToggle('watch')">⭐ Watch / unwatch</button></div>
   <div class="activity-row"><button class="rowbtn" onclick="bringEveryoneBack()">↩ Bring everyone back</button> <button class="rowbtn" onclick="exportMemoryLogs()">💾 Export memory logs</button></div>`;
  row.parentNode.insertBefore(box,row.nextSibling);
  const $=id=>document.getElementById(id);
  $("offEnabled").checked=OFFLINE_ENABLED; $("offDoor").checked=DOOR_SOUNDS; $("offTz").checked=TZ_ON;
  $("offEnabled").onchange=e=>{OFFLINE_ENABLED=e.target.checked;offSaveCfg();};
  $("offDoor").onchange=e=>{DOOR_SOUNDS=e.target.checked;localStorage.setItem("doorSounds",DOOR_SOUNDS?"on":"off");};
  $("offTz").onchange=e=>{TZ_ON=e.target.checked;Object.values(netRoster).forEach(c=>delete c._tz);offSaveCfg();};
  [["offChance",v=>OFFLINE_CHANCE=v/100,"%"],["offMax",v=>OFFLINE_MAX_AT_ONCE=v,""],["offLen",v=>OFFLINE_LEN_MAX=Math.max(v,OFFLINE_LEN_MIN+1),""],["offAway",v=>AWAY_CHANCE=v/100,"%"]]
   .forEach(([id,fn,u])=>{$(id).oninput=e=>{fn(+e.target.value);$(id+"V").textContent=e.target.value+u;offSaveCfg();};});
  offRenderPins();
})();


/* ==========================================================
   CHARACTER PROMPTS: in-app edits override the files
   - The file (js/characters/<name>.js or custom-network.js) is the DEFAULT.
   - Saving in the character editor stores an override in this browser; it wins on every reload.
   - "Reset to file version" removes the override.
   - The editor shows ONLY the character's own prompt (the app's world/time/memory extras are added automatically).
========================================================== */
const OV_KEY="characterOverrides_v1";
const ovAll=()=>{try{return JSON.parse(localStorage.getItem(OV_KEY)||"{}");}catch(e){return {};}};
const ovSave=o=>{try{localStorage.setItem(OV_KEY,JSON.stringify(o));}catch(e){}};
function fileDefFor(id){
  const c=CUSTOM_NETWORK_CHARACTERS.find(x=>x.id===id); if(c) return {...c,file:"js/characters/custom-network.js"};
  const o=DEFAULT_PEOPLE.find(x=>x.id===id); if(o) return {...o,file:"js/characters/"+id+".js"};
  return null;
}
function updatePromptSourceNote(id){
  const box=document.getElementById("editPromptSource"); if(!box) return;
  if(editorMode!=="edit"||!id){box.style.display="none";return;}
  box.style.display="";
  const def=fileDefFor(id), over=!!ovAll()[id];
  document.getElementById("editPromptSourceTxt").textContent=
    over?"✏️ Using your in-app edit (overrides the file)."
        :def?("Using the default from "+def.file+". Edit and Save here to override it, no need to touch the file.")
            :"Generated character (no file). Edits are saved in this browser.";
  document.getElementById("editPromptReset").style.display=(over&&def)?"":"none";
}
(function(){
  const ta=document.getElementById("editPrompt"); if(!ta||document.getElementById("editPromptSource")) return;
  const box=document.createElement("div"); box.id="editPromptSource"; box.className="model-help"; box.style.marginTop="6px";
  box.innerHTML='<span id="editPromptSourceTxt"></span> <button type="button" class="ghostbtn" id="editPromptReset" style="margin-left:6px">↩ Reset to file version</button>';
  ta.parentNode.insertBefore(box,ta.nextSibling);
  document.getElementById("editPromptReset").onclick=()=>resetCharacterPrompt(editorPersonId);
})();
const _ocEd=openCharacterEditor;
openCharacterEditor=function(id){
  _ocEd(id);
  const r=netRoster[id];
  if(r){ document.getElementById("editPrompt").value=r.prompt||""; }   // base prompt only
  updatePromptSourceNote(id);
};
const _scEd=saveCharacter;
saveCharacter=function(){
  const mode=editorMode, id=editorPersonId, g=k=>document.getElementById(k).value.trim();
  const v={name:g("editName"),role:g("editRole"),prompt:g("editPrompt")};
  _scEd();
  if(mode==="edit"&&id&&v.name&&netRoster[id]){
    const r=netRoster[id]; r.prompt=v.prompt; r.name=v.name; r.role=v.role||r.role; r.avatar=v.name.charAt(0).toUpperCase();
    const o=ovAll(); o[id]={name:v.name,role:v.role,prompt:v.prompt}; ovSave(o);
    saveNet(); netApply(); peopleList();
  }
};
function resetCharacterPrompt(id){
  const def=fileDefFor(id); if(!id||!def) return;
  const o=ovAll(); delete o[id]; ovSave(o);
  const r=netRoster[id]; if(r){ r.prompt=def.prompt; r.name=def.name||r.name; r.role=def.role||r.role; r.avatar=def.avatar||String(r.name).charAt(0).toUpperCase(); }
  document.getElementById("editPrompt").value=def.prompt||"";
  document.getElementById("editName").value=def.name||"";
  document.getElementById("editRole").value=def.role||"";
  saveNet(); netApply(); peopleList(); updatePromptSourceNote(id);
  setStatus((def.name||id)+" reset to the file version");
}


/* ---- Settings > Look: theme picker (saved in this browser) ----
   Looks: midnight / daylight / retro / classic. The header Light/Dark button still works:
   in Midnight/Daylight it flips between the two; in Classic it is the original toggle. */
function setLook(t,fromToggle){
  document.documentElement.dataset.look=t; try{localStorage.setItem("uiLook",t);}catch(e){}
  document.querySelectorAll(".themepick button").forEach(b=>b.classList.toggle("on",b.dataset.t===t));
  if(!fromToggle){ if(t==="daylight") applyTheme("light"); else if(t==="midnight"||t==="retro") applyTheme("dark"); }
}
const _toggleTheme=toggleTheme;
toggleTheme=function(){
  _toggleTheme();
  const cur=document.documentElement.dataset.look;
  if(cur==="midnight"||cur==="daylight") setLook(currentTheme==="light"?"daylight":"midnight",true);
};
(function(){
  const first=document.querySelector(".settings-section"); if(!first||document.getElementById("themePick")) return;
  const box=document.createElement("div"); box.className="settings-section"; box.style.padding="12px 16px";
  box.innerHTML='<label style="display:block;margin-bottom:8px;font-weight:600">Look</label><div class="themepick" id="themePick">'
    +[["midnight","🌌 Midnight"],["daylight","☀️ Daylight"],["retro","🖥️ Retro 98"],["classic","🕰️ Classic"]].map(([k,n])=>`<button type="button" data-t="${k}" onclick="setLook('${k}')">${n}</button>`).join("")+'</div>';
  first.parentNode.insertBefore(box,first);
  setLook(document.documentElement.dataset.look||"midnight");
})();
