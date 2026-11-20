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

export default {
  listar,
  salvarRespostas,
};