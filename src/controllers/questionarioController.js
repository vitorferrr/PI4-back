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

const buscarPorId = async (req, res) => {
  try {
    const pergunta = await questionarioService.buscarPorId(req.params.id);

    if (!pergunta) {
      return res.status(404).json({
        mensagem: "Pergunta não encontrada",
      });
    }

    return res.status(200).json(pergunta);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao buscar pergunta");
  }
};

const criar = async (req, res) => {
  try {
    const pergunta = await questionarioService.criar(req.body);

    return res.status(201).json(pergunta);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao criar pergunta");
  }
};

const atualizar = async (req, res) => {
  try {
    const pergunta = await questionarioService.atualizar(
      req.params.id,
      req.body
    );

    if (!pergunta) {
      return res.status(404).json({
        mensagem: "Pergunta não encontrada",
      });
    }

    return res.status(200).json(pergunta);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao atualizar pergunta");
  }
};

const remover = async (req, res) => {
  try {
    const pergunta = await questionarioService.remover(req.params.id);

    if (!pergunta) {
      return res.status(404).json({
        mensagem: "Pergunta não encontrada",
      });
    }

    return res.status(204).send();
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao apagar pergunta");
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

export default {
  listar,
  buscarPorId,
  criar,
  atualizar,
  remover,
  salvarRespostas,
};