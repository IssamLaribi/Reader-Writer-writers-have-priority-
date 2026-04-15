// Semaphore class: counting semaphore
class Sem {
    constructor(v) {
        this.v = v;      // Current value
        this.q = [];     // Queue of waiting processes
    }
    wait() {
        // Acquire semaphore, wait if zero
        return new Promise((r) => {
            if (this.v > 0) this.v--, r();
            else this.q.push(r); // wait
        });
    }
    signal() {
        // Release semaphore, unblock waiter if there is one
        if (this.q.length) this.q.shift()();
        else this.v = Math.min(1, this.v + 1);
    }
}

// Semaphores for read/write control
const sRT = new Sem(1), // readTry semaphore
    sRes = new Sem(1),  // resource semaphore
    sRC = new Sem(1),   // reader count semaphore
    sWC = new Sem(1);   // writer count semaphore

let rc = 0,             // current readers in critical section
    TICK = 1000,        // base tick for timing
    nid = 1,            // next process id
    nTotal = 0,         // total processes
    nDone = 0;          // completed processes
const procs = new Map(), // active processes
    logs = [];           // log messages


// Helper functions
function sl(ms) { return new Promise((r) => setTimeout(r, ms)); } // sleep
function ts() { return new Date().toLocaleTimeString([], { hour12: false }); } // timestamp
function log(msg, c) {
    // log a message
    logs.unshift({ msg, c, t: ts() });
    if (logs.length > 40) logs.pop();
    renderLog();
}

// === Java-like semaphores ===
const mutex = new Sem(1);
const readSem = new Sem(0);
const writeSem = new Sem(0);

// === Counters (same as Java) ===
let activeReaders = 0;
let waitingReaders = 0;
let activeWriters = 0;
let waitingWriters = 0;

// === Reader ===
async function runReader(p) {
    log(`R${p.id} wants to read`, "r");
    p.ph = "wait"; render();

    await mutex.wait();

    while (activeWriters > 0 || waitingWriters > 0) {
        waitingReaders++;
        p.ph = "blocked"; render();

        mutex.signal();
        await readSem.wait();

        await mutex.wait();
        waitingReaders--;
    }

    activeReaders++;
    p.ph = "reading"; p.t0 = Date.now();
    log(`R${p.id} → reading`, "r");
    mutex.signal();
    render();

    await sl(p.dur * TICK);

    await mutex.wait();
    activeReaders--;

    log(`R${p.id} done`, "r");

    if (activeReaders === 0 && waitingWriters > 0) {
        writeSem.signal();
    }

    mutex.signal();

    p.ph = "done"; nDone++;
    procs.delete(p.id);
    render();
}

// === Writer ===
async function runWriter(p) {
    log(`W${p.id} wants to write`, "w");
    p.ph = "wait"; render();

    await mutex.wait();

    while (activeReaders > 0 || activeWriters > 0) {
        waitingWriters++;
        p.ph = "blocked"; render();

        mutex.signal();
        await writeSem.wait();

        await mutex.wait();
        waitingWriters--;
    }

    activeWriters++;
    p.ph = "writing"; p.t0 = Date.now();
    log(`W${p.id} → writing`, "w");
    mutex.signal();
    render();

    await sl(p.dur * TICK);

    await mutex.wait();
    activeWriters--;

    log(`W${p.id} done`, "w");

    if (waitingWriters > 0) {
        writeSem.signal();
    } else {
        for (let i = 0; i < waitingReaders; i++) {
            readSem.signal();
        }
    }

    mutex.signal();

    p.ph = "done"; nDone++;
    procs.delete(p.id);
    render();
}

// Add a process (reader or writer) from UI
function addP(t) {
    const dur = parseInt(document.getElementById(t === "reader" ? "r-t" : "w-t").value) || 3;
    const p = { id: nid++, type: t, dur, ph: "new", t0: 0 };
    procs.set(p.id, p);
    nTotal++;
    t === "reader" ? runReader(p) : runWriter(p);
}

// Adjust simulation speed
function spd(ms) {
    TICK = ms;
    ["b05","b1","b2","b4"].forEach((id) => document.getElementById(id).classList.remove("act"));
    document.getElementById({2000:"b05",1000:"b1",500:"b2",250:"b4"}[ms]).classList.add("act");
}

