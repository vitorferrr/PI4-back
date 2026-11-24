import models, { sequelize } from "../models/index.js";
import { getStorageContext } from "../config/supabase.js";
import { podeAcessarVisita } from "../utils/acessoVisita.js";
import erroValidacao from "../utils/erroValidacao.js";
import { validarImagemAssinatura } from "../utils/validarImagemAssinatura.js";
import { enviarDocumentoVisita } from "./emailService.js";
import pdfService from "./pdfService.js";
import { baixarArquivo, removerArquivo, uploadArquivo } from "./storageService.js";

const { Assinatura, Documento, PerguntaQuestionario, RespostaQuestionario, Visita } = models;

const buscarPerguntasSemResposta = async (visitaId, transaction) => {
  const perguntas = await PerguntaQuestionario.findAll({
    attributes: ["id"],
    order: [["ordem", "ASC"]],
    transaction,
  });
  const respostas = await RespostaQuestionario.findAll({
    attributes: ["pergunta_id"],
    where: { visita_id: visitaId },
    transaction,
  });
  const respondidas = new Set(respostas.map((resposta) => resposta.pergunta_id));

  return perguntas
    .filter((pergunta) => !respondidas.has(pergunta.id))
    .map((pergunta) => pergunta.id);
};

const gerar = async (visitaId) => {
  const transaction = await sequelize.transaction();

  try {
    const visita = await Visita.findByPk(visitaId, {
      attributes: ["id", "status"],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!visita) {
      await transaction.rollback();
      return null;
    }

    const existente = await Documento.findOne({ where: { visita_id: visitaId }, transaction });

    if (existente) {
      await transaction.commit();
      return { documento: existente, criado: false };
    }

    if (visita.status !== "em_andamento") {
      throw erroValidacao("Só é possível gerar o documento de visitas em andamento");
    }

    const pendentes = await buscarPerguntasSemResposta(visitaId, transaction);

    if (pendentes.length > 0) {
      throw erroValidacao(
        "Responda todas as perguntas antes de gerar o documento",
        pendentes.map((id) => `A pergunta ${id} não foi respondida`)
      );
    }

    const documento = await Documento.create(
      {
        visita_id: visitaId,
        url_arquivo_pdf: null,
        data_geracao: new Date(),
        enviado_email: false,
      },
      { transaction }
    );

    await transaction.commit();

    return { documento, criado: true };
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }
};

const referenciaDoArquivo = (path) => ({ bucket: getStorageContext().bucket, path });

const baixarAssinatura = async ({ imagem_assinatura_url: path }) => {
  const imagem = await baixarArquivo(referenciaDoArquivo(path));

  return validarImagemAssinatura(imagem.toString("base64")).conteudo;
};

const listarPendencias = (fiscalizadores, assinaturas) => {
  const assinaram = new Set(assinaturas.map((assinatura) => assinatura.usuario_id));
  const pendentes = fiscalizadores
    .filter((fiscal) => !assinaram.has(fiscal.id))
    .map((fiscal) => `Assinatura do fiscalizador ${fiscal.nome}`);

  if (fiscalizadores.length === 0) pendentes.push("Nenhum fiscalizador vinculado à visita");
  if (!assinaturas.some((assinatura) => assinatura.assinante_tipo === "denunciado")) {
    pendentes.push("Assinatura ou recusa do responsável");
  }

  return pendentes;
};

const montarDadosDoPdf = async (documento, visita, fiscalizadores, assinaturas, respostas) => {
  const responsavel = assinaturas.find((item) => item.assinante_tipo === "denunciado");
  const assinaturaDoFiscal = (id) => assinaturas.find((item) => item.usuario_id === id);
  const imagensFiscais = await Promise.all(
    fiscalizadores.map((fiscal) => baixarAssinatura(assinaturaDoFiscal(fiscal.id)))
  );
  const imagemResponsavel = responsavel.recusou ? null : await baixarAssinatura(responsavel);

  return {
    numero: documento.id,
    tipo: "relatorio_visita",
    estabelecimento: {
      razao_social: visita.razao_social ?? visita.denunciado,
      nome_fantasia: visita.nome_fantasia,
      endereco: visita.endereco,
      bairro: visita.bairro,
      cep: visita.cep,
      telefone: visita.telefone,
      cnpj_cpf: visita.cnpj_cpf,
      atividade: visita.atividade,
      responsavel: responsavel.assinante_nome,
      responsavel_documento: responsavel.assinante_documento,
    },
    dataRealizacao: visita.data_realizacao,
    itens: respostas.map((item) => ({ pergunta: item.pergunta?.texto, resposta: item.resposta })),
    observacoes: visita.observacoes_livres,
    fiscalizadores: fiscalizadores.map((fiscal, indice) => ({
      nome: fiscal.nome,
      matricula: fiscal.matricula,
      assinatura: imagensFiscais[indice],
    })),
    recebimento: {
      nome: responsavel.assinante_nome,
      data: responsavel.data_assinatura,
      recusou: responsavel.recusou,
      assinatura: imagemResponsavel,
    },
    exigirAssinaturas: true,
  };
};

const gerarPdfFinal = async (documentoId, usuario) => {
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

    const assinaturas = await Assinatura.findAll({
      where: { documento_id: documento.id },
      transaction,
    });
    const visita = await Visita.findByPk(documento.visita_id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const fiscalizadores = await visita.getFiscalizadores({
      attributes: ["id", "nome", "matricula"],
      joinTableAttributes: [],
      order: [["id", "ASC"]],
      transaction,
    });

    if (usuario && !podeAcessarVisita(usuario, { fiscalizadores })) {
      await transaction.rollback();
      return null;
    }

    if (documento.url_arquivo_pdf) {
      await transaction.commit();
      return { documento, visita, assinaturas, pendentes: [], gerado: false };
    }

    if (visita.status !== "em_andamento") {
      throw erroValidacao("Só é possível finalizar documentos de visitas em andamento");
    }

    const pendentes = listarPendencias(fiscalizadores, assinaturas);

    if (pendentes.length > 0) {
      await transaction.commit();
      return { documento, visita, assinaturas, pendentes, gerado: false };
    }

    const respostas = await RespostaQuestionario.findAll({
      where: { visita_id: visita.id },
      include: [{ model: PerguntaQuestionario, as: "pergunta", attributes: ["texto", "ordem"] }],
      order: [[{ model: PerguntaQuestionario, as: "pergunta" }, "ordem", "ASC"]],
      transaction,
    });
    const dadosPdf = await montarDadosDoPdf(documento, visita, fiscalizadores, assinaturas, respostas);
    const pdf = await pdfService.gerarDocumentoVisita(dadosPdf);

    arquivo = await uploadArquivo({
      conteudo: pdf,
      contentType: "application/pdf",
      diretorio: `visitas/${visita.id}/documentos`,
    });

    await documento.update(
      { url_arquivo_pdf: arquivo.path, data_geracao: new Date() },
      { transaction }
    );
    await Visita.update({ status: "concluida" }, { where: { id: visita.id }, transaction });
    await transaction.commit();

    return { documento, visita, assinaturas, pendentes: [], gerado: true, pdf };
  } catch (erro) {
    if (!transaction.finished) await transaction.rollback();

    if (arquivo) {
      await removerArquivo(arquivo).catch((erroRemocao) =>
        console.error("Falha ao remover PDF órfão:", erroRemocao.codigo)
      );
    }

    throw erro;
  }
};

// Falha de e-mail não desfaz o PDF: enviado_email fica false e o envio pode ser repetido.
// E-mail desviado para EMAIL_DESTINO_TESTE não conta como entregue ao responsável.
const enviarAoResponsavel = async ({ documento, visita, assinaturas, pdf }) => {
  const responsavel = assinaturas.find((item) => item.assinante_tipo === "denunciado");

  if (!responsavel?.assinante_email) return false;

  try {
    const conteudo = pdf ?? (await baixarArquivo(referenciaDoArquivo(documento.url_arquivo_pdf)));
    const envio = await enviarDocumentoVisita({
      para: responsavel.assinante_email,
      numero: documento.id,
      estabelecimento: visita.nome_fantasia ?? visita.razao_social ?? visita.denunciado,
      pdf: conteudo,
    });

    if (envio.redirecionado) return false;

    await documento.update({ enviado_email: true });
    return true;
  } catch (erro) {
    console.error("Falha ao enviar o documento por e-mail:", erro.codigo ?? erro.name);
    return false;
  }
};

const finalizar = async (documentoId, { reenviarEmail = false, usuario } = {}) => {
  const resultado = await gerarPdfFinal(documentoId, usuario);

  if (!resultado) return null;

  const { documento, pendentes, gerado } = resultado;

  if (pendentes.length > 0) {
    return { situacao: "pendente", documento_id: documento.id, pendentes };
  }

  const deveEnviar = gerado || (reenviarEmail && !documento.enviado_email);
  const enviadoEmail = deveEnviar
    ? await enviarAoResponsavel(resultado)
    : Boolean(documento.enviado_email);

  return {
    situacao: "finalizado",
    documento_id: documento.id,
    pendentes: [],
    pdf_gerado: gerado,
    enviado_email: enviadoEmail,
  };
};

export default {
  gerar,
  finalizar,
};
