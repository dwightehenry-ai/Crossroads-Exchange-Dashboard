const keys=[["planningCenter","Planning Center"],["proPresenter","Online ProPresenter"],["atem","ATEM"],["audio","Audio"],["streamDeck","Stream Deck"],["etcIon","ETC Ion"],["live","Live box"]];
const values=["auto","online","warning","offline","unknown","live"];
async function postJson(url,body){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json();}
async function load(){
  const payload=await fetch("/api/config").then(r=>r.json());
  const c=document.getElementById("overrideControls");
  c.innerHTML=keys.map(([key,label])=>`<label class="override-row"><span>${label}</span><select data-key="${key}">${values.map(v=>`<option value="${v}" ${v===(payload.overrides[key]||"auto")?"selected":""}>${v}</option>`).join("")}</select></label>`).join("");
  c.querySelectorAll("select").forEach(s=>s.addEventListener("change",()=>postJson("/api/override",{key:s.dataset.key,value:s.value})));
  const d=await fetch("/api/dashboard").then(r=>r.json()); document.getElementById("messageInput").value=d.dashboard.message||"";
}
document.getElementById("saveMessage").addEventListener("click",async()=>{await postJson("/api/demo-message",{message:document.getElementById("messageInput").value});alert("Message saved.");});
load();
