import Sequelize from "sequelize";
import models, { sequelize } from "../models/index.js";
import { getStorageContext } from "../config/supabase.js";
import { podeAcessarVisita } from "../utils/acessoVisita.js";
import erroValidacao from "../utils/erroValidacao.js";
import { validarImagemAssinatura } from "../utils/validarImagemAssinatura.js";
import { enviarDocumentoVisita } from "./emailService.js";
import pdfService from "./pdfService.js";
import questionarioService from "./questionarioService.js";
import { baixarArquivo, removerArquivo, uploadArquivo } from "./storageService.js";

const { Assinatura, Documento, PerguntaQuestionario, RespostaQuestionario, Visita } = models;
const { Op } = Sequelize;

const RESERVA_EMAIL_MS = 10 * 60 * 1000;

export const ENVIO = Object.freeze({
  ENVIADO: "enviado",
  EM_ANDAMENTO: "em_andamento",
  NAO_ENVIADO: "nao_enviado",
});

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

const nomeDoAssinante = (assinatura) =>
  assinatura.assinante_tipo === "denunciado"
    ? `do responsável ${assinatura.assinante_nome}`
    : `do fiscalizador ${assinatura.assinante_nome}`;

const baixarAssinatura = async (assinatura) => {
  let imagem;

  try {
    imagem = await baixarArquivo(referenciaDoArquivo(assinatura.imagem_assinatura_url));
    return validarImagemAssinatura(imagem.toString("base64")).conteudo;
  } catch (erro) {
    const storageIndisponivel =
      erro.name === "StorageConfiguracaoError" ||
      (erro.name === "StorageError" && erro.codigo !== "STORAGE_ARQUIVO_NAO_ENCONTRADO");

    if (imagem === undefined && storageIndisponivel) throw erro;

    const falha = erroValidacao(
      `A assinatura ${nomeDoAssinante(assinatura)} não foi encontrada ou está ilegível. ` +
        "Apague essa assinatura e colete novamente."
    );
    falha.assinatura_id = assinatura.id;
    throw falha;
  }
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

const montarDadosDoPdf = async ({ documento, visita, fiscalizadores, assinaturas }, respostas) => {
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

const carregarContexto = async (documentoId, usuario) => {
  const documento = await Documento.findByPk(documentoId);

  if (!documento) return null;

  const visita = await Visita.findByPk(documento.visita_id);
  const fiscalizadores = await visita.getFiscalizadores({
    attributes: ["id", "nome", "matricula"],
    joinTableAttributes: [],
    order: [["id", "ASC"]],
  });

  if (usuario && !podeAcessarVisita(usuario, { fiscalizadores })) return null;

  const assinaturas = await Assinatura.findAll({ where: { documento_id: documento.id } });

  return { documento, visita, fiscalizadores, assinaturas };
};

const removerPdf = async (arquivo) => {
  await removerArquivo(arquivo).catch((erro) =>
    console.error("Falha ao remover PDF órfão:", arquivo.path, erro.message)
  );
};

const mesmasAssinaturas = (antes, depois) =>
  antes.length === depois.length &&
  antes.every((assinatura) => depois.some((atual) => atual.id === assinatura.id));
const gerarPdfFinal = async (documentoId, usuario) => {
  const contexto = await carregarContexto(documentoId, usuario);

  if (!contexto) return null;

  const { documento, visita, fiscalizadores, assinaturas } = contexto;

  if (documento.url_arquivo_pdf) return { ...contexto, pendentes: [], gerado: false };

  if (visita.status !== "em_andamento") {
    throw erroValidacao("Só é possível finalizar documentos de visitas em andamento");
  }

  const pendentes = listarPendencias(fiscalizadores, assinaturas);

  if (pendentes.length > 0) return { ...contexto, pendentes, gerado: false };

  const respostas = await questionarioService.listarDaVisita(visita.id);
  const pdf = await pdfService.gerarDocumentoVisita(await montarDadosDoPdf(contexto, respostas));
  const arquivo = await uploadArquivo({
    conteudo: pdf,
    contentType: "application/pdf",
    diretorio: `visitas/${visita.id}/documentos`,
  });

  let transaction;

  try {
    transaction = await sequelize.transaction();

    const travado = await Documento.findByPk(documento.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (travado.url_arquivo_pdf) {
      await transaction.rollback();
      await removerPdf(arquivo);
      return { ...contexto, documento: travado, pendentes: [], gerado: false };
    }

    const assinaturasAtuais = await Assinatura.findAll({
      attributes: ["id"],
      where: { documento_id: documento.id },
      transaction,
    });

    if (!mesmasAssinaturas(assinaturas, assinaturasAtuais)) {
      throw erroValidacao("As assinaturas mudaram durante a geração do PDF; tente finalizar novamente");
    }

    const [visitasConcluidas] = await Visita.update(
      { status: "concluida" },
      { where: { id: visita.id, status: "em_andamento" }, transaction }
    );

    if (visitasConcluidas !== 1) {
      throw erroValidacao("Só é possível finalizar documentos de visitas em andamento");
    }

    await travado.update(
      { url_arquivo_pdf: arquivo.path, data_geracao: new Date() },
      { transaction }
    );
    await transaction.commit();

    return { ...contexto, documento: travado, pendentes: [], gerado: true };
  } catch (erro) {
    try {
      if (transaction && !transaction.finished) await transaction.rollback();
    } catch (erroRollback) {
      console.error("Falha ao desfazer a gravação do PDF:", erroRollback.message);
    }

    await removerPdf(arquivo);
    throw erro;
  }
};

const responsavelDoDocumento = (assinaturas) =>
  assinaturas.find((item) => item.assinante_tipo === "denunciado");

const liberarReserva = async (documentoId, reservadoEm) => {
  try {
    await Documento.update(
      { email_enviando_em: null },
      { where: { id: documentoId, email_enviando_em: reservadoEm } }
    );
  } catch (erro) {
    console.error("Falha ao liberar a reserva do e-mail:", documentoId, erro.message);
  }
};

const enviarEmail = async (documentoId) => {
  const documento = await Documento.findByPk(documentoId);

  if (!documento?.url_arquivo_pdf) return ENVIO.NAO_ENVIADO;
  if (documento.enviado_email) return ENVIO.ENVIADO;

  const assinaturas = await Assinatura.findAll({ where: { documento_id: documento.id } });
  const email = responsavelDoDocumento(assinaturas)?.assinante_email;

  if (!email) return ENVIO.NAO_ENVIADO;

  const reservadoEm = new Date();
  const [reservados] = await Documento.update(
    { email_enviando_em: reservadoEm },
    {
      where: {
        id: documento.id,
        enviado_email: false,
        [Op.or]: [
          { email_enviando_em: null },
          { email_enviando_em: { [Op.lt]: new Date(reservadoEm.getTime() - RESERVA_EMAIL_MS) } },
        ],
      },
    }
  );

  if (reservados !== 1) {
    const atual = await Documento.findByPk(documento.id);
    return atual?.enviado_email ? ENVIO.ENVIADO : ENVIO.EM_ANDAMENTO;
  }

  let entregue = false;

  try {
    const visita = await Visita.findByPk(documento.visita_id);
    const pdf = await baixarArquivo(referenciaDoArquivo(documento.url_arquivo_pdf));
    const envio = await enviarDocumentoVisita({
      para: email,
      numero: documento.id,
      estabelecimento: visita.nome_fantasia ?? visita.razao_social ?? visita.denunciado,
      pdf,
    });

    entregue = !envio.redirecionado;
  } catch (erro) {
    console.error("Falha ao enviar o documento por e-mail:", erro.codigo ?? erro.name, erro.message);
  }

  if (!entregue) {
    await liberarReserva(documento.id, reservadoEm);
    return ENVIO.NAO_ENVIADO;
  }

  try {
    await Documento.update(
      { enviado_email: true, email_enviando_em: null },
      { where: { id: documento.id } }
    );
  } catch (erro) {
    console.error("E-mail enviado, mas não foi possível registrar o envio:", documento.id, erro.message);
  }

  return ENVIO.ENVIADO;
};

const finalizar = async (documentoId, { usuario } = {}) => {
  const resultado = await gerarPdfFinal(documentoId, usuario);

  if (!resultado) return null;

  const { documento, pendentes, gerado, assinaturas } = resultado;

  if (pendentes.length > 0) {
    return { situacao: "pendente", documento_id: documento.id, pendentes };
  }

  return {
    situacao: "finalizado",
    documento_id: documento.id,
    pendentes: [],
    pdf_gerado: gerado,
    enviado_email: Boolean(documento.enviado_email),
    email_pendente:
      !documento.enviado_email && Boolean(responsavelDoDocumento(assinaturas)?.assinante_email),
  };
};

export default {
  gerar,
  finalizar,
  enviarEmail,
};
