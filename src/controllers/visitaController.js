import visitaService from "../services/visitaService.js";

const tratarErro = (res, erro, mensagem) => {
  if (
    erro.name === "SequelizeValidationError" ||
    erro.name === "ValidacaoError"
  ) {
    return res.status(400).json({
      mensagem,
      erros: erro.errors
        ? erro.errors.map((e) => e.message)
        : [erro.message],
    });
  }

  if (erro.name === "SequelizeForeignKeyConstraintError") {
    return res.status(400).json({
      mensagem: "Gestor ou fiscalizador informado não existe no sistema.",
    });
  }

  console.error(erro);

  return res.status(500).json({
    mensagem,
  });
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
    return tratarErro(res, erro, "Erro ao criar visita");
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

    if (!visita) {
      return res.status(404).json({
        mensagem: "Visita não encontrada",
      });
    }

    if (req.usuario?.role === "fiscalizador") {
      const souFiscalizador = visita.fiscalizadores?.some(
        (fiscalizador) => fiscalizador.id === req.usuario.id
      );

      if (!souFiscalizador) {
        return res.status(403).json({
          mensagem: "Usuário não possui permissão para acessar esta visita",
        });
      }
    }

    return res.status(200).json(visita);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao buscar visita");
  }
};

const iniciar = async (req, res) => {
  try {
    const visita = await visitaService.iniciar(req.params.id);

    if (!visita) {
      return res.status(404).json({
        mensagem: "Visita não encontrada",
      });
    }

    return res.status(200).json(visita);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao iniciar visita");
  }
};

const concluir = async (req, res) => {
  try {
    const visita = await visitaService.concluir(req.params.id);

    if (!visita) {
      return res.status(404).json({
        mensagem: "Visita não encontrada",
      });
    }

    return res.status(200).json(visita);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao concluir visita");
  }
};

export default {
  criar,
  listar,
  buscarPorId,
  iniciar,
  concluir,
};