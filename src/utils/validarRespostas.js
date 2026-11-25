const ID_MAXIMO = 2147483647;

const inteiroPositivo = (valor) =>
  Number.isInteger(valor) && valor >= 1 && valor <= ID_MAXIMO;

const textoPreenchido = (valor) =>
  typeof valor === "string" && valor.trim().length > 0;

const ehObjeto = (valor) =>
  Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);

export const validarListaRespostas = (respostas) => {
  if (!Array.isArray(respostas) || respostas.length === 0) {
    return ["Envie ao menos uma resposta em 'respostas'"];
  }

  const erros = [];
  const ids = new Set();

  respostas.forEach((item, indice) => {
    const posicao = `Resposta ${indice + 1}`;

    if (!ehObjeto(item) || !inteiroPositivo(item.pergunta_id)) {
      erros.push(`${posicao}: pergunta_id deve ser um número inteiro positivo`);
      return;
    }

    if (!textoPreenchido(item.resposta)) {
      erros.push(`${posicao}: a resposta deve ser um texto preenchido`);
    }

    if (ids.has(item.pergunta_id)) {
      erros.push(`A pergunta ${item.pergunta_id} foi enviada mais de uma vez`);
    }

    ids.add(item.pergunta_id);
  });

  return erros;
};
