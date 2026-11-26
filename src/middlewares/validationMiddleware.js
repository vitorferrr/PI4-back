import { responderErro } from "./errorHandler.js";
import { validarListaRespostas } from "../utils/validarRespostas.js";

const ROLES_VALIDAS = ["admin", "gestor", "fiscalizador"];
const STATUS_VISITA_VALIDOS = [
  "agendada",
  "em_andamento",
  "concluida",
  "cancelada",
];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const ID_MAXIMO = 2147483647;

const inteiroPositivo = (valor) =>
  Number.isInteger(valor) && valor >= 1 && valor <= ID_MAXIMO;

const inteiroPositivoQuery = (valor) =>
  typeof valor === "string" &&
  /^[1-9]\d*$/.test(valor) &&
  Number(valor) <= ID_MAXIMO;

const inteiroNaoNegativoQuery = (valor) =>
  typeof valor === "string" &&
  /^\d+$/.test(valor) &&
  Number(valor) <= ID_MAXIMO;

const textoPreenchido = (valor) =>
  typeof valor === "string" && valor.trim().length > 0;

const ehObjeto = (valor) =>
  Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);

const dataValida = (valor) => {
  if (valor instanceof Date) {
    return !Number.isNaN(valor.getTime());
  }
  if (typeof valor !== "string") {
    return false;
  }

  const partes = ISO_DATE_REGEX.exec(valor);
  if (!partes) {
    return false;
  }

  const [, anoStr, mesStr, diaStr] = partes;
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const dia = Number(diaStr);

  const dataUtc = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    dataUtc.getUTCFullYear() !== ano ||
    dataUtc.getUTCMonth() !== mes - 1 ||
    dataUtc.getUTCDate() !== dia
  ) {
    return false;
  }

  return !Number.isNaN(new Date(valor).getTime());
};

const coordenadaValida = (valor, limite) =>
  typeof valor === "number" && Number.isFinite(valor) && Math.abs(valor) <= limite;

const finalizarValidacao = (res, next, erros) => {
  if (erros.length > 0) {
    return responderErro(res, 400, "Dados inválidos", erros);
  }
  return next();
};

export { validarListaRespostas };

export const validarListagemUsuarios = (req, res, next) => {
  const { aprovado } = req.query ?? {};
  const erros = [];

  if (aprovado !== undefined && aprovado !== "true" && aprovado !== "false") {
    erros.push("aprovado deve ser true ou false");
  }

  return finalizarValidacao(res, next, erros);
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
    erros.push("Informe uma data_agendada válida no formato ISO 8601");
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

export const validarAtualizacaoVisita = (req, res, next) => {
  if (!ehObjeto(req.body) || Object.keys(req.body).length === 0) {
    return responderErro(res, 400, "Dados inválidos", [
      "Informe ao menos um campo para atualizar",
    ]);
  }

  const {
    denunciado,
    data_agendada,
    gestor_id,
    fiscalizadores_ids,
    fiscalizadores,
    status,
  } = req.body;
  const erros = [];

  if (denunciado !== undefined && !textoPreenchido(denunciado)) {
    erros.push("O campo denunciado não pode ser vazio");
  }

  if (data_agendada !== undefined && !dataValida(data_agendada)) {
    erros.push("Informe uma data_agendada válida no formato ISO 8601");
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

  if (status !== undefined && status !== "cancelada") {
    erros.push("Na edição da visita, o único status permitido é 'cancelada'");
  }

  return finalizarValidacao(res, next, erros);
};

export const validarListagemVisitas = (req, res, next) => {
  const { status, gestor_id, fiscalizador_id, limit, offset } =
    req.query ?? {};
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

  if (limit !== undefined && !inteiroPositivoQuery(limit)) {
    erros.push("limit deve ser um número inteiro positivo");
  }

  if (offset !== undefined && !inteiroNaoNegativoQuery(offset)) {
    erros.push("offset deve ser um número inteiro não negativo");
  }

  return finalizarValidacao(res, next, erros);
};

export const validarAtualizacaoResposta = (req, res, next) => {
  if (!ehObjeto(req.body)) {
    return responderErro(res, 400, "Dados inválidos", [
      "O corpo da requisição deve ser um objeto JSON",
    ]);
  }

  const erros = textoPreenchido(req.body.resposta)
    ? []
    : ["A resposta deve ser um texto preenchido"];

  return finalizarValidacao(res, next, erros);
};

export const validarRespostasQuestionario = (req, res, next) => {
  if (!ehObjeto(req.body)) {
    return responderErro(res, 400, "Dados inválidos", [
      "O corpo da requisição deve ser um objeto JSON",
    ]);
  }

  const erros = validarListaRespostas(req.body.respostas);
  return finalizarValidacao(res, next, erros);
};
