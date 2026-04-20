const fs = require("fs");
const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || fs.readFileSync("/home/ubuntu/firebase-key.json","utf8"));
admin.initializeApp({credential:admin.credential.cert(serviceAccount)});
const db = admin.firestore();
console.log("Firebase OK");

const EURL = "http://localhost:8080";
const EKEY = "minha-chave-secreta-2026";
const EINST = "mensalidade";

async function send(num, txt) {
  try {
    await axios.post(EURL+"/message/sendText/"+EINST, {number:num,text:txt}, {headers:{apikey:EKEY}});
  } catch(e) { console.error("send err", e.message); }
}

function tel(t) { return String(t||"").replace(/\D/g,""); }

function mes() {
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
}

async function getUser(telefone) {
  const t = tel(telefone);
  const s = await db.collection("tenants").get();
  for (const d of s.docs) {
    if (!d.data().ativo) continue;
    for (const c of ["usuarios","usuario"]) {
      try {
        const u = await db.collection("tenants").doc(d.id).collection(c).get();
        const f = u.docs.find(x => tel(x.data().telefone) === t);
        if (f) return {id:f.id, tenantId:d.id, tenantNome:d.data().nome, ...f.data()};
      } catch(e) {}
    }
  }
  return null;
}

async function getAluno(tenantId, nome) {
  const snap = await db.collection("tenants").doc(tenantId).collection("alunos").get();
  const termo = nome.toLowerCase().trim();
  const alunos = snap.docs.map(d => ({id:d.id,...d.data()}));
  return alunos.find(a => a.nome && a.nome.toLowerCase() === termo) ||
         alunos.find(a => a.nome && a.nome.toLowerCase().includes(termo));
}

async function getCurso(tenantId, nome) {
  const snap = await db.collection("tenants").doc(tenantId).collection("cursos").get();
  const termo = nome.toLowerCase().trim();
  const cursos = snap.docs.map(d => ({id:d.id,...d.data()}));
  return cursos.find(c => c.nome && c.nome.toLowerCase() === termo) ||
         cursos.find(c => c.nome && c.nome.toLowerCase().includes(termo));
}

async function processarCmd(usuario, mensagem) {
  const partes = mensagem.trim().toLowerCase().split(/\s+/);
  const cmd = partes[0];
  const tid = usuario.tenantId;
  const m = mes();

  if (cmd === "ajuda" || cmd === "menu") {
    return "Comandos disponiveis:\n- status [nome]\n- alunos\n- cursos\n- pago [nome]\n- despago [nome]";
  }

  if (cmd === "status" && partes.length >= 2) {
    const aluno = await getAluno(tid, partes.slice(1).join(" "));
    if (!aluno) return "Aluno nao encontrado.";
    const snap = await db.collection("tenants").doc(tid).collection("cursos").get();
    const cursos = snap.docs.map(d => ({id:d.id,...d.data()}));
    let resp = aluno.nome + "\n\n";
    for (const cid of aluno.cursos || []) {
      const c = cursos.find(x => x.id === cid);
      if (!c) continue;
      const pago = c.tipo === "unico"
        ? aluno.pagamentosCursos && aluno.pagamentosCursos[cid] && aluno.pagamentosCursos[cid]["unico"]
        : aluno.pagamentosCursos && aluno.pagamentosCursos[cid] && aluno.pagamentosCursos[cid][m];
      resp += (pago ? "OK " : "PENDENTE ") + c.nome + "\n";
    }
    return resp;
  }

  if (cmd === "pago" && partes.length >= 2) {
    const temCurso = partes.length >= 3;
    const nomeBusca = temCurso ? partes.slice(1,-1).join(" ") : partes.slice(1).join(" ");
    const aluno = await getAluno(tid, nomeBusca);
    if (!aluno) return "Aluno nao encontrado.";
    const updates = {};
    if (temCurso) {
      const curso = await getCurso(tid, partes[partes.length-1]);
      if (!curso) return "Curso nao encontrado.";
      updates["pagamentosCursos."+curso.id+"."+(curso.tipo==="unico"?"unico":m)] = true;
    } else {
      const snap = await db.collection("tenants").doc(tid).collection("cursos").get();
      for (const cid of aluno.cursos || []) {
        const c = snap.docs.find(d => d.id === cid);
        if (!c || (aluno.cursosGratuitos||[]).includes(cid)) continue;
        updates["pagamentosCursos."+cid+"."+m] = true;
      }
    }
    if (!Object.keys(updates).length) return "Nenhum curso para marcar.";
    await db.collection("tenants").doc(tid).collection("alunos").doc(aluno.id).update(updates);
    return aluno.nome + " - Pago!";
  }

  if (cmd === "despago" && partes.length >= 2) {
    const aluno = await getAluno(tid, partes.slice(1).join(" "));
    if (!aluno) return "Aluno nao encontrado.";
    const updates = {};
    for (const cid of aluno.cursos || []) {
      updates["pagamentosCursos."+cid+"."+m] = false;
    }
    await db.collection("tenants").doc(tid).collection("alunos").doc(aluno.id).update(updates);
    return aluno.nome + " - Desmarcado!";
  }

  if (cmd === "alunos") {
    const snap = await db.collection("tenants").doc(tid).collection("alunos").get();
    const pendentes = snap.docs.map(d => d.data())
      .filter(a => (a.cursos||[]).some(cid =>
        !(a.cursosGratuitos||[]).includes(cid) &&
        (!a.pagamentosCursos || !a.pagamentosCursos[cid] || !a.pagamentosCursos[cid][m])
      )).map(a => a.nome);
    return pendentes.length ? "Pendentes:\n" + pendentes.join("\n") : "Todos em dia!";
  }

  if (cmd === "cursos") {
    const snap = await db.collection("tenants").doc(tid).collection("cursos").get();
    return snap.empty ? "Nenhum curso." : "Cursos:\n" + snap.docs.map(d => d.data().nome).join("\n");
  }

  return "Comando nao reconhecido. Digite ajuda.";
}

app.get("/", (q,r) => r.json({status:"online"}));
app.get("/ping", (q,r) => r.json({pong:true}));

app.post("/webhook", async (q,r) => {
  r.sendStatus(200);
  try {
    const b = q.body;
    const ev = b.event || b.type;
    if (ev !== "messages.upsert" && ev !== "MESSAGES_UPSERT") return;
    const msgs = (b.data && b.data.messages) || b.messages || [];
    const msg = msgs[0];
    if (!msg || msg.key.fromMe || !msg.message) return;
    const txt = (msg.message.conversation) ||
                (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || "";
    if (!txt) return;
    const num = msg.key.remoteJid.replace("@s.whatsapp.net","");
    console.log("MSG " + num + ": " + txt);
    const usuario = await getUser(num);
    if (!usuario) { await send(num, "Numero nao autorizado."); return; }
    const resp = await processarCmd(usuario, txt);
    await send(num, resp);
    console.log("OK " + usuario.nome);
  } catch(e) { console.error("ERR", e.message); }
});

process.on("uncaughtException", e => console.error("EXC", e.message));
process.on("unhandledRejection", e => console.error("REJ", e));

setInterval(() => {}, 30000);

app.listen(3000, () => console.log("Porta 3000"));
