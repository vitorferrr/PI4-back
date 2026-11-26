import visitaService from "../services/visitaService.js";
import AppError from "../utils/appError.js";
import { podeAcessarVisita, erroVisitaNaoEncontrada } from "../utils/acessoVisita.js";

const MENSAGEM_REFERENCIA_INVALIDA =
  "Gestor ou fiscalizador informado não existe no sistema.";

const podeGerenciarVisita = (usuario, visita) =>
  usuario?.role === "admin" || visita.gestor_id === usuario?.id;

// Quando o gestor_id ou um fiscalizador não existe, o banco recusa a gravação
// (chave estrangeira). Aqui a mensagem genérica vira uma que diz o que está errado.
const comReferenciasValidas = async (operacao) => {
  try {
    return await operacao();
  } catch (erro) {
    if (erro.name === "SequelizeForeignKeyConstraintError") {
      throw new AppError(MENSAGEM_REFERENCIA_INVALIDA, 400);
    }

    throw erro;
  }
};

const transicionar = (transicao) => async (req, res) => {
  const visita = await visitaService.buscarPorId(req.params.id);

  if (!visita || !podeAcessarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const visitaAtualizada = await transicao(req.params.id, req);

  if (!visitaAtualizada) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(200).json(visitaAtualizada);
};

const criar = async (req, res) => {
  const { fiscalizadores_ids, fiscalizadores, ...dadosVisita } = req.body;
  const ids = fiscalizadores_ids ?? fiscalizadores ?? [];

  if (!dadosVisita.gestor_id && req.usuario?.id) {
    dadosVisita.gestor_id = req.usuario.id;
  }

  const visita = await comReferenciasValidas(() => visitaService.criar(dadosVisita, ids));

  return res.status(201).json(visita);
};

const listar = async (req, res) => {
  const filtros = {
    status: req.query.status,
    gestor_id: req.query.gestor_id,
    fiscalizador_id: req.query.fiscalizador_id,
  };

  if (req.usuario?.role === "fiscalizador") {
    filtros.fiscalizador_id = req.usuario.id;
  }

  const visitas = await visitaService.listar(filtros);

  return res.status(200).json(visitas);
};

const buscarPorId = async (req, res) => {
  const visita = await visitaService.buscarPorId(req.params.id);

  if (!visita || !podeAcessarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(200).json(visita);
};

const iniciar = transicionar((id, req) => visitaService.iniciar(id, req.body));

const concluir = transicionar((id) => visitaService.concluir(id));

const salvarObservacoes = async (req, res) => {
  const visita = await visitaService.buscarParaAcesso(req.params.id);

  if (!visita || !podeAcessarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const visitaAtualizada = await visitaService.salvarObservacoes(
    visita.id,
    req.body.observacoes_livres
  );

  if (!visitaAtualizada) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(200).json(visitaAtualizada);
};

const atualizar = async (req, res) => {
  const visita = await visitaService.buscarPorId(req.params.id);

  if (!visita || !podeGerenciarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const { fiscalizadores_ids, fiscalizadores, ...dadosVisita } = req.body ?? {};
  const ids = fiscalizadores_ids ?? fiscalizadores;

  const visitaAtualizada = await comReferenciasValidas(() =>
    visitaService.atualizar(req.params.id, dadosVisita, ids)
  );

  if (!visitaAtualizada) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(200).json(visitaAtualizada);
};

const remover = async (req, res) => {
  const visita = await visitaService.buscarPorId(req.params.id);

  if (!visita || !podeGerenciarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const visitaRemovida = await visitaService.remover(req.params.id);

  if (!visitaRemovida) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(204).send();
};

const listarFiscalizadores = async (req, res) => {
  const visita = await visitaService.buscarPorId(req.params.id);

  if (!visita || !podeAcessarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const fiscalizadores = await visitaService.listarFiscalizadores(req.params.id);

  if (!fiscalizadores) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(200).json(fiscalizadores);
};

const adicionarFiscalizador = async (req, res) => {
  const visita = await visitaService.buscarPorId(req.params.id);

  if (!visita || !podeGerenciarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const fiscalizadorId = req.body?.fiscalizadorId ?? req.body?.fiscalizador_id;
  const fiscalizadores = await visitaService.adicionarFiscalizador(
    req.params.id,
    fiscalizadorId
  );

  if (!fiscalizadores) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(201).json(fiscalizadores);
};

const substituirFiscalizadores = async (req, res) => {
  const visita = await visitaService.buscarPorId(req.params.id);

  if (!visita || !podeGerenciarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const fiscalizadoresIds =
    req.body?.fiscalizadoresIds ?? req.body?.fiscalizadores_ids;
  const fiscalizadores = await visitaService.substituirFiscalizadores(
    req.params.id,
    fiscalizadoresIds
  );

  if (!fiscalizadores) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(200).json(fiscalizadores);
};

const removerFiscalizador = async (req, res) => {
  const visita = await visitaService.buscarPorId(req.params.id);

  if (!visita || !podeGerenciarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const resultado = await visitaService.removerFiscalizador(
    req.params.id,
    req.params.fiscalizadorId
  );

  if (!resultado) {
    throw erroVisitaNaoEncontrada();
  }

  if (resultado.naoVinculado) {
    throw new AppError("Fiscalizador não vinculado à visita", 404);
  }

  return res.status(204).send();
};

export default {
  criar,
  listar,
  buscarPorId,
  atualizar,
  remover,
  iniciar,
  concluir,
  salvarObservacoes,
  listarFiscalizadores,
  adicionarFiscalizador,
  substituirFiscalizadores,
  removerFiscalizador,
};
