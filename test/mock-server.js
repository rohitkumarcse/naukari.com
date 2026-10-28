import http from "node:http";

/**
 * Local stand-in for naukri.com used by the automated tests.
 * It mimics the pieces the script touches: login form, profile page with a
 * sidebar "Key skills" quick link (decoy), Employment card, Key skills card,
 * and the Key skills editor (chips with a "Cross" icon, input, suggestions, Save).
 */
export function createMockServer({ failFirstSave = false } = {}) {
  const state = {
    loggedInSessions: new Set(),
    skills: ["Hooks", "Ajax", "jQuery", "Redux", "React.js", "MySQL", "MongoDB", "nodejs"],
    employmentType: "Full-time",
    saves: 0,
    logins: 0,
    failFirstSave,
  };
  const catalogue = ["React.js", "Next.js", "TypeScript", "Node.js", "nodejs", "jQuery", "Redux", "MongoDB", "MySQL", "Hooks", "Ajax", "AWS"];

  const page = (skills, employmentType) => `<!doctype html><html><head><meta charset="utf-8"><title>Profile</title>
<style>
 body{font-family:sans-serif;margin:0;display:flex} .side{width:220px;padding:20px} .main{flex:1;padding:20px}
 .card{border:1px solid #ccc;margin:20px 0;padding:16px;min-height:120px} .edit{cursor:pointer;color:#06c;margin-left:8px}
 .overlay{position:fixed;inset:0;background:#0006;display:none} .overlay.open{display:block}
 .modal{background:#fff;width:520px;margin:60px auto;padding:20px}
 .chip{display:inline-block;border:1px solid #999;border-radius:12px;padding:2px 8px;margin:3px}
 .cross{cursor:pointer;margin-left:6px;font-style:normal} ul.sugg{list-style:none;padding:0;border:1px solid #ddd}
 ul.sugg li{padding:4px;cursor:pointer}
</style></head><body>
<div class="side"><h3>Quick links</h3><ul><li>Resume</li><li>Resume headline</li><li><a>Key skills</a></li><li>Employment</li></ul></div>
<div class="main">
 <div class="card"><h2>Resume headline<em class="edit">editOneTheme</em></h2><p>Full Stack Developer</p></div>
 <div class="card" id="ks-card"><span class="hd">Key skills</span><em class="edit icon-edit" id="ks-edit">editOneTheme</em>
   <div id="ks-list">${skills.map((s) => `<span class="chip-view">${s}</span>`).join("")}</div></div>
 <div class="card" id="emp-card"><span class="hd">Employment</span><em class="edit" id="emp-edit">editOneTheme</em><div>InfraMantra ${employmentType}</div></div>
</div>

<div class="overlay" id="emp-modal"><div class="modal"><h3>Employment</h3><p>Is this your current employment?</p>
  <button id="emp-cancel">Cancel</button><button>Save</button></div></div>

<div class="overlay" id="ks-modal"><div class="modal"><h3>Key skills</h3>
  <p>Add skills that best define your expertise</p>
  <div id="chips"></div>
  <input type="text" placeholder="Add skills" id="skill-input" autocomplete="off">
  <ul class="sugg" id="sugg"></ul>
  <div><button id="ks-cancel">Cancel</button><button id="ks-save">Save</button></div></div></div>
<script>
 const catalogue = ${JSON.stringify(catalogue)};
 let working = ${JSON.stringify(skills)};
 const chips = document.getElementById('chips'), input = document.getElementById('skill-input'), sugg = document.getElementById('sugg');
 function render(){ chips.innerHTML=''; working.forEach(s=>{ const c=document.createElement('div'); c.className='chip';
   const t=document.createElement('span'); t.textContent=s; const x=document.createElement('em'); x.className='cross'; x.textContent='Cross';
   x.onclick=()=>{ working=working.filter(w=>w!==s); render(); }; c.append(t,x); chips.append(c); }); }
 function add(s){ if(!working.some(w=>w.toLowerCase()===s.toLowerCase())) working.push(s); input.value=''; sugg.innerHTML=''; render(); }
 input.addEventListener('input',()=>{ sugg.innerHTML=''; const q=input.value.toLowerCase(); if(!q) return;
   catalogue.filter(c=>c.toLowerCase().includes(q)).forEach(c=>{ const li=document.createElement('li'); li.textContent=c; li.onclick=()=>add(c); sugg.append(li); }); });
 input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); /* real Naukri ignores free text unless picked */ } });
 document.getElementById('ks-edit').onclick=()=>{ working=${JSON.stringify(skills)}; render(); document.getElementById('ks-modal').classList.add('open'); };
 document.getElementById('emp-edit').onclick=()=>document.getElementById('emp-modal').classList.add('open');
 document.getElementById('emp-cancel').onclick=()=>document.getElementById('emp-modal').classList.remove('open');
 document.getElementById('ks-cancel').onclick=()=>document.getElementById('ks-modal').classList.remove('open');
 document.getElementById('ks-save').onclick=async()=>{ const r=await fetch('/api/skills',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({skills:working})});
   if(r.ok){ location.reload(); } else { alert('Save failed'); } };
</script></body></html>`;

  const loginPage = `<!doctype html><html><body><h1>Login</h1>
<input id="usernameField" placeholder="Enter Email ID"><input id="passwordField" type="password">
<button type="submit" id="go">Login</button>
<script>document.getElementById('go').onclick=async()=>{const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({u:usernameField.value,p:passwordField.value})});
if(r.ok) location.href='/mnjuser/profile'; else document.body.append('Invalid credentials');};</script></body></html>`;

  const sessionOf = (req) => /sid=([a-z0-9]+)/.exec(req.headers.cookie || "")?.[1];
  const readBody = (req) =>
    new Promise((resolve) => {
      let d = "";
      req.on("data", (c) => (d += c));
      req.on("end", () => resolve(d ? JSON.parse(d) : {}));
    });

  const server = http.createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    const sid = sessionOf(req);
    const authed = sid && state.loggedInSessions.has(sid);

    if (url === "/nlogin/login") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(loginPage);
    }
    if (url === "/api/login" && req.method === "POST") {
      const body = await readBody(req);
      if (body.u === "test@example.com" && body.p === "secret") {
        const id = Math.random().toString(36).slice(2);
        state.loggedInSessions.add(id);
        state.logins++;
        res.writeHead(200, { "set-cookie": `sid=${id}; Path=/; Max-Age=86400` });
        return res.end("ok");
      }
      res.writeHead(401);
      return res.end("no");
    }
    if (url === "/mnjuser/profile") {
      if (!authed) {
        res.writeHead(302, { location: "/nlogin/login" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(page(state.skills, state.employmentType));
    }
    if (url === "/api/skills" && req.method === "POST") {
      if (!authed) {
        res.writeHead(401);
        return res.end();
      }
      const body = await readBody(req);
      if (state.failFirstSave && state.saves === 0) {
        state.saves++;
        res.writeHead(500);
        return res.end("boom");
      }
      state.skills = body.skills;
      state.saves++;
      res.writeHead(200);
      return res.end("ok");
    }
    res.writeHead(404);
    res.end();
  });

  return {
    state,
    start: () =>
      new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`))),
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
