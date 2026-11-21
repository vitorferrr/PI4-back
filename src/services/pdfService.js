import PDFDocument from "pdfkit";

const gerarPdf = (desenhar, opcoes = {}) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, ...opcoes });
    const partes = [];

    doc.on("data", (parte) => partes.push(parte));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);

    try {
      desenhar(doc);
      doc.end();
    } catch (erro) {
      reject(erro);
    }
  });

const FONTE = "Helvetica";
const FONTE_NEGRITO = "Helvetica-Bold";
const FONTE_ITALICO = "Helvetica-Oblique";
const FUSO_HORARIO = "America/Recife";
const CIDADE_PADRAO = "Jaboatão dos Guararapes/PE";

const ESQUERDA = 70;
const DIREITA = 540;
const LARGURA = DIREITA - ESQUERDA;
const LARGURA_TEXTO = LARGURA - 12;
const TAMANHO_LINHA = 8;
const ESPACO_ENTRE_LINHAS = 14;

const LINHAS_PRIMEIRA_FOLHA = { inicio: 388, quantidade: 18 };
const LINHAS_CONTINUACAO = { inicio: 150, quantidade: 43 };

const TIPOS_DOCUMENTO = [
  { chave: "auto_apreensao", rotulo: "AUTO DE APREENSÃO", x: 80, y: 121 },
  { chave: "auto_deposito", rotulo: "AUTO DE DEPÓSITO", x: 80, y: 139 },
  { chave: "auto_constatacao", rotulo: "AUTO DE CONSTATAÇÃO", x: 215, y: 119 },
  { chave: "relatorio_visita", rotulo: "RELATÓRIO DE VISITA", x: 215, y: 134 },
  { chave: "auto_notificacao", rotulo: "AUTO DE NOTIFICAÇÃO", x: 215, y: 149 },
];

const CAMPOS_ESTABELECIMENTO = [
  { y: 168, campos: [{ rotulo: "RAZÃO SOCIAL", chave: "razao_social", x: 70, ate: 540 }] },
  { y: 194, campos: [{ rotulo: "NOME FANTASIA", chave: "nome_fantasia", x: 70, ate: 540 }] },
  {
    y: 219,
    campos: [
      { rotulo: "ENDEREÇO", chave: "endereco", x: 70, ate: 380 },
      { rotulo: "BAIRRO", chave: "bairro", x: 380, ate: 540 },
    ],
  },
  {
    y: 244,
    campos: [
      { rotulo: "CIDADE/ESTADO", chave: "cidade_estado", x: 70, ate: 380 },
      { rotulo: "TELEFONE", chave: "telefone", x: 380, ate: 540 },
    ],
  },
  {
    y: 269,
    campos: [
      { rotulo: "CNPJ/CPF", chave: "cnpj_cpf", x: 70, ate: 245 },
      { rotulo: "ATIVIDADE", chave: "atividade", x: 245, ate: 410 },
      { rotulo: "CEP", chave: "cep", x: 410, ate: 540 },
    ],
  },
  {
    y: 294,
    campos: [
      { rotulo: "RESPONSÁVEL", chave: "responsavel", x: 70, ate: 345 },
      { rotulo: "CPF/RG/MATRÍCULA", chave: "responsavel_documento", x: 345, ate: 540 },
    ],
  },
];

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_HORARIO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const partesDaData = (valor) => {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;

  const partes = Object.fromEntries(
    FORMATO_DATA.formatToParts(data).map(({ type, value }) => [type, value])
  );
  return {
    dia: partes.day,
    mes: partes.month,
    ano: partes.year,
    hora: partes.hour,
    minuto: partes.minute,
  };
};

const paraBuffer = (imagem) => {
  if (!imagem) return null;
  if (Buffer.isBuffer(imagem)) return imagem;
  return Buffer.from(String(imagem).replace(/^data:image\/\w+;base64,/, ""), "base64");
};

const texto = (valor) => (valor === null || valor === undefined ? "" : String(valor).trim());

