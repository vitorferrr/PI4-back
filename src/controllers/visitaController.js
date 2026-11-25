import visitaService from "../services/visitaService.js";
import tratarErro from "../utils/tratarErro.js";
import { podeAcessarVisita, responderNaoEncontrada } from "../utils/acessoVisita.js";

const podeGerenciarVisita = (usuario, visita) =>
  usuario?.role === "admin" || visita.gestor_id === usuario?.id;

const transicionar = (transicao, mensagemErro) => async (req, res) => {
  try {
    const visita = await visitaService.buscarPorId(req.params.id);

    if (!visita || !podeAcessarVisita(req.usuario, visita)) {
      return responderNaoEncontrada(res);
    }

    const visitaAtualizada = await transicao(req.params.id, req);

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
    const ids = fiscalizadores_ids ?? fiscalizadores ?? [];

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

const iniciar = transicionar(
  (id, req) => visitaService.iniciar(id, req.body),
  "Erro ao iniciar visita"
);

const concluir = transicionar((id) => visitaService.concluir(id), "Erro ao concluir visita");

const atualizar = async (req, res) => {
  try {
    const visita = await visitaService.buscarPorId(req.params.id);

    if (!visita || !podeGerenciarVisita(req.usuario, visita)) {
      return responderNaoEncontrada(res);
    }

    const { fiscalizadores_ids, fiscalizadores, ...dadosVisita } = req.body ?? {};
    const ids = fiscalizadores_ids ?? fiscalizadores;

    const visitaAtualizada = await visitaService.atualizar(
      req.params.id,
      dadosVisita,
      ids
    );

    if (!visitaAtualizada) {
      return responderNaoEncontrada(res);
    }

    return res.status(200).json(visitaAtualizada);
  } catch (erro) {
    return tratarErro(
      res,
      erro,
      "Erro ao atualizar visita",
      "Gestor ou fiscalizador informado não existe no sistema."
    );
  }
};

const remover = async (req, res) => {
  try {
    const visita = await visitaService.buscarPorId(req.params.id);

    if (!visita || !podeGerenciarVisita(req.usuario, visita)) {
      return responderNaoEncontrada(res);
    }

    const visitaRemovida = await visitaService.remover(req.params.id);

    if (!visitaRemovida) {
      return responderNaoEncontrada(res);
    }

    return res.status(204).send();
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao apagar visita");
  }
};

export default {
  criar,
  listar,
  buscarPorId,
  atualizar,
  remover,
  iniciar,
  concluir,
};