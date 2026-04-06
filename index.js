const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// ============================================================
// CONFIGURAÇÕES — preencha com seus dados
// ============================================================
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || "https://sua-evolution-api.railway.app";
const EVOLUTION_API_KEY  = process.env.EVOLUTION_API_KEY  || "sua-chave-aqui";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "mensalidade";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "mensalidade-cria-ti";
// ============================================================

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
// HELPERS
// ============================================================

// Normaliza número de telefone
function normalizarTelefone(tel) {
  return tel.replace(/\D/g, "").replace(/^0+/, "");
}

// Envia mensagem pelo WhatsApp via Evolution API
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

// Busca usuário pelo telefone em todos os tenants
async function buscarUsuarioPorTelefone(telefone) {
  const tel = normalizarTelefone(telefone);
  const tenantsSnap = await db.collection("tenants").get();
  for (const tenantDoc of tenantsSnap.docs) {
    if (!tenantDoc.data().ativo) continue;
    const usuariosSnap = await db
      .collection("tenants").doc(tenantDoc.id)
      .collection("usuarios").get();
    for (const userDoc of usuariosSnap.docs) {
      const userData = userDoc.data();
      const userTel = normalizarTelefone(userData.telefone || "");
      if (userTel === tel) {
        return {
          id: userDoc.id,
          tenantId: tenantDoc.id,
          tenantNome: tenantDoc.data().nome,
          ...userData
        };
      }
    }
  }
  return null;
}

// Busca aluno por nome aproximado dentro do tenant
async function buscarAluno(tenantId, nomeBusca) {
  const snap = await db
    .collection("tenants").doc(tenantId)
    .collection("alunos").get();
  const termo = nomeBusca.toLowerCase().trim();
  const alunos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Exact match first, then partial
  return (
    alunos.find(a => a.nome?.toLowerCase() === termo) ||
    alunos.find(a => a.nome?.toLowerCase().includes(termo)) ||
    null
  );
}

// Busca curso por nome aproximado dentro do tenant
async function buscarCurso(tenantId, nomeBusca) {
  const snap = await db
    .collection("tenants").doc(tenantId)
    .collection("cursos").get();
  const termo = nomeBusca.toLowerCase().trim();
  const cursos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return (
    cursos.find(c => c.nome?.toLowerCase() === termo) ||
    cursos.find(c => c.nome?.toLowerCase().includes(termo)) ||
    null
  );
}

// Retorna chave do mês atual: YYYY-MM
function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nomeMes(key) {
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                 "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const [ano, mes] = key.split("-");
  return `${meses[parseInt(mes) - 1]} ${ano}`;
}