const caberNaLargura = (doc, valor, largura) => {
  if (doc.widthOfString(valor) <= largura) return valor;
  let cortado = valor;
  while (cortado && doc.widthOfString(`${cortado}...`) > largura) cortado = cortado.slice(0, -1);
  return `${cortado.trimEnd()}...`;
};

const quebrarPalavraLonga = (doc, palavra, largura, linhas) => {
  let resto = palavra;
  while (doc.widthOfString(resto) > largura) {
    let corte = resto.length - 1;
    while (corte > 1 && doc.widthOfString(resto.slice(0, corte)) > largura) corte -= 1;
    linhas.push(resto.slice(0, corte));
    resto = resto.slice(corte);
  }
  return resto;
};

const quebrarLinhas = (doc, conteudo, largura) => {
  const linhas = [];
  for (const paragrafo of String(conteudo).split(/\r?\n/)) {
    let atual = "";
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (doc.widthOfString(tentativa) <= largura) {
        atual = tentativa;
      } else {
        if (atual) linhas.push(atual);
        atual = quebrarPalavraLonga(doc, palavra, largura, linhas);
      }
    }
    linhas.push(atual);
  }
  return linhas;
};

const montarLinhasDoConteudo = (doc, itens, observacoes) => {
  doc.font(FONTE).fontSize(TAMANHO_LINHA);
  const linhas = [];

  itens.forEach((item, indice) => {
    const resposta = texto(item.resposta) || "Sem resposta";
    linhas.push(
      ...quebrarLinhas(doc, `${indice + 1}. ${texto(item.pergunta)} Resposta: ${resposta}`, LARGURA_TEXTO)
    );
  });

  if (texto(observacoes)) {
    linhas.push(...quebrarLinhas(doc, `Observações: ${texto(observacoes)}`, LARGURA_TEXTO));
  }

  return linhas;
};

const desenharCaixaMarcavel = (doc, x, y, marcada, tamanho = 9) => {
  doc.lineWidth(0.8).rect(x, y, tamanho, tamanho).stroke();
  if (marcada) {
    doc
      .lineWidth(1.2)
      .moveTo(x + 2, y + 2)
      .lineTo(x + tamanho - 2, y + tamanho - 2)
      .moveTo(x + tamanho - 2, y + 2)
      .lineTo(x + 2, y + tamanho - 2)
      .stroke();
  }
  doc.lineWidth(0.8);
};

const desenharCabecalho = (doc, logos) => {
  const logo = paraBuffer(logos.cabecalho);
  if (logo) doc.image(logo, 78, 26, { fit: [105, 82] });

  doc.font(FONTE_NEGRITO).fontSize(10.5);
  doc.text("DIRETORIA DE PROTEÇÃO E DEFESA DO CONSUMIDOR", 190, 60, {
    width: 350,
    align: "center",
    lineBreak: false,
  });
  doc.text("PROCON DO JABOATÃO DOS GUARARAPES", 190, 74, {
    width: 350,
    align: "center",
    lineBreak: false,
  });
};

const desenharRodape = (doc, logos, y = 772) => {
  const logo = paraBuffer(logos.rodape);
  if (logo) doc.image(logo, 75, y, { fit: [170, 42] });

  const opcoes = { width: 250, align: "center", lineBreak: false };
  doc.font(FONTE_NEGRITO).fontSize(8.5).text("Complexo Administrativo", 290, y + 4, opcoes);
  doc.font(FONTE).fontSize(8.5);
  doc.text("Estrada da Batalha 1200 Galpão N - Jardim Jordão,", 290, y + 16, opcoes);
  doc.text("Jaboatão dos Guararapes - PE | CEP: 54.315-570", 290, y + 28, opcoes);
};