// Build process card HTML
function card(p) {
    const isR = p.type === "reader";
    const active = p.ph === "reading" || p.ph === "writing";
    const blocked = p.ph === "wait_rt";
    const waitRes = p.ph === "wait_res";
    const pct = active ? Math.min(100, Math.round(((Date.now() - p.t0)/(p.dur*TICK))*100)) : 0;
    const rem = active ? Math.max(0, p.dur - Math.round((Date.now()-p.t0)/TICK)) : 0;
    let st = "";
    if (blocked) st = isR ? "⊘ writer priority" : "waiting for readTry...";
    else if (waitRes) st = `⏳ ${rc} reader${rc!==1?"s":""} active...`;
    else if (p.ph==="entry") st="entering...";
    else if (p.ph==="reading") st=`reading · ${rem}s left`;
    else if (p.ph==="writing") st=`writing · ${rem}s left`;
    const extraCls = blocked?" rw-blocked":waitRes?" rw-wait-res":"";
    return `<div class="rw-proc ${isR?"rw-r":"rw-w"}${extraCls}">
    <div class="rw-ph"><span class="rw-pid">${isR?"R":"W"}${p.id}</span><span class="rw-pst">${st}</span></div>
    ${active?`<div class="rw-pbar"><div class="rw-pfill" style="width:${pct}%"></div></div>`:""}
  </div>`;
}

// Render all UI elements
function render() {
    document.getElementById("sv-rt").textContent = waitingReaders;
    document.getElementById("sv-res").textContent = waitingWriters;
    document.getElementById("sv-rc").textContent = activeReaders;
    document.getElementById("sem-rt").className = "rw-sem "+(sRT.v?"on":"off");
    document.getElementById("sem-res").className = "rw-sem "+(sRes.v?"on":"off");
    document.getElementById("wp").className = "rw-wp"+(sRT.v===0?" show":"");

    const all = [...procs.values()];
    const rProcs = all.filter(p=>p.type==="reader"&&p.ph!=="reading");
    const wProcs = all.filter(p=>p.type==="writer"&&p.ph!=="writing");
    const csProcs = all.filter(p=>p.ph==="reading"||p.ph==="writing");
    const writers = all.filter(p=>p.ph==="writing");
    const readers = all.filter(p=>p.ph==="reading");

    document.getElementById("pr-r").innerHTML = rProcs.length?rProcs.map(card).join(''):'<div class="rw-empty">no readers waiting</div>';
    document.getElementById("pr-cs").innerHTML = csProcs.map(card).join('');
    document.getElementById("pr-w").innerHTML = wProcs.length?wProcs.map(card).join(''):'<div class="rw-empty">no writers waiting</div>';

    document.getElementById("cn-r").textContent = rProcs.length;
    document.getElementById("cn-cs").textContent = csProcs.length;
    document.getElementById("cn-w").textContent = wProcs.length;

    const csEl = document.getElementById("cs-st");
    const csZone = document.getElementById("z-cs");
    if(!csProcs.length){
        csEl.textContent="— empty —"; csEl.className="rw-cs-state"; csZone.className="rw-zone rw-cs";
    } else if(writers.length){
        csEl.textContent="exclusive write lock"; csEl.className="rw-cs-state locked"; csZone.className="rw-zone rw-cs rw-cs-w";
    } else {
        csEl.textContent=`${readers.length} reader${readers.length>1?"s":""} — concurrent`; csEl.className="rw-cs-state"; csZone.className="rw-zone rw-cs";
    }

    document.getElementById("st-tot").textContent=nTotal;
    document.getElementById("st-dn").textContent=nDone;
    document.getElementById("st-rd").textContent=readers.length;
    document.getElementById("st-wr").textContent=writers.length;
}

// Render log panel
function renderLog(){
    document.getElementById("log").innerHTML = logs.slice(0,20).map(l=>`<div class="rw-le rw-l${l.c}">${l.t}  ${l.msg}</div>`).join('');
}

setInterval(render,100);
render();