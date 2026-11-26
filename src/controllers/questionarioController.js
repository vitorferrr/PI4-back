import questionarioService from "../services/questionarioService.js";
import visitaService from "../services/visitaService.js";
import tratarErro from "../utils/tratarErro.js";
import { podeAcessarVisita, responderNaoEncontrada } from "../utils/acessoVisita.js";

const listar = async (req, res) => {
  try {
    const perguntas = await questionarioService.listar();

    return res.status(200).json(perguntas);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao listar questionário");
  }
};

const salvarRespostas = async (req, res) => {
  try {
    const visita = await visitaService.buscarParaAcesso(req.params.id);

    if (!visita || !podeAcessarVisita(req.usuario, visita)) {
      return responderNaoEncontrada(res);
    }

    const respostas = await questionarioService.salvarRespostas(visita.id, req.body?.respostas);

    if (!respostas) {
      return responderNaoEncontrada(res);
    }

    return res.status(200).json(respostas);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao salvar respostas");
  }
};

const responderRespostaNaoEncontrada = (res) =>
  res.status(404).json({
    mensagem: "Resposta não encontrada",
  });

const comVisitaAcessivel = (mensagemErro, acao) => async (req, res) => {
  try {
    const visita = await visitaService.buscarParaAcesso(req.params.id);

    if (!visita || !podeAcessarVisita(req.usuario, visita)) {
      return responderNaoEncontrada(res);
    }

    return await acao(req, res, visita.id, Number(req.params.respostaId));
  } catch (erro) {
    return tratarErro(res, erro, mensagemErro);
  }
};

const listarRespostas = comVisitaAcessivel("Erro ao listar respostas", async (req, res, visitaId) => {
  const respostas = await questionarioService.listarDaVisita(visitaId);

  return res.status(200).json(respostas);
});

const buscarResposta = comVisitaAcessivel(
  "Erro ao buscar resposta",
  async (req, res, visitaId, respostaId) => {
    const resposta = await questionarioService.buscarDaVisita(visitaId, respostaId);

    return resposta ? res.status(200).json(resposta) : responderRespostaNaoEncontrada(res);
  }
);

const atualizarResposta = comVisitaAcessivel(
  "Erro ao atualizar resposta",
  async (req, res, visitaId, respostaId) => {
    const resposta = await questionarioService.atualizarDaVisita(
      visitaId,
      respostaId,
      req.body?.resposta
    );

    return resposta ? res.status(200).json(resposta) : responderRespostaNaoEncontrada(res);
  }
);

const removerResposta = comVisitaAcessivel(
  "Erro ao apagar resposta",
  async (req, res, visitaId, respostaId) => {
    const removida = await questionarioService.removerDaVisita(visitaId, respostaId);

    return removida ? res.status(204).send() : responderRespostaNaoEncontrada(res);
  }
);

export default {
  listar,
  salvarRespostas,
  listarRespostas,
  buscarResposta,
  atualizarResposta,
  removerResposta,
};