const desenharTipoENumero = (doc, tipo, numero) => {
  doc.lineWidth(0.8).rect(ESQUERDA, 113, LARGURA, 52).stroke();
  doc.rect(425, 113, 115, 52).stroke();

  for (const opcao of TIPOS_DOCUMENTO) {
    desenharCaixaMarcavel(doc, opcao.x, opcao.y, opcao.chave === tipo);
    doc
      .font(FONTE_NEGRITO)
      .fontSize(5.5)
      .text(opcao.rotulo, opcao.x + 16, opcao.y + 2.5, { lineBreak: false });
  }

  doc.font(FONTE_NEGRITO).fontSize(12).text("Cont. Nº", 435, 120, { lineBreak: false });
  doc
    .font(FONTE)
    .fontSize(18)
    .text(texto(numero), 425, 140, { width: 115, align: "center", lineBreak: false });
};

const desenharEstabelecimento = (doc, estabelecimento) => {
  const valores = { cidade_estado: CIDADE_PADRAO, ...estabelecimento };

  for (const linha of CAMPOS_ESTABELECIMENTO) {
    for (const campo of linha.campos) {
      const largura = campo.ate - campo.x;
      doc.font(FONTE_NEGRITO).fontSize(8).text(campo.rotulo, campo.x + 2, linha.y + 2, {
        lineBreak: false,
      });
      doc.rect(campo.x, linha.y + 11, largura, 13).stroke();

      doc.font(FONTE).fontSize(8);
      const valor = caberNaLargura(doc, texto(valores[campo.chave]), largura - 6);
      doc.text(valor, campo.x + 3, linha.y + 14.5, { lineBreak: false });
    }
  }
};

const desenharCominacao = (doc, dataRealizacao) => {
  const data = partesDaData(dataRealizacao);
  const preenchido = (valor, vazio) => ({ valor: valor ?? vazio, destaque: Boolean(valor) });
  const trechos = [
    { valor: "Às " },
    preenchido(data && `${data.hora}:${data.minuto}`, "____:____"),
    { valor: " horas do dia " },
    preenchido(data?.dia, "_______"),
    { valor: " do mês " },
    preenchido(data && MESES[Number(data.mes) - 1], "_________________"),
    { valor: " do ano " },
    preenchido(data?.ano, "_______"),
    {
      valor:
        ", no exercício da fiscalização prevista na Lei 8.078, de setembro de 1990, " +
        "regulamentada pelo Decreto nº 2.181, de 20 de março de 1997, verificou-se que " +
        "o(a) autuado(a) praticou a(s) irregularidade(s) abaixo:",
    },
  ];

  doc.font(FONTE_NEGRITO).fontSize(9).text("COMINAÇÃO LEGAL / IRREGULARIDADE(S)", 76, 330, {
    lineBreak: false,
  });

  doc.fontSize(7.5);
  trechos.forEach((trecho, indice) => {
    const opcoes = {
      width: LARGURA_TEXTO,
      continued: indice < trechos.length - 1,
      underline: Boolean(trecho.destaque),
    };
    doc.font(trecho.destaque ? FONTE_NEGRITO : FONTE);
    if (indice === 0) doc.text(trecho.valor, 76, 342, opcoes);
    else doc.text(trecho.valor, opcoes);
  });
};

const desenharLinhasPautadas = (doc, linhas, { inicio, quantidade }) => {
  doc.font(FONTE).fontSize(TAMANHO_LINHA).lineWidth(0.5);
  for (let indice = 0; indice < quantidade; indice += 1) {
    const y = inicio + indice * ESPACO_ENTRE_LINHAS;
    doc.moveTo(ESQUERDA, y).lineTo(DIREITA, y).stroke();
    if (linhas[indice]) doc.text(linhas[indice], 76, y - 9.5, { lineBreak: false });
  }
  doc.lineWidth(0.8);
};

const desenharFolhaDeContinuacao = (doc, temContinuacao) => {
  const y = 640;
  doc.font(FONTE).fontSize(9).text("PREENCHIMENTO DA FOLHA DE CONTINUAÇÃO", 76, y, {
    lineBreak: false,
  });
  desenharCaixaMarcavel(doc, 375, y - 1, temContinuacao);
  doc.font(FONTE_NEGRITO).fontSize(5.5).text("SIM", 389, y + 1.5, { lineBreak: false });
  desenharCaixaMarcavel(doc, 415, y - 1, !temContinuacao);
  doc.text("NÃO", 429, y + 1.5, { lineBreak: false });
};

