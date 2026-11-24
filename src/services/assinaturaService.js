import models, { sequelize } from "../models/index.js";
import { getStorageContext } from "../config/supabase.js";
import { podeAcessarVisita } from "../utils/acessoVisita.js";
import emailValido from "../utils/emailValido.js";
import erroValidacao from "../utils/erroValidacao.js";
import { validarImagemAssinatura } from "../utils/validarImagemAssinatura.js";
import { removerArquivo, uploadArquivo } from "./storageService.js";

const { Assinatura, Documento, Usuario, Visita } = models;

const TAMANHO_MAXIMO_TEXTO = 255;

const textoOpcional = (valor) =>
  typeof valor === "string" && valor.trim() ? valor.trim() : null;

const montarAssinante = (dados) => {
  const { assinante_tipo: tipo, imagem } = dados;

  if (dados.recusou !== undefined && dados.recusou !== null && typeof dados.recusou !== "boolean") {
    throw erroValidacao("O campo recusou deve ser verdadeiro ou falso");
  }

  const recusou = dados.recusou === true;

  if (tipo === "fiscalizador") {
    if (recusou) throw erroValidacao("Somente o responsável pelo estabelecimento pode recusar");

    return { tipo, recusou, png: validarImagemAssinatura(imagem) };
  }

  if (tipo === "denunciado") {
    const nome = textoOpcional(dados.assinante_nome);
    const documento = textoOpcional(dados.assinante_documento);
    const email = textoOpcional(dados.assinante_email);

    if (!nome) throw erroValidacao("Informe o nome do responsável pelo estabelecimento");
    if ([nome, documento, email].some((texto) => texto?.length > TAMANHO_MAXIMO_TEXTO)) {
      throw erroValidacao(
        `Nome, documento e e-mail do responsável devem ter no máximo ${TAMANHO_MAXIMO_TEXTO} caracteres`
      );
    }
    if (email && !emailValido(email)) {
      throw erroValidacao("Informe um e-mail válido para o responsável");
    }
    if (recusou && imagem !== undefined && imagem !== null) {
      throw erroValidacao("Não envie a imagem quando o responsável recusar a assinatura");
    }

    return {
      tipo,
      nome,
      documento,
      email,
      recusou,
      png: recusou ? null : validarImagemAssinatura(imagem),
    };
  }

  throw erroValidacao("O tipo de assinante deve ser fiscalizador ou denunciado");
};

const conferirRegras = async (documentoId, assinante, usuario, transaction) => {
  const documento = await Documento.findByPk(
    documentoId,
    transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}
  );

  if (!documento) return null;

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

  if (!visita || !podeAcessarVisita(usuario, visita)) return null;

  if (documento.url_arquivo_pdf) {
    throw erroValidacao("O PDF do documento já foi gerado; não é possível assinar");
  }

  if (visita.status !== "em_andamento") {
    throw erroValidacao("Só é possível assinar documentos de visitas em andamento");
  }

  const ehFiscal = assinante.tipo === "fiscalizador";
  const fiscal = ehFiscal
    ? visita.fiscalizadores?.find((item) => item.id === usuario.id)
    : null;

  if (ehFiscal && !fiscal) {
    throw erroValidacao("O usuário logado não é fiscalizador desta visita");
  }

  const existente = await Assinatura.findOne({
    attributes: ["id"],
    where: ehFiscal
      ? { documento_id: documento.id, usuario_id: fiscal.id }
      : { documento_id: documento.id, assinante_tipo: "denunciado" },
    transaction,
  });

  if (existente) {
    throw erroValidacao(
      ehFiscal
        ? "Este fiscalizador já assinou o documento"
        : "O responsável já assinou ou recusou o documento"
    );
  }

  return {
    documento,
    visita,
    dadosAssinatura: ehFiscal
      ? { usuario_id: fiscal.id, assinante_nome: fiscal.nome }
      : {
          usuario_id: null,
          assinante_nome: assinante.nome,
          assinante_documento: assinante.documento,
          assinante_email: assinante.email,
        },
  };
};

const removerImagem = async (arquivo) => {
  if (!arquivo) return;

  await removerArquivo(arquivo).catch((erro) =>
    console.error("Falha ao remover imagem de assinatura órfã:", arquivo.path, erro.message)
  );
};

const registrar = async (documentoId, dados, usuario) => {
  const assinante = montarAssinante(dados ?? {});
  let arquivo = null;

  if (assinante.png) {
    const conferencia = await conferirRegras(documentoId, assinante, usuario);

    if (!conferencia) return null;

    arquivo = await uploadArquivo({
      conteudo: assinante.png.conteudo,
      contentType: assinante.png.contentType,
      diretorio: `visitas/${conferencia.visita.id}/assinaturas`,
    });
  }

  let transaction;

  try {
    transaction = await sequelize.transaction();

    const conferencia = await conferirRegras(documentoId, assinante, usuario, transaction);

    if (!conferencia) {
      await transaction.rollback();
      await removerImagem(arquivo);
      return null;
    }

    const assinatura = await Assinatura.create(
      {
        documento_id: conferencia.documento.id,
        ...conferencia.dadosAssinatura,
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
    try {
      if (transaction && !transaction.finished) await transaction.rollback();
    } catch (erroRollback) {
      console.error("Falha ao desfazer a transação da assinatura:", erroRollback.message);
    }

    await removerImagem(arquivo);
    throw erro;
  }
};

const remover = async (documentoId, assinaturaId, usuario) => {
  const transaction = await sequelize.transaction();
  let imagem = null;

  try {
    const documento = await Documento.findByPk(documentoId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const visita = documento
      ? await Visita.findByPk(documento.visita_id, {
          attributes: ["id", "status"],
          include: [
            { model: Usuario, as: "fiscalizadores", attributes: ["id"], through: { attributes: [] } },
          ],
          transaction,
        })
      : null;

    if (!visita || !podeAcessarVisita(usuario, visita)) {
      await transaction.rollback();
      return null;
    }

    if (documento.url_arquivo_pdf) {
      throw erroValidacao("O PDF do documento já foi gerado; a assinatura não pode ser removida");
    }

    if (visita.status !== "em_andamento") {
      throw erroValidacao("Só é possível remover assinaturas de visitas em andamento");
    }

    const assinatura = await Assinatura.findOne({
      where: { id: assinaturaId, documento_id: documento.id },
      transaction,
    });

    if (!assinatura) {
      await transaction.rollback();
      return null;
    }

    imagem = assinatura.imagem_assinatura_url;
    await assinatura.destroy({ transaction });
    await transaction.commit();

    console.info("Assinatura removida:", {
      documento_id: documento.id,
      assinatura_id: assinatura.id,
      assinante_tipo: assinatura.assinante_tipo,
      removida_por: usuario.id,
      removida_em: new Date().toISOString(),
    });
  } catch (erro) {
    try {
      if (!transaction.finished) await transaction.rollback();
    } catch (erroRollback) {
      console.error("Falha ao desfazer a remoção da assinatura:", erroRollback.message);
    }

    throw erro;
  }

  if (imagem) {
    try {
      await removerImagem({ bucket: getStorageContext().bucket, path: imagem });
    } catch (erro) {
      console.error("Falha ao remover imagem de assinatura órfã:", imagem, erro.message);
    }
  }

  return true;
};

export default {
  registrar,
  remover,
};