// ============================================================
// PROCESSADOR DE COMANDOS
// ============================================================
async function processarComando(usuario, mensagem, numeroRemetente) {
  const texto = mensagem.trim().toLowerCase();
  const partes = texto.split(/\s+/);
  const comando = partes[0];
  const tenantId = usuario.tenantId;

  // ── AJUDA ──────────────────────────────────────────────────
  if (comando === "ajuda" || comando === "help" || comando === "menu") {
    return `🤖 *Mensalidade Bot* — Comandos disponíveis:

📋 *Consultas:*
• *status [nome]* — ver situação do aluno
• *alunos* — listar alunos com pendências
• *cursos* — listar cursos

💰 *Pagamentos:*
• *pago [nome] [curso]* — marcar como pago
• *pago [nome]* — marcar todos os cursos
• *despago [nome] [curso]* — desmarcar pagamento

➕ *Cadastro:*
• *novo [nome] [telefone]* — adicionar aluno

ℹ️ _Tenant: ${usuario.tenantNome}_`;
  }

  // ── STATUS DO ALUNO ────────────────────────────────────────
  if (comando === "status" && partes.length >= 2) {
    const nomeBusca = partes.slice(1).join(" ");
    const aluno = await buscarAluno(tenantId, nomeBusca);
    if (!aluno) return `❌ Aluno *${nomeBusca}* não encontrado.\n\nDica: use o primeiro nome ou parte do nome.`;

    const cursosSnap = await db.collection("tenants").doc(tenantId).collection("cursos").get();
    const cursos = cursosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const mes = mesAtual();

    let statusLinhas = "";
    for (const cid of aluno.cursos || []) {
      const curso = cursos.find(c => c.id === cid);
      if (!curso) continue;
      const isGratis = (aluno.cursosGratuitos || []).includes(cid);
      if (isGratis) {
        statusLinhas += `  🎁 ${curso.nome}: Gratuito\n`;
      } else if (curso.tipo === "unico") {
        const pago = aluno.pagamentosCursos?.[cid]?.["unico"];
        statusLinhas += `  💎 ${curso.nome}: ${pago ? "✅ Pago" : "⚠️ Pendente"}\n`;
      } else {
        const pago = aluno.pagamentosCursos?.[cid]?.[mes];
        const valor = aluno.valoresCursos?.[cid] || 0;
        statusLinhas += `  📅 ${curso.nome}: ${pago ? "✅ Pago" : "⚠️ Pendente"} (R$ ${valor})\n`;
      }
    }

    if (!statusLinhas) statusLinhas = "  Sem cursos cadastrados";

    return `👤 *${aluno.nome}*
📱 ${aluno.telefone || "Sem telefone"}
📅 Vencimento: Dia ${aluno.diaVencimento || 10}

*${nomeMes(mes)}:*
${statusLinhas}`;
  }

  // ── MARCAR PAGO ────────────────────────────────────────────
  if (comando === "pago" && partes.length >= 2) {
    const nomeBusca = partes.length >= 3 ? partes.slice(1, -1).join(" ") : partes.slice(1).join(" ");
    const nomeCurso = partes.length >= 3 ? partes[partes.length - 1] : null;

    const aluno = await buscarAluno(tenantId, nomeBusca);
    if (!aluno) return `❌ Aluno *${nomeBusca}* não encontrado.`;

    const mes = mesAtual();
    const updates = {};

    if (nomeCurso) {
      // Marcar curso específico
      const curso = await buscarCurso(tenantId, nomeCurso);
      if (!curso) return `❌ Curso *${nomeCurso}* não encontrado.\n\nUse: *cursos* para ver a lista.`;
      if (!(aluno.cursos || []).includes(curso.id)) return `❌ ${aluno.nome} não está matriculado em *${curso.nome}*.`;

      if (curso.tipo === "unico") {
        updates[`pagamentosCursos.${curso.id}.unico`] = true;
        updates[`pagamentosCursos.${curso.id}.unico_data`] = new Date().toISOString();
      } else {
        updates[`pagamentosCursos.${curso.id}.${mes}`] = true;
        updates[`pagamentos.${mes}`] = true;
      }

      await db.collection("tenants").doc(tenantId).collection("alunos").doc(aluno.id).update(updates);
      return `✅ *${aluno.nome}* — ${curso.nome} marcado como pago!\n📅 ${nomeMes(mes)}`;

    } else {
      // Marcar todos os cursos mensais
      const cursosSnap = await db.collection("tenants").doc(tenantId).collection("cursos").get();
      const cursos = cursosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const cursosMarcados = [];

      for (const cid of aluno.cursos || []) {
        const curso = cursos.find(c => c.id === cid);
        if (!curso || (aluno.cursosGratuitos || []).includes(cid)) continue;
        if (curso.tipo !== "unico") {
          updates[`pagamentosCursos.${cid}.${mes}`] = true;
          cursosMarcados.push(curso.nome);
        }
      }
      updates[`pagamentos.${mes}`] = true;

      if (cursosMarcados.length === 0) return `⚠️ ${aluno.nome} não tem cursos mensais para marcar.`;

      await db.collection("tenants").doc(tenantId).collection("alunos").doc(aluno.id).update(updates);
      return `✅ *${aluno.nome}* — Todos os cursos marcados como pagos!\n📅 ${nomeMes(mes)}\n💰 Cursos: ${cursosMarcados.join(", ")}`;
    }
  }

  // ── DESMARCAR PAGO ─────────────────────────────────────────
  if (comando === "despago" && partes.length >= 2) {
    const nomeBusca = partes.length >= 3 ? partes.slice(1, -1).join(" ") : partes.slice(1).join(" ");
    const nomeCurso = partes.length >= 3 ? partes[partes.length - 1] : null;
    const aluno = await buscarAluno(tenantId, nomeBusca);
    if (!aluno) return `❌ Aluno *${nomeBusca}* não encontrado.`;

    const mes = mesAtual();
    const updates = {};

    if (nomeCurso) {
      const curso = await buscarCurso(tenantId, nomeCurso);
      if (!curso) return `❌ Curso *${nomeCurso}* não encontrado.`;
      updates[`pagamentosCursos.${curso.id}.${mes}`] = false;
    } else {
      for (const cid of aluno.cursos || []) {
        updates[`pagamentosCursos.${cid}.${mes}`] = false;
      }
      updates[`pagamentos.${mes}`] = false;
    }

    await db.collection("tenants").doc(tenantId).collection("alunos").doc(aluno.id).update(updates);
    return `↩️ Pagamento desmarcado para *${aluno.nome}*`;
  }

  // ── LISTAR ALUNOS COM PENDÊNCIAS ───────────────────────────
  if (comando === "alunos") {
    const alunosSnap = await db.collection("tenants").doc(tenantId).collection("alunos").get();
    const mes = mesAtual();
    const pendentes = [];

    for (const doc of alunosSnap.docs) {
      const a = doc.data();
      const temPendencia = (a.cursos || []).some(cid => {
        if ((a.cursosGratuitos || []).includes(cid)) return false;
        return !a.pagamentosCursos?.[cid]?.[mes];
      });
      if (temPendencia) pendentes.push(a.nome);
    }

    if (pendentes.length === 0) return `🎉 Todos os alunos estão em dia em ${nomeMes(mes)}!`;
    return `⚠️ *Pendentes em ${nomeMes(mes)}:*\n\n${pendentes.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nTotal: ${pendentes.length} aluno(s)`;
  }

  // ── LISTAR CURSOS ──────────────────────────────────────────
  if (comando === "cursos") {
    const snap = await db.collection("tenants").doc(tenantId).collection("cursos").get();
    if (snap.empty) return "📚 Nenhum curso cadastrado ainda.";
    const lista = snap.docs.map(d => {
      const c = d.data();
      return `• ${c.nome} (${c.tipo === "unico" ? "💎 Único" : "📅 Mensal"})`;
    }).join("\n");
    return `📚 *Cursos cadastrados:*\n\n${lista}`;
  }

  // ── ADICIONAR ALUNO ────────────────────────────────────────
  if (comando === "novo" && partes.length >= 2) {
    if (!usuario.admin) return "❌ Apenas administradores podem adicionar alunos.";
    const telefone = partes[partes.length - 1].match(/^\+?\d+$/) ? partes[partes.length - 1] : null;
    const nome = telefone ? partes.slice(1, -1).join(" ") : partes.slice(1).join(" ");

    if (!nome) return "❌ Use: *novo [nome] [telefone]*\nEx: novo Maria Silva +5511999999999";

    const alunoRef = db.collection("tenants").doc(tenantId).collection("alunos").doc();
    await alunoRef.set({
      nome: nome.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      telefone: telefone || "",
      email: "",
      diaVencimento: 10,
      dataInicio: new Date().toISOString().split("T")[0],
      pagamentos: {}, cursos: [], valoresCursos: {}, pagamentosCursos: {},
      observacoes: "", foto: "", cursosGratuitos: []
    });

    return `✅ Aluno *${nome}* adicionado com sucesso!\n📱 ${telefone || "Sem telefone"}\n\nAgora acesse o sistema para adicioná-lo a um curso.`;
  }

  // ── COMANDO NÃO RECONHECIDO ────────────────────────────────
  return `❓ Comando não reconhecido: *${texto}*\n\nDigite *ajuda* para ver os comandos disponíveis.`;
}