const desenharAssinatura = (doc, imagem, x, y, largura, altura) => {
  const buffer = paraBuffer(imagem);
  if (buffer) doc.image(buffer, x, y, { fit: [largura, altura], align: "center", valign: "center" });
};

const desenharFiscalizadores = (doc, fiscalizadores, topo, largura, alturaLinha) => {
  const colunas = Math.min(Math.max(fiscalizadores.length, 1), 3);
  const larguraCelula = largura / colunas;

  fiscalizadores.forEach((fiscal, indice) => {
    const x = ESQUERDA + (indice % colunas) * larguraCelula;
    const y = topo + Math.floor(indice / colunas) * alturaLinha;

    const opcoesTexto = { width: larguraCelula - 8, align: "center", lineBreak: false };

    desenharAssinatura(doc, fiscal.assinatura, x + 6, y + 5, larguraCelula - 12, 33);
    doc
      .lineWidth(0.5)
      .moveTo(x + 8, y + 42)
      .lineTo(x + larguraCelula - 8, y + 42)
      .stroke();

    doc.font(FONTE_NEGRITO).fontSize(6.5);
    doc.text(caberNaLargura(doc, texto(fiscal.nome), larguraCelula - 8), x + 4, y + 45, opcoesTexto);
    doc.font(FONTE).fontSize(6);
    doc.text(`Matrícula: ${texto(fiscal.matricula) || "________"}`, x + 4, y + 53, opcoesTexto);
    doc.fontSize(5.5).text("Agente fiscalizador / Matrícula", x + 4, y + 61, opcoesTexto);
  });

  doc.lineWidth(0.8);
  for (let coluna = 1; coluna < colunas; coluna += 1) {
    const x = ESQUERDA + coluna * larguraCelula;
    doc.moveTo(x, topo).lineTo(x, topo + alturaLinha * Math.ceil(fiscalizadores.length / colunas)).stroke();
  }
  for (let linha = 1; linha < Math.ceil(fiscalizadores.length / colunas); linha += 1) {
    const y = topo + linha * alturaLinha;
    doc.moveTo(ESQUERDA, y).lineTo(ESQUERDA + largura, y).stroke();
  }
};

const desenharRecebimento = (doc, recebimento, x, topo, largura, altura) => {
  const data = partesDaData(recebimento.data);
  const dataRecebida = data ? `${data.dia} / ${data.mes} / ${data.ano}` : "_____/_____/______";
  doc.font(FONTE).fontSize(8.5).text(`Recebido em: ${dataRecebida}`, x + 8, topo + 9, {
    lineBreak: false,
  });

  const base = topo + altura;
  if (recebimento.recusou) {
    doc.font(FONTE_ITALICO).fontSize(8.5).text("Recusou-se a assinar", x, base - 42, {
      width: largura,
      align: "center",
      lineBreak: false,
    });
  } else {
    desenharAssinatura(doc, recebimento.assinatura, x + 8, topo + 22, largura - 16, base - topo - 50);
  }

  doc
    .lineWidth(0.5)
    .moveTo(x + 10, base - 24)
    .lineTo(x + largura - 10, base - 24)
    .stroke();
  doc.font(FONTE_NEGRITO).fontSize(6.5);
  doc.text(caberNaLargura(doc, texto(recebimento.nome), largura - 8), x + 4, base - 21, {
    width: largura - 8,
    align: "center",
    lineBreak: false,
  });
  doc.font(FONTE).fontSize(6).text("Responsável pelo estabelecimento", x + 4, base - 11, {
    width: largura - 8,
    align: "center",
    lineBreak: false,
  });
  doc.lineWidth(0.8);
};

