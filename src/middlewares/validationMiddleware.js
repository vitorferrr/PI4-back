import { responderErro } from "./errorHandler.js";

const ROLES_VALIDAS = ["admin", "gestor", "fiscalizador"];
const STATUS_VISITA_VALIDOS = [
  "agendada",
  "em_andamento",
  "concluida",
  "cancelada",
];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_MAXIMO = 2147483647;

const inteiroPositivo = (valor) =>
  Number.isInteger(valor) && valor >= 1 && valor <= ID_MAXIMO;

const inteiroPositivoQuery = (valor) =>
  typeof valor === "string" &&
  /^[1-9]\d*$/.test(valor) &&
  Number(valor) <= ID_MAXIMO;

const textoPreenchido = (valor) =>
  typeof valor === "string" && valor.trim().length > 0;

const ehObjeto = (valor) =>
  Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);

const dataValida = (valor) => {
  if (typeof valor !== "string" && !(valor instanceof Date)) return false;
  const data = new Date(valor);
  return !Number.isNaN(data.getTime());
};

const coordenadaValida = (valor, limite) =>
  typeof valor === "number" && Number.isFinite(valor) && Math.abs(valor) <= limite;

const finalizarValidacao = (res, next, erros) => {
  if (erros.length > 0) {
    return responderErro(res, 400, "Dados inválidos", erros);
  }
  return next();
};

export const validarCriacaoUsuario = (req, res, next) => {
  if (!ehObjeto(req.body)) {
    return responderErro(res, 400, "Dados inválidos", [
      "O corpo da requisição deve ser um objeto JSON",
    ]);
  }

  const { nome, email, senha, role } = req.body;
  const erros = [];

  if (!textoPreenchido(nome)) {
    erros.push("O campo nome é obrigatório");
  }

  if (!textoPreenchido(email) || !EMAIL_REGEX.test(email.trim())) {
    erros.push("Informe um email válido");
  }

  if (typeof senha !== "string" || senha.trim().length < 6) {
    erros.push("A senha deve ter ao menos 6 caracteres");
  }

  if (!ROLES_VALIDAS.includes(role)) {
    erros.push("Perfil (role) inválido");
  }

  return finalizarValidacao(res, next, erros);
};

export const validarAtualizacaoUsuario = (req, res, next) => {
  if (!ehObjeto(req.body) || Object.keys(req.body).length === 0) {
    return responderErro(res, 400, "Dados inválidos", [
      "Informe ao menos um campo para atualizar",
    ]);
  }

  const { nome, email, senha, role } = req.body;
  const erros = [];

  if (nome !== undefined && !textoPreenchido(nome)) {
    erros.push("O campo nome não pode ser vazio");
  }

  if (
    email !== undefined &&
    (!textoPreenchido(email) || !EMAIL_REGEX.test(email.trim()))
  ) {
    erros.push("Informe um email válido");
  }

  if (
    senha !== undefined &&
    (typeof senha !== "string" || senha.trim().length < 6)
  ) {
    erros.push("A senha deve ter ao menos 6 caracteres");
  }

  if (role !== undefined && !ROLES_VALIDAS.includes(role)) {
    erros.push("Perfil (role) inválido");
  }

  return finalizarValidacao(res, next, erros);
};

export const validarCriacaoVisita = (req, res, next) => {
  if (!ehObjeto(req.body)) {
    return responderErro(res, 400, "Dados inválidos", [
      "O corpo da requisição deve ser um objeto JSON",
    ]);
  }

  const {
    denunciado,
    data_agendada,
    gestor_id,
    fiscalizadores_ids,
    fiscalizadores,
    latitude,
    longitude,
  } = req.body;
  const erros = [];

  if (!textoPreenchido(denunciado)) {
    erros.push("O campo denunciado é obrigatório");
  }

  if (!dataValida(data_agendada)) {
    erros.push("Informe uma data_agendada válida");
  }

  if (gestor_id !== undefined && !inteiroPositivo(gestor_id)) {
    erros.push("gestor_id deve ser um número inteiro positivo");
  }

  const listaFiscalizadores = fiscalizadores_ids ?? fiscalizadores;
  if (
    listaFiscalizadores !== undefined &&
    (!Array.isArray(listaFiscalizadores) ||
      !listaFiscalizadores.every(inteiroPositivo))
  ) {
    erros.push("fiscalizadores_ids deve ser uma lista de IDs inteiros positivos");
  }

  if (latitude !== undefined && !coordenadaValida(latitude, 90)) {
    erros.push("A latitude deve ser um número entre -90 e 90");
  }

  if (longitude !== undefined && !coordenadaValida(longitude, 180)) {
    erros.push("A longitude deve ser um número entre -180 e 180");
  }

  return finalizarValidacao(res, next, erros);
};

export const validarListagemVisitas = (req, res, next) => {
  const { status, gestor_id, fiscalizador_id } = req.query ?? {};
  const erros = [];

  if (status !== undefined && !STATUS_VISITA_VALIDOS.includes(status)) {
    erros.push("Status de filtro inválido");
  }

  if (gestor_id !== undefined && !inteiroPositivoQuery(gestor_id)) {
    erros.push("gestor_id deve ser um número inteiro positivo");
  }

  if (fiscalizador_id !== undefined && !inteiroPositivoQuery(fiscalizador_id)) {
    erros.push("fiscalizador_id deve ser um número inteiro positivo");
  }

  return finalizarValidacao(res, next, erros);
};

export const validarRespostasQuestionario = (req, res, next) => {
  if (!ehObjeto(req.body)) {
    return responderErro(res, 400, "Dados inválidos", [
      "O corpo da requisição deve ser um objeto JSON",
    ]);
  }

  const { respostas } = req.body;
  if (!Array.isArray(respostas) || respostas.length === 0) {
    return responderErro(res, 400, "Dados inválidos", [
      "Envie ao menos uma resposta em 'respostas'",
    ]);
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

  return finalizarValidacao(res, next, erros);
};