// ============================================================
// ROTAS
// ============================================================

// Health check
app.get("/", (req, res) => {
  res.json({ status: "✅ Webhook online!", versao: "1.0.0" });
});

// Webhook da Evolution API
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responde imediatamente

  try {
    const body = req.body;
    // Evolution API v2 format
    const event = body.event || body.type;
    if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") return;

    const msg = body.data?.messages?.[0] || body.messages?.[0];
    if (!msg) return;
    if (msg.key?.fromMe) return; // Ignora mensagens enviadas pelo bot
    if (!msg.message) return;

    const texto = msg.message.conversation ||
                  msg.message.extendedTextMessage?.text || "";
    if (!texto) return;

    const numero = msg.key.remoteJid?.replace("@s.whatsapp.net", "");
    if (!numero) return;

    console.log(`📩 Mensagem de ${numero}: ${texto}`);

    // Busca usuário autorizado
    const usuario = await buscarUsuarioPorTelefone(numero);
    if (!usuario) {
      await enviarMensagem(numero, "❌ Número não autorizado.\n\nPeça ao administrador para cadastrar seu número no sistema.");
      return;
    }

    // Processa comando
    const resposta = await processarComando(usuario, texto, numero);
    await enviarMensagem(numero, resposta);
    console.log(`✅ Respondido para ${usuario.nome}: ${resposta.substring(0, 50)}...`);

  } catch (e) {
    console.error("❌ Erro no webhook:", e.message);
  }
});

// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook rodando na porta ${PORT}`);
  console.log(`📡 Evolution API: ${EVOLUTION_API_URL}`);
  console.log(`🔥 Firebase: ${FIREBASE_PROJECT_ID}`);
});
