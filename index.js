const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || "https://evolution-api-67q3.onrender.com";
const EVOLUTION_API_KEY  = process.env.EVOLUTION_API_KEY  || "minha-chave-secreta-2026";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "mensalidade";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "mensalidade-cria-ti";
const SELF_URL = process.env.RENDER_EXTERNAL_URL || "https://mensalidade-webhook.onrender.com";

// Firebase Admin init
let db;
try {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else {
    admin.initializeApp({ projectId: FIREBASE_PROJECT_ID });
  }
  db = admin.firestore();
  console.log("✅ Firebase conectado!");
} catch (e) {
  console.error("❌ Erro Firebase:", e.message);
}

// ============================================================
// AUTO-PING — mantém o servidor acordado
// ============================================================
setInterval(async () => {
  try {
    await axios.get(SELF_URL + "/ping");
    console.log("💓 Ping webhook - acordado");
  } catch(e) {}
}, 14 * 60 * 1000);

// Ping da Evolution API para mantê-la acordada
setInterval(async () => {
  try {
    await axios.get(EVOLUTION_API_URL + "/", { headers: { apikey: EVOLUTION_API_KEY }, timeout: 10000 });
    console.log("💓 Ping Evolution API - acordada");
  } catch(e) {
    console.log("⚠️ Evolution API dormindo, acordando...");
  }
}, 13 * 60 * 1000); // a cada 13 minutos

// ============================================================
// HELPERS
// ============================================================
function normalizarTelefone(tel) {
  return String(tel || "").replace(/\D/g, "").replace(/^0+/, "");
}

