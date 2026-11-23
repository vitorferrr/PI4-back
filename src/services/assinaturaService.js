import models, { sequelize } from "../models/index.js";
import erroValidacao from "../utils/erroValidacao.js";
import { validarImagemAssinatura } from "../utils/validarImagemAssinatura.js";
import { removerArquivo, uploadArquivo } from "./storageService.js";

const { Assinatura, Documento, Usuario, Visita } = models;

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const textoOpcional = (valor) =>
  typeof valor === "string" && valor.trim() ? valor.trim() : null;

const montarAssinante = (dados) => {
  const { assinante_tipo: tipo, usuario_id: usuarioId, imagem } = dados;
  const recusou = dados.recusou === true;

  if (tipo === "fiscalizador") {
    if (!Number.isInteger(usuarioId) || usuarioId < 1) {
      throw erroValidacao("Informe o fiscalizador que está assinando");
    }
    if (recusou) throw erroValidacao("Somente o responsável pelo estabelecimento pode recusar");

    return { tipo, usuarioId, recusou, png: validarImagemAssinatura(imagem) };
  }

  if (tipo === "denunciado") {
    const nome = textoOpcional(dados.assinante_nome);
    const email = textoOpcional(dados.assinante_email);

    if (!nome) throw erroValidacao("Informe o nome do responsável pelo estabelecimento");
    if (email && !EMAIL_VALIDO.test(email)) {
      throw erroValidacao("Informe um e-mail válido para o responsável");
    }
    if (recusou && imagem !== undefined && imagem !== null) {
      throw erroValidacao("Não envie a imagem quando o responsável recusar a assinatura");
    }

    return {
      tipo,
      nome,
      documento: textoOpcional(dados.assinante_documento),
      email,
      recusou,
      png: recusou ? null : validarImagemAssinatura(imagem),
    };
  }

  throw erroValidacao("O tipo de assinante deve ser fiscalizador ou denunciado");
};

const buscarParaAcesso = async (documentoId) =>
  await Documento.findByPk(documentoId, {
    attributes: ["id", "visita_id"],
    include: [
      {
        model: Visita,
        as: "visita",
        attributes: ["id"],
        include: [
          {
            model: Usuario,
            as: "fiscalizadores",
            attributes: ["id"],
            through: { attributes: [] },
          },
        ],
      },
    ],
  });

const registrar = async (documentoId, dados = {}) => {
  const assinante = montarAssinante(dados ?? {});
  const transaction = await sequelize.transaction();
  let arquivo = null;

  try {
    const documento = await Documento.findByPk(documentoId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!documento) {
      await transaction.rollback();
      return null;
    }

    if (documento.url_arquivo_pdf) {
      throw erroValidacao("O PDF do documento já foi gerado; não é possível assinar");
    }

    const visita = await Visita.findByPk(documento.visita_id, {
      attributes: ["id", "status"],
      include: [
        {
          model: Usuario,
          as: "fiscalizadores",
          attributes: ["id", "nome"],
          through: { attributes: [] },
        },
      ],
      transaction,
    });

    if (visita?.status !== "em_andamento") {
      throw erroValidacao("Só é possível assinar documentos de visitas em andamento");
    }

    let dadosAssinatura;

    if (assinante.tipo === "fiscalizador") {
      const fiscal = visita.fiscalizadores?.find((item) => item.id === assinante.usuarioId);

      if (!fiscal) throw erroValidacao("O fiscalizador informado não faz parte da visita");

      dadosAssinatura = { usuario_id: fiscal.id, assinante_nome: fiscal.nome };
    } else {
      dadosAssinatura = {
        usuario_id: null,
        assinante_nome: assinante.nome,
        assinante_documento: assinante.documento,
        assinante_email: assinante.email,
      };
    }

    const existente = await Assinatura.findOne({
      attributes: ["id"],
      where:
        assinante.tipo === "fiscalizador"
          ? { documento_id: documento.id, usuario_id: assinante.usuarioId }
          : { documento_id: documento.id, assinante_tipo: "denunciado" },
      transaction,
    });

    if (existente) {
      throw erroValidacao(
        assinante.tipo === "fiscalizador"
          ? "Este fiscalizador já assinou o documento"
          : "O responsável já assinou ou recusou o documento"
      );
    }

    if (assinante.png) {
      arquivo = await uploadArquivo({
        conteudo: assinante.png.conteudo,
        contentType: assinante.png.contentType,
        diretorio: `visitas/${visita.id}/assinaturas`,
      });
    }

    const assinatura = await Assinatura.create(
      {
        documento_id: documento.id,
        ...dadosAssinatura,
        assinante_tipo: assinante.tipo,
        recusou: assinante.recusou,
        imagem_assinatura_url: arquivo?.path ?? null,
        data_assinatura: new Date(),
      },
      { transaction }
    );

    await transaction.commit();

    return assinatura;
  } catch (erro) {
    if (!transaction.finished) await transaction.rollback();

    if (arquivo) {
      await removerArquivo(arquivo).catch((erroRemocao) =>
        console.error("Falha ao remover imagem de assinatura órfã:", erroRemocao.codigo)
      );
    }

    throw erro;
  }
};

export default {
  buscarParaAcesso,
  registrar,
};
