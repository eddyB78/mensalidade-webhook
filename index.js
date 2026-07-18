const crypto = require("crypto");
const express = require("express");
const axios = require("axios");
const {initializeApp, cert, applicationDefault} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
const nodemailer = require("nodemailer");

const app = express();
app.disable("x-powered-by");
app.use(express.json({limit:"256kb"}));

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (serviceAccountRaw) {
  const serviceAccount = JSON.parse(serviceAccountRaw);
  if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  initializeApp({credential:cert(serviceAccount)});
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  initializeApp({credential:applicationDefault()});
} else if (process.env.FIRESTORE_EMULATOR_HOST && process.env.GCLOUD_PROJECT) {
  initializeApp({projectId:process.env.GCLOUD_PROJECT});
} else {
  throw new Error("Configure FIREBASE_SERVICE_ACCOUNT ou GOOGLE_APPLICATION_CREDENTIALS.");
}
const db = getFirestore();
console.log("Firebase OK");

function obrigatoria(nome) {
  const valor = String(process.env[nome] || "").trim();
  if (!valor) throw new Error("Variável obrigatória ausente: " + nome);
  return valor;
}

const EURL = obrigatoria("EVOLUTION_API_URL").replace(/\/$/, "");
const EKEY = obrigatoria("EVOLUTION_API_KEY");
const EINST = obrigatoria("EVOLUTION_INSTANCE");
const WEBHOOK_SECRET = obrigatoria("WEBHOOK_SECRET");
const GMAIL_USER = String(process.env.GMAIL_USER || "").trim();
const GMAIL_PASS = String(process.env.GMAIL_APP_PASSWORD || "").trim();

const mailer = GMAIL_USER && GMAIL_PASS ? nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_PASS }
}) : null;

// Codigos temporarios: { tenantId_usuario: { codigo, expira } }
const codigos = {};

async function send(num, txt) {
  try {
    await axios.post(EURL+"/message/sendText/"+EINST, {number:num,text:txt}, {headers:{apikey:EKEY}});
  } catch(e) { console.error("send err", e.message); }
}

function tel(t) { return String(t||"").replace(/[^0-9]/g, ""); }

function mes() {
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
}

