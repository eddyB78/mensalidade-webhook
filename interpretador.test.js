const test = require("node:test");
const assert = require("node:assert/strict");
const {interpretarMensagemNatural, normalizarTexto} = require("./interpretador");

test("normaliza acentos e pontuacao", () => {
  assert.equal(normalizarTexto("Como está a Maria?"), "como esta a maria");
});

const casos = [
  ["Eddy pago esse meis", "pago eddy"],
  ["Eddy pagou este mês", "pago eddy"],
  ["Marque Eddy como pago", "pago eddy"],
  ["Pode marcar como pago o Eddy esse mês?", "pago eddy"],
  ["Como está a Maria?", "status maria"],
  ["Quem está devendo?", "alunos"],
  ["Quais são os cursos?", "cursos"],
  ["Desmarque o pagamento da Maria", "despago maria"]
];

for (const [mensagem, esperado] of casos) {
  test(mensagem, () => {
    assert.equal(interpretarMensagemNatural(mensagem), esperado);
  });
}

test("preserva os comandos existentes", () => {
  assert.equal(interpretarMensagemNatural("pago Maria"), "pago Maria");
});