const desenharAutenticacao = (doc, fiscalizadores, recebimento) => {
  const topo = 682;
  const alturaLinha = 70;
  const linhas = Math.max(Math.ceil(fiscalizadores.length / 3), 1);
  const altura = alturaLinha * linhas;
  const divisao = 354;

  doc.font(FONTE).fontSize(10).text("AUTENTICAÇÃO", 72, topo - 14, { lineBreak: false });
  doc.lineWidth(0.8).rect(ESQUERDA, topo, LARGURA, altura).stroke();
  doc.moveTo(divisao, topo).lineTo(divisao, topo + altura).stroke();

  const assinantes = fiscalizadores.length ? fiscalizadores : [{}];
  desenharFiscalizadores(doc, assinantes, topo, divisao - ESQUERDA, alturaLinha);
  desenharRecebimento(doc, recebimento, divisao, topo, DIREITA - divisao, altura);

  return topo + altura;
};

const desenharContinuacao = (doc, { numero, linhas, folha, totalFolhas, logos }) => {
  doc.addPage();
  desenharCabecalho(doc, logos);

  doc.font(FONTE_NEGRITO).fontSize(11).text("FOLHA DE CONTINUAÇÃO", ESQUERDA, 116, {
    lineBreak: false,
  });
  doc.fontSize(9).text(`Cont. Nº ${texto(numero)}  |  Folha ${folha} de ${totalFolhas}`, 300, 118, {
    width: 240,
    align: "right",
    lineBreak: false,
  });

  doc.lineWidth(0.8).rect(ESQUERDA, 132, LARGURA, 630).stroke();
  desenharLinhasPautadas(doc, linhas, LINHAS_CONTINUACAO);
  desenharRodape(doc, logos);
};

const dividirEmFolhas = (linhas) => {
  const folhas = [linhas.slice(0, LINHAS_PRIMEIRA_FOLHA.quantidade)];
  for (
    let inicio = LINHAS_PRIMEIRA_FOLHA.quantidade;
    inicio < linhas.length;
    inicio += LINHAS_CONTINUACAO.quantidade
  ) {
    folhas.push(linhas.slice(inicio, inicio + LINHAS_CONTINUACAO.quantidade));
  }
  return folhas;
};

const desenharDocumentoVisita = (doc, dados) => {
  const {
    numero,
    tipo = "relatorio_visita",
    estabelecimento = {},
    dataRealizacao,
    itens = [],
    observacoes,
    fiscalizadores = [],
    recebimento = {},
    logos = {},
  } = dados;

  if (!TIPOS_DOCUMENTO.some((opcao) => opcao.chave === tipo)) {
    throw new Error(`Tipo de documento inválido: ${tipo}`);
  }

  const folhas = dividirEmFolhas(montarLinhasDoConteudo(doc, itens, observacoes));

  desenharCabecalho(doc, logos);
  desenharTipoENumero(doc, tipo, numero);
  desenharEstabelecimento(doc, estabelecimento);

  doc.lineWidth(0.8).rect(ESQUERDA, 325, LARGURA, 330).stroke();
  desenharCominacao(doc, dataRealizacao);
  desenharLinhasPautadas(doc, folhas[0], LINHAS_PRIMEIRA_FOLHA);
  desenharFolhaDeContinuacao(doc, folhas.length > 1);

  const fimAutenticacao = desenharAutenticacao(doc, fiscalizadores, recebimento);
  desenharRodape(doc, logos, Math.max(772, fimAutenticacao + 10));

  folhas.slice(1).forEach((linhas, indice) => {
    desenharContinuacao(doc, {
      numero,
      linhas,
      folha: indice + 2,
      totalFolhas: folhas.length,
      logos,
    });
  });
};

const gerarDocumentoVisita = (dados) =>
  gerarPdf((doc) => desenharDocumentoVisita(doc, dados), {
    margin: 0,
    info: { Title: `Documento de fiscalização Nº ${texto(dados?.numero)}` },
  });

export default {
  gerarPdf,
  gerarDocumentoVisita,
};