function nomeMes(key) {
  const meses = ["Janeiro","Fevereiro","Marco","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const p = key.split("-");
  return meses[parseInt(p[1])-1] + " " + p[0];
}

function gerarCodigo() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCodigo(codigo) {
  return crypto.createHash("sha256").update(String(codigo)).digest("hex");
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

  if (cmd === "ajuda" || cmd === "menu" || cmd === "help") {
    return "\u{1F916} *Mensalidade Bot*\n_" + usuario.tenantNome + "_\n\n\u{1F4CB} *Comandos:*\n\u2022 *status [nome]* \u2014 situa\u00e7\u00e3o do aluno\n\u2022 *alunos* \u2014 listar pend\u00eancias\n\u2022 *cursos* \u2014 listar cursos\n\u2022 *pago [nome] [curso]* \u2014 marcar pago\n\u2022 *pago [nome]* \u2014 marcar todos\n\u2022 *despago [nome]* \u2014 desmarcar\n\u2022 *novo [nome] [tel]* \u2014 adicionar aluno";
  }

  if (cmd === "status" && partes.length >= 2) {
    const aluno = await getAluno(tid, partes.slice(1).join(" "));
    if (!aluno) return "\u274C Aluno *" + partes.slice(1).join(" ") + "* n\u00e3o encontrado.";
    const snap = await db.collection("tenants").doc(tid).collection("cursos").get();
    const cursos = snap.docs.map(d => ({id:d.id,...d.data()}));
    let linhas = "";
    for (const cid of aluno.cursos || []) {
      const c = cursos.find(x => x.id === cid);
      if (!c) continue;
      const gratis = (aluno.cursosGratuitos || []).includes(cid);
      if (gratis) { linhas += "  \u{1F381} " + c.nome + ": Gratuito\n"; continue; }
      if (c.tipo === "unico") {
        const pago = aluno.pagamentosCursos && aluno.pagamentosCursos[cid] && aluno.pagamentosCursos[cid]["unico"];
        linhas += "  \u{1F48E} " + c.nome + ": " + (pago ? "\u2705 Pago" : "\u26A0\uFE0F Pendente") + "\n";
      } else {
        const pago = aluno.pagamentosCursos && aluno.pagamentosCursos[cid] && aluno.pagamentosCursos[cid][m];
        const valor = aluno.valoresCursos && aluno.valoresCursos[cid] ? aluno.valoresCursos[cid] : 0;
        linhas += "  \u{1F4C5} " + c.nome + ": " + (pago ? "\u2705 Pago" : "\u26A0\uFE0F Pendente") + " (R$ " + valor + ")\n";
      }
    }
    return "\u{1F464} *" + aluno.nome + "*\n\u{1F4F1} " + (aluno.telefone || "\u2014") + " \u2022 Dia " + (aluno.diaVencimento || 10) + "\n\n*" + nomeMes(m) + ":*\n" + (linhas || "  Sem cursos");
  }

  if (cmd === "pago" && partes.length >= 2) {
    const temCurso = partes.length >= 3;
    const nomeBusca = temCurso ? partes.slice(1,-1).join(" ") : partes.slice(1).join(" ");
    const aluno = await getAluno(tid, nomeBusca);
    if (!aluno) return "\u274C Aluno *" + nomeBusca + "* n\u00e3o encontrado.";
    const updates = {};
    if (temCurso) {
      const curso = await getCurso(tid, partes[partes.length-1]);
      if (!curso) return "\u274C Curso *" + partes[partes.length-1] + "* n\u00e3o encontrado.";
      if (curso.tipo === "unico") {
        updates["pagamentosCursos."+curso.id+".unico"] = true;
        updates["pagamentosCursos."+curso.id+".unico_data"] = new Date().toISOString();
      } else {
        updates["pagamentosCursos."+curso.id+"."+m] = true;
      }
      await db.collection("tenants").doc(tid).collection("alunos").doc(aluno.id).update(updates);
      return "\u2705 *" + aluno.nome + "* \u2014 " + curso.nome + " marcado como pago!\n\u{1F4C5} " + nomeMes(m);
    } else {
      const snap = await db.collection("tenants").doc(tid).collection("cursos").get();
      const marcados = [];
      for (const cid of aluno.cursos || []) {
        const c = snap.docs.find(d => d.id === cid);
        if (!c) continue;
        const cData = c.data();
        if ((aluno.cursosGratuitos||[]).includes(cid) || cData.tipo === "unico") continue;
        updates["pagamentosCursos."+cid+"."+m] = true;
        marcados.push(cData.nome);
      }
      if (!marcados.length) return "\u26A0\uFE0F " + aluno.nome + " n\u00e3o tem cursos mensais pendentes.";
      await db.collection("tenants").doc(tid).collection("alunos").doc(aluno.id).update(updates);
      return "\u2705 *" + aluno.nome + "* \u2014 Todos pagos!\n\u{1F4C5} " + nomeMes(m) + "\n\u{1F4B0} " + marcados.join(", ");
    }
  }

  if (cmd === "despago" && partes.length >= 2) {
    const aluno = await getAluno(tid, partes.slice(1).join(" "));
    if (!aluno) return "\u274C Aluno n\u00e3o encontrado.";
    const updates = {};
    for (const cid of aluno.cursos || []) updates["pagamentosCursos."+cid+"."+m] = false;
    await db.collection("tenants").doc(tid).collection("alunos").doc(aluno.id).update(updates);
    return "\u21A9\uFE0F Pagamento desmarcado para *" + aluno.nome + "*";
  }

  if (cmd === "alunos") {
    const snap = await db.collection("tenants").doc(tid).collection("alunos").get();
    const pendentes = snap.docs.map(d => d.data())
      .filter(a => (a.cursos||[]).some(cid =>
        !(a.cursosGratuitos||[]).includes(cid) &&
        (!a.pagamentosCursos || !a.pagamentosCursos[cid] || !a.pagamentosCursos[cid][m])
      )).map(a => a.nome);
    if (!pendentes.length) return "\u{1F389} Todos em dia em " + nomeMes(m) + "!";
    return "\u26A0\uFE0F *Pendentes em " + nomeMes(m) + ":*\n\n" + pendentes.map(function(n,i){return (i+1) + ". " + n;}).join("\n") + "\n\nTotal: " + pendentes.length;
  }

  if (cmd === "cursos") {
    const snap = await db.collection("tenants").doc(tid).collection("cursos").get();
    if (snap.empty) return "\u{1F4DA} Nenhum curso cadastrado.";
    return "\u{1F4DA} *Cursos:*\n\n" + snap.docs.map(function(d){return "\u2022 " + d.data().nome + " (" + (d.data().tipo === "unico" ? "\u{1F48E} \u00DAnico" : "\u{1F4C5} Mensal") + ")";}).join("\n");
  }

  if (cmd === "novo" && partes.length >= 2) {
    if (!usuario.admin) return "\u274C Apenas administradores podem adicionar alunos.";
    const ultimo = partes[partes.length-1];
    const temTel = ultimo.match(/^\+?\d{8,}$/);
    const nome = temTel ? partes.slice(1,-1).join(" ") : partes.slice(1).join(" ");
    if (!nome) return "\u274C Use: *novo [nome] [telefone]*";
    const nomeFormatado = nome.split(" ").map(function(w){return w.charAt(0).toUpperCase()+w.slice(1);}).join(" ");
    await db.collection("tenants").doc(tid).collection("alunos").add({
      nome: nomeFormatado, telefone: temTel ? ultimo : "", email: "",
      diaVencimento: 10, dataInicio: new Date().toISOString().split("T")[0],
      pagamentos: {}, cursos: [], valoresCursos: {}, pagamentosCursos: {},
      observacoes: "", foto: "", cursosGratuitos: []
    });
    return "\u2705 *" + nomeFormatado + "* adicionado!\n\u{1F4F1} " + (temTel ? ultimo : "Sem telefone");
  }

  return "\u2753 Comando *" + cmd + "* n\u00e3o reconhecido.\n\nDigite *ajuda* para ver os comandos.";
}

// ============ RECUPERACAO DE SENHA ============

app.post("/recuperar-senha", async function(q,r) {
  try {
    const { usuario, tenantId, metodo } = q.body;
    if (!usuario || !tenantId) return r.json({ok:false, erro:"Dados incompletos"});

    const chave = tenantId + "_" + usuario;
    const existente = codigos[chave];
    if (existente && existente.proximoEnvio > Date.now()) {
      return r.status(429).json({ok:false, erro:"Aguarde um minuto antes de solicitar outro código"});
    }

    // Buscar usuario no tenant
    let userData = null;
    let userId = null;
    for (const col of ["usuarios","usuario"]) {
      try {
        const snap = await db.collection("tenants").doc(tenantId).collection(col).get();
        const found = snap.docs.find(d => d.data().usuario === usuario);
        if (found) { userData = found.data(); userId = found.id; break; }
      } catch(e) {}
    }
    if (!userData) return r.json({ok:false, erro:"Usuário não encontrado"});

    const codigo = gerarCodigo();
    codigos[chave] = {
      codigoHash: hashCodigo(codigo),
      expira: Date.now() + 10 * 60 * 1000,
      proximoEnvio: Date.now() + 60 * 1000,
      tentativas: 0
    };

    if (metodo === "whatsapp") {
      const numTel = tel(userData.telefone || "");
      if (!numTel) return r.json({ok:false, erro:"Telefone não cadastrado para este usuário"});
      await send(numTel, "\u{1F512} *Mensalidade Bot*\n\nSeu código de recuperação de senha:\n\n*" + codigo + "*\n\nVálido por 10 minutos.\nNão compartilhe com ninguém.");
      return r.json({ok:true, msg:"Código enviado via WhatsApp para " + numTel.replace(/\d(?=\d{4})/g,"*")});
    } else if (metodo === "email") {
      if (!mailer) return r.json({ok:false, erro:"Recuperação por e-mail não configurada"});
      const email = userData.email || "";
      if (!email) return r.json({ok:false, erro:"Email não cadastrado para este usuário"});
      await mailer.sendMail({
        from: '"Mensalidade Bot" <' + GMAIL_USER + ">",
        to: email,
        subject: "Código de recuperação de senha",
        html: "<div style=\"font-family:sans-serif;max-width:400px;margin:auto;padding:20px\"><h2 style=\"color:#6c3fc5\">\u{1F512} Recuperação de Senha</h2><p>Seu código de recuperação:</p><div style=\"background:#f0f0f0;padding:20px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:8px;border-radius:8px\">" + codigo + "</div><p style=\"color:#888;font-size:12px\">Válido por 10 minutos. Não compartilhe com ninguém.</p></div>"
      });
      return r.json({ok:true, msg:"Código enviado por email para " + email.replace(/(.{2})(.*)(@.*)/, "$1***$3")});
    }
    return r.json({ok:false, erro:"Método inválido"});
  } catch(e) {
    console.error("recuperar-senha err", e.message);
    return r.json({ok:false, erro:"Erro interno"});
  }
});

app.post("/verificar-codigo", async function(q,r) {
  try {
    const { usuario, tenantId, codigo, novaSenha } = q.body;
    if (!usuario || !tenantId || !codigo || !novaSenha) return r.json({ok:false, erro:"Dados incompletos"});
    if (String(novaSenha).length < 6) return r.json({ok:false, erro:"A nova senha precisa ter pelo menos 6 caracteres"});
    const chave = tenantId + "_" + usuario;
    const registro = codigos[chave];
    if (!registro) return r.json({ok:false, erro:"Código não encontrado ou expirado"});
    if (Date.now() > registro.expira) { delete codigos[chave]; return r.json({ok:false, erro:"Código expirado"}); }
    registro.tentativas += 1;
    if (registro.tentativas > 5) { delete codigos[chave]; return r.status(429).json({ok:false, erro:"Muitas tentativas. Solicite um novo código"}); }
    if (registro.codigoHash !== hashCodigo(codigo)) return r.json({ok:false, erro:"Código incorreto"});
    delete codigos[chave];

    // Atualizar a conta protegida no Firebase Authentication.
    for (const col of ["usuarios","usuario"]) {
      try {
        const snap = await db.collection("tenants").doc(tenantId).collection(col).get();
        const found = snap.docs.find(d => d.data().usuario === usuario);
        if (found) {
          const dados = found.data();
          if (!dados.authUid) return r.json({ok:false, erro:"Conta ainda não protegida pelo Firebase"});
          await getAuth().updateUser(dados.authUid, {password:String(novaSenha)});
          await db.collection("tenants").doc(tenantId).collection(col).doc(found.id).update({
            senha: FieldValue.delete(),
            senhaAtualizadaEm: new Date().toISOString()
          });
          return r.json({ok:true});
        }
      } catch(e) {}
    }
    return r.json({ok:false, erro:"Usuário não encontrado"});
  } catch(e) {
    console.error("verificar-codigo err", e.message);
    return r.json({ok:false, erro:"Erro interno"});
  }
});

// ============ FIM RECUPERACAO ============

app.get("/", function(q,r) { r.json({status:"online", service:"mensalidade-webhook"}); });
app.get("/ping", function(q,r) { r.json({pong:true}); });

app.post("/webhook", async function(q,r) {
  const segredoRecebido = String(q.get("x-webhook-secret") || q.query.secret || "");
  if (segredoRecebido !== WEBHOOK_SECRET) return r.sendStatus(401);
  r.sendStatus(200);
  try {
    const b = q.body;
    const ev = b.event || b.type;
    if (ev !== "messages.upsert" && ev !== "MESSAGES_UPSERT") return;
    const msgs = (b.data && b.data.messages) || b.messages || (b.data ? [b.data] : []);
    const msg = msgs[0];
    if (!msg) return;
    if (msg.key.fromMe) return;
    if (!msg.message) return;
    const txt = (msg.message.conversation) ||
                (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || "";
    if (!txt) return;
    const num = msg.key.remoteJid.replace("@s.whatsapp.net","");
    console.log("MSG " + num + ": " + txt);
    const usuario = await getUser(num);
    if (!usuario) { await send(num, "\u274C N\u00famero n\u00e3o autorizado.\n\nPe\u00e7a ao administrador para cadastrar seu n\u00famero no sistema."); return; }
    const resp = await processarCmd(usuario, txt);
    await send(num, resp);
    console.log("OK " + usuario.nome);
  } catch(e) { console.error("ERR", e.message); }
});

process.on("uncaughtException", function(e) {
  console.error("EXC", e.message);
  process.exit(1);
});
process.on("unhandledRejection", function(e) {
  console.error("REJ", e);
  process.exit(1);
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log("Porta " + PORT); });
