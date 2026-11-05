import visitaService from "../services/visitaService.js";
import tratarErro from "../utils/tratarErro.js";

const podeAcessarVisita = (usuario, visita) =>
  usuario?.role !== "fiscalizador" ||
  visita.fiscalizadores?.some((fiscalizador) => fiscalizador.id === usuario.id);

// Fiscalizador não associado recebe a mesma resposta de uma visita inexistente,
// para que não seja possível descobrir quais ids existem.
const responderNaoEncontrada = (res) =>
  res.status(404).json({
    mensagem: "Visita não encontrada",
  });

const transicionar = (transicao, mensagemErro) => async (req, res) => {
  try {
    const visita = await visitaService.buscarPorId(req.params.id);

    if (!visita || !podeAcessarVisita(req.usuario, visita)) {
      return responderNaoEncontrada(res);
    }

    const visitaAtualizada = await transicao(req.params.id);

    if (!visitaAtualizada) {
      return responderNaoEncontrada(res);
    }

    return res.status(200).json(visitaAtualizada);
  } catch (erro) {
    return tratarErro(res, erro, mensagemErro);
  }
};

const criar = async (req, res) => {
  try {
    const { fiscalizadores_ids, fiscalizadores, ...dadosVisita } = req.body;
    const ids = fiscalizadores_ids || fiscalizadores || [];

    if (!dadosVisita.gestor_id && req.usuario?.id) {
      dadosVisita.gestor_id = req.usuario.id;
    }

    const visita = await visitaService.criar(dadosVisita, ids);

    return res.status(201).json(visita);
  } catch (erro) {
    return tratarErro(
      res,
      erro,
      "Erro ao criar visita",
      "Gestor ou fiscalizador informado não existe no sistema."
    );
  }
};

const listar = async (req, res) => {
  try {
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
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao listar visitas");
  }
};

const buscarPorId = async (req, res) => {
  try {
    const visita = await visitaService.buscarPorId(req.params.id);

    if (!visita || !podeAcessarVisita(req.usuario, visita)) {
      return responderNaoEncontrada(res);
    }

    return res.status(200).json(visita);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao buscar visita");
  }
};

const iniciar = transicionar(visitaService.iniciar, "Erro ao iniciar visita");

const concluir = transicionar(visitaService.concluir, "Erro ao concluir visita");

export default {
  criar,
  listar,
  buscarPorId,
  iniciar,
  concluir,
};