function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+@\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limparNome(nome) {
  return String(nome || "")
    .replace(/^(?:o|a|aluno|aluna)\s+/i, "")
    .replace(/\s+(?:esse|este|neste)\s+(?:mes|meis)$/i, "")
    .trim();
}

function comandoComNome(comando, nome) {
  const nomeLimpo = limparNome(nome);
  return nomeLimpo ? comando + " " + nomeLimpo : null;
}

function interpretarMensagemNatural(mensagem) {
  const original = String(mensagem || "").trim();
  const texto = normalizarTexto(original);
  if (!texto) return original;

  const primeiro = texto.split(" ")[0];
  const comandos = new Set(["ajuda", "menu", "help", "status", "alunos", "cursos", "pago", "despago", "novo"]);
  if (comandos.has(primeiro)) return original;

  if (/^(?:oi|ola|bom dia|boa tarde|boa noite)$/.test(texto) ||
      /(?:o que voce faz|como usar|mostra(?:r)? (?:o )?menu|preciso de ajuda)/.test(texto)) {
    return "ajuda";
  }

  if (/(?:quem|quais alunos).*(?:devendo|deve|pendente|nao pag)/.test(texto) ||
      /(?:lista|listar|mostra|mostrar).*(?:pendentes|inadimplentes)/.test(texto)) {
    return "alunos";
  }

  if (/(?:quais|lista|listar|mostra|mostrar).*(?:curso|cursos|turma|turmas)/.test(texto)) {
    return "cursos";
  }

  let match = texto.match(/^(.+?)\s+(?:pago|pagou|paga)\s+(?:(?:esse|este|neste)\s+)?(?:mes|meis)$/);
  if (match) return comandoComNome("pago", match[1]) || original;

  match = texto.match(/^(?:pode\s+)?(?:marca|marque|marcar)\s+(.+?)\s+(?:como\s+)?pago(?:\s+(?:(?:esse|este|neste)\s+)?(?:mes|meis))?$/);
  if (match) return comandoComNome("pago", match[1]) || original;

  match = texto.match(/^(?:pode\s+)?(?:marca|marque|marcar)\s+(?:como\s+)?pago\s+(?:o\s+|a\s+)?(.+?)(?:\s+(?:(?:esse|este|neste)\s+)?(?:mes|meis))?$/);
  if (match) return comandoComNome("pago", match[1]) || original;

  match = texto.match(/^(?:desmarca|desmarque|desmarcar|tirar|tira)\s+(?:o\s+)?pagamento\s+(?:de|do|da)\s+(.+)$/);
  if (match) return comandoComNome("despago", match[1]) || original;

  match = texto.match(/^(?:como|quanto)\s+(?:esta|ta|deve)\s+(?:o\s+|a\s+)?(.+)$/);
  if (match) return comandoComNome("status", match[1]) || original;

  match = texto.match(/^(?:qual\s+(?:e\s+)?(?:a\s+)?situacao|situacao|status)\s+(?:de|do|da)\s+(.+)$/);
  if (match) return comandoComNome("status", match[1]) || original;

  match = texto.match(/^(.+?)\s+(?:esta|ta)\s+(?:devendo|em dia|pago|pendente)$/);
  if (match) return comandoComNome("status", match[1]) || original;

  return original;
}

module.exports = {interpretarMensagemNatural, normalizarTexto};
