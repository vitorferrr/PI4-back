import questionarioService from "../services/questionarioService.js";
import visitaService from "../services/visitaService.js";
import AppError from "../utils/appError.js";
import { podeAcessarVisita, erroVisitaNaoEncontrada } from "../utils/acessoVisita.js";

const erroPerguntaNaoEncontrada = () => new AppError("Pergunta não encontrada", 404);

const erroRespostaNaoEncontrada = () => new AppError("Resposta não encontrada", 404);

const listar = async (req, res) => {
  const perguntas = await questionarioService.listar();

  return res.status(200).json(perguntas);
};

const buscarPorId = async (req, res) => {
  const pergunta = await questionarioService.buscarPorId(req.params.id);

  if (!pergunta) {
    throw erroPerguntaNaoEncontrada();
  }

  return res.status(200).json(pergunta);
};

const criar = async (req, res) => {
  const pergunta = await questionarioService.criar(req.body);

  return res.status(201).json(pergunta);
};

const atualizar = async (req, res) => {
  const pergunta = await questionarioService.atualizar(req.params.id, req.body);

  if (!pergunta) {
    throw erroPerguntaNaoEncontrada();
  }

  return res.status(200).json(pergunta);
};

const remover = async (req, res) => {
  const pergunta = await questionarioService.remover(req.params.id);

  if (!pergunta) {
    throw erroPerguntaNaoEncontrada();
  }

  return res.status(204).send();
};

const salvarRespostas = async (req, res) => {
  const visita = await visitaService.buscarParaAcesso(req.params.id);

  if (!visita || !podeAcessarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const respostas = await questionarioService.salvarRespostas(visita.id, req.body?.respostas);

  if (!respostas) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(200).json(respostas);
};

const comVisitaAcessivel = (acao) => async (req, res) => {
  const visita = await visitaService.buscarParaAcesso(req.params.id);

  if (!visita || !podeAcessarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  return acao(req, res, visita.id, Number(req.params.respostaId));
};

const listarRespostas = comVisitaAcessivel(async (req, res, visitaId) => {
  const respostas = await questionarioService.listarDaVisita(visitaId);

  return res.status(200).json(respostas);
});

const buscarResposta = comVisitaAcessivel(async (req, res, visitaId, respostaId) => {
  const resposta = await questionarioService.buscarDaVisita(visitaId, respostaId);

  if (!resposta) throw erroRespostaNaoEncontrada();

  return res.status(200).json(resposta);
});

const atualizarResposta = comVisitaAcessivel(async (req, res, visitaId, respostaId) => {
  const resposta = await questionarioService.atualizarDaVisita(
    visitaId,
    respostaId,
    req.body?.resposta
  );

  if (!resposta) throw erroRespostaNaoEncontrada();

  return res.status(200).json(resposta);
});

const removerResposta = comVisitaAcessivel(async (req, res, visitaId, respostaId) => {
  const removida = await questionarioService.removerDaVisita(visitaId, respostaId);

  if (!removida) throw erroRespostaNaoEncontrada();

  return res.status(204).send();
});

export default {
  listar,
  buscarPorId,
  criar,
  atualizar,
  remover,
  salvarRespostas,
  listarRespostas,
  buscarResposta,
  atualizarResposta,
  removerResposta,
};