async function enviarMensagem(numero, texto) {
  try {
    await axios.post(
      `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      { number: numero, text: texto },
      { headers: { apikey: EVOLUTION_API_KEY } }
    );
  } catch (e) {
    console.error("Erro ao enviar mensagem:", e.message);
  }
}

async function buscarUsuarioPorTelefone(telefone) {
  const tel = normalizarTelefone(telefone);
  const tenantsSnap = await db.collection("tenants").get();
  for (const tenantDoc of tenantsSnap.docs) {
    if (!tenantDoc.data().ativo) continue;
    for (const colName of ["usuarios", "usuario"]) {
      try {
        const usuariosSnap = await db.collection("tenants").doc(tenantDoc.id).collection(colName).get();
        for (const userDoc of usuariosSnap.docs) {
          const userData = userDoc.data();
          const userTel = normalizarTelefone(userData.telefone || "");
          if (userTel === tel) {
            return { id: userDoc.id, tenantId: tenantDoc.id, tenantNome: tenantDoc.data().nome, colecao: colName, ...userData };
          }
        }
      } catch(e) {}
    }
  }
  return null;
}

async function buscarAluno(tenantId, nomeBusca) {
  const snap = await db.collection("tenants").doc(tenantId).collection("alunos").get();
  const termo = nomeBusca.toLowerCase().trim();
  const alunos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return alunos.find(a => a.nome?.toLowerCase() === termo) ||
         alunos.find(a => a.nome?.toLowerCase().includes(termo)) || null;
}

async function buscarCurso(tenantId, nomeBusca) {
  const snap = await db.collection("tenants").doc(tenantId).collection("cursos").get();
  const termo = nomeBusca.toLowerCase().trim();
  const cursos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return cursos.find(c => c.nome?.toLowerCase() === termo) ||
         cursos.find(c => c.nome?.toLowerCase().includes(termo)) || null;
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nomeMes(key) {
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const [ano, mes] = key.split("-");
  return `${meses[parseInt(mes) - 1]} ${ano}`;
}

// ============================================================
// PROCESSADOR DE COMANDOS
// ============================================================
async function processarComando(usuario, mensagem) {
  const texto = mensagem.trim().toLowerCase();
  const partes = texto.split(/\s+/);
  const comando = partes[0];
  const tenantId = usuario.tenantId;
  const mes = mesAtual();

  if (comando === "ajuda" || comando === "help" || comando === "menu") {
    return `🤖 *Mensalidade Bot*\n_Tenant: ${usuario.tenantNome}_\n\n📋 *Comandos:*\n• *status [nome]* — situação do aluno\n• *alunos* — listar pendências\n• *cursos* — listar cursos\n• *pago [nome] [curso]* — marcar pago\n• *pago [nome]* — marcar todos\n• *despago [nome] [curso]* — desmarcar\n• *novo [nome] [telefone]* — adicionar aluno`;
  }

  if (comando === "status" && partes.length >= 2) {
    const aluno = await buscarAluno(tenantId, partes.slice(1).join(" "));
    if (!aluno) return `❌ Aluno *${partes.slice(1).join(" ")}* não encontrado.`;
    const cursosSnap = await db.collection("tenants").doc(tenantId).collection("cursos").get();
    const cursos = cursosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let linhas = "";
    for (const cid of aluno.cursos || []) {
      const c = cursos.find(x => x.id === cid);
      if (!c) continue;
      const gratis = (aluno.cursosGratuitos || []).includes(cid);
      if (gratis) { linhas += `  🎁 ${c.nome}: Gratuito\n`; continue; }
      if (c.tipo === "unico") {
        const pago = aluno.pagamentosCursos?.[cid]?.["unico"];
        linhas += `  💎 ${c.nome}: ${pago ? "✅ Pago" : "⚠️ Pendente"}\n`;
      } else {
        const pago = aluno.pagamentosCursos?.[cid]?.[mes];
        linhas += `  📅 ${c.nome}: ${pago ? "✅ Pago" : "⚠️ Pendente"} (R$ ${aluno.valoresCursos?.[cid] || 0})\n`;
      }
    }
    return `👤 *${aluno.nome}*\n📱 ${aluno.telefone || "—"} • Dia ${aluno.diaVencimento || 10}\n\n*${nomeMes(mes)}:*\n${linhas || "  Sem cursos"}`;
  }

  if (comando === "pago" && partes.length >= 2) {
    const temCurso = partes.length >= 3;
    const nomeBusca = temCurso ? partes.slice(1, -1).join(" ") : partes.slice(1).join(" ");
    const nomeCurso = temCurso ? partes[partes.length - 1] : null;
    const aluno = await buscarAluno(tenantId, nomeBusca);
    if (!aluno) return `❌ Aluno *${nomeBusca}* não encontrado.`;
    const updates = {};
    if (nomeCurso) {
      const curso = await buscarCurso(tenantId, nomeCurso);
      if (!curso) return `❌ Curso *${nomeCurso}* não encontrado.`;
      if (curso.tipo === "unico") {
        updates[`pagamentosCursos.${curso.id}.unico`] = true;
        updates[`pagamentosCursos.${curso.id}.unico_data`] = new Date().toISOString();
      } else {
        updates[`pagamentosCursos.${curso.id}.${mes}`] = true;
      }
      await db.collection("tenants").doc(tenantId).collection("alunos").doc(aluno.id).update(updates);
      return `✅ *${aluno.nome}* — ${curso.nome} marcado como pago!\n📅 ${nomeMes(mes)}`;
    } else {
      const cursosSnap = await db.collection("tenants").doc(tenantId).collection("cursos").get();
      const cursos = cursosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const marcados = [];
      for (const cid of aluno.cursos || []) {
        const c = cursos.find(x => x.id === cid);
        if (!c || (aluno.cursosGratuitos || []).includes(cid) || c.tipo === "unico") continue;
        updates[`pagamentosCursos.${cid}.${mes}`] = true;
        marcados.push(c.nome);
      }
      if (!marcados.length) return `⚠️ ${aluno.nome} não tem cursos mensais pendentes.`;
      await db.collection("tenants").doc(tenantId).collection("alunos").doc(aluno.id).update(updates);
      return `✅ *${aluno.nome}* — Todos pagos!\n📅 ${nomeMes(mes)}\n💰 ${marcados.join(", ")}`;
    }
  }

  if (comando === "despago" && partes.length >= 2) {
    const temCurso = partes.length >= 3;
    const nomeBusca = temCurso ? partes.slice(1, -1).join(" ") : partes.slice(1).join(" ");
    const aluno = await buscarAluno(tenantId, nomeBusca);
    if (!aluno) return `❌ Aluno *${nomeBusca}* não encontrado.`;
    const updates = {};
    if (temCurso) {
      const curso = await buscarCurso(tenantId, partes[partes.length - 1]);
      if (!curso) return `❌ Curso não encontrado.`;
      updates[`pagamentosCursos.${curso.id}.${mes}`] = false;
    } else {
      for (const cid of aluno.cursos || []) updates[`pagamentosCursos.${cid}.${mes}`] = false;
    }
    await db.collection("tenants").doc(tenantId).collection("alunos").doc(aluno.id).update(updates);
    return `↩️ Pagamento desmarcado para *${aluno.nome}*`;
  }

  if (comando === "alunos") {
    const snap = await db.collection("tenants").doc(tenantId).collection("alunos").get();
    const pendentes = snap.docs.map(d => d.data()).filter(a =>
      (a.cursos || []).some(cid => !(a.cursosGratuitos || []).includes(cid) && !a.pagamentosCursos?.[cid]?.[mes])
    ).map(a => a.nome);
    if (!pendentes.length) return `🎉 Todos em dia em ${nomeMes(mes)}!`;
    return `⚠️ *Pendentes em ${nomeMes(mes)}:*\n\n${pendentes.map((n,i) => `${i+1}. ${n}`).join("\n")}\n\nTotal: ${pendentes.length}`;
  }

  if (comando === "cursos") {
    const snap = await db.collection("tenants").doc(tenantId).collection("cursos").get();
    if (snap.empty) return "📚 Nenhum curso cadastrado.";
    return `📚 *Cursos:*\n\n${snap.docs.map(d => `• ${d.data().nome} (${d.data().tipo === "unico" ? "💎 Único" : "📅 Mensal"})`).join("\n")}`;
  }

  if (comando === "novo" && partes.length >= 2) {
    if (!usuario.admin) return "❌ Apenas administradores podem adicionar alunos.";
    const tel = partes[partes.length-1].match(/^\+?\d+$/) ? partes[partes.length-1] : null;
    const nome = tel ? partes.slice(1,-1).join(" ") : partes.slice(1).join(" ");
    if (!nome) return "❌ Use: *novo [nome] [telefone]*";
    await db.collection("tenants").doc(tenantId).collection("alunos").add({
      nome: nome.split(" ").map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(" "),
      telefone: tel || "", email: "", diaVencimento: 10,
      dataInicio: new Date().toISOString().split("T")[0],
      pagamentos: {}, cursos: [], valoresCursos: {}, pagamentosCursos: {}, observacoes: "", foto: "", cursosGratuitos: []
    });
    return `✅ *${nome}* adicionado!\n📱 ${tel || "Sem telefone"}\n\nAdicione ao curso no sistema.`;
  }

  return `❓ Comando *${comando}* não reconhecido.\n\nDigite *ajuda* para ver os comandos.`;
}

// ============================================================
// ROTAS
// ============================================================
app.get("/", (req, res) => res.json({ status: "✅ Online!", versao: "2.0.0" }));
app.get("/ping", (req, res) => res.json({ pong: true, time: new Date().toISOString() }));

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    const event = body.event || body.type;
    if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") return;
    const msg = body.data?.messages?.[0] || body.messages?.[0];
    if (!msg || msg.key?.fromMe || !msg.message) return;
    const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (!texto) return;
    const numero = msg.key.remoteJid?.replace("@s.whatsapp.net", "");
    if (!numero) return;
    console.log(`📩 ${numero}: ${texto}`);
    const usuario = await buscarUsuarioPorTelefone(numero);
    if (!usuario) {
      await enviarMensagem(numero, "❌ Número não autorizado.\n\nPeça ao administrador para cadastrar seu número no sistema.");
      return;
    }
    const resposta = await processarComando(usuario, texto);
    await enviarMensagem(numero, resposta);
    console.log(`✅ Respondido para ${usuario.nome}`);
  } catch (e) {
    console.error("❌ Erro:", e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook na porta ${PORT}`);
  console.log(`📡 Evolution API: ${EVOLUTION_API_URL}`);
  console.log(`💓 Auto-ping ativo a cada 14 minutos`);
});
// Este código já foi adicionado no arquivo principal
// Already included in main file - checking
