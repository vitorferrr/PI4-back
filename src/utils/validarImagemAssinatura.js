import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";

export const TAMANHO_MAXIMO_ASSINATURA = 2 * 1024 * 1024;
export const DIMENSAO_MAXIMA_ASSINATURA = 4096;

const PREFIXO_DATA_URL = "data:image/png;base64,";
const ASSINATURA_PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CANAIS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PROFUNDIDADES = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
// Origem (x,y) e passo (x,y) das sete passagens Adam7.
const PASSAGENS_ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
  [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
];
const TABELA_CRC = Array.from({ length: 256 }, (_, valor) => {
  for (let bit = 0; bit < 8; bit++) {
    valor = valor & 1 ? 0xedb88320 ^ (valor >>> 1) : valor >>> 1;
  }
  return valor >>> 0;
});

const invalida = (mensagem = "A assinatura deve conter uma imagem PNG íntegra.") => {
  const erro = new Error(mensagem);
  erro.name = "ValidacaoError";
  return erro;
};

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TABELA_CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const tamanhoDescomprimido = (largura, altura, bitsPorPixel, interlace) => {
  const passagens = interlace ? PASSAGENS_ADAM7 : [[0, 0, 1, 1]];
  return passagens.reduce((total, [x, y, passoX, passoY]) => {
    const colunas = Math.max(0, Math.ceil((largura - x) / passoX));
    const linhas = Math.max(0, Math.ceil((altura - y) / passoY));
    return total + (colunas && linhas ? (Math.ceil(colunas * bitsPorPixel / 8) + 1) * linhas : 0);
  }, 0);
};

// Faz as verificações de estrutura e recursos antes de alocar o bitmap do pngjs.
const inspecionarPng = (conteudo) => {
  if (conteudo.length < 45 || !conteudo.subarray(0, 8).equals(ASSINATURA_PNG)) throw invalida();

  let cabecalho;
  let terminou = false;
  let dadosEncerrados = false;
  let entradasPaleta = 0;
  let transparencia = false;
  const dadosImagem = [];

  for (let posicao = 8; posicao < conteudo.length;) {
    if (posicao + 12 > conteudo.length) throw invalida();
    const tamanho = conteudo.readUInt32BE(posicao);
    const fim = posicao + 12 + tamanho;
    if (fim > conteudo.length) throw invalida();

    const tipo = conteudo.toString("latin1", posicao + 4, posicao + 8);
    const dados = conteudo.subarray(posicao + 8, fim - 4);
    if (!/^[A-Za-z]{4}$/.test(tipo) || (conteudo[posicao + 6] & 32)) throw invalida();
    if (crc32(conteudo.subarray(posicao + 4, fim - 4)) !== conteudo.readUInt32BE(fim - 4)) throw invalida();

    if (!cabecalho && tipo !== "IHDR") throw invalida();
    if (tipo === "IHDR") {
      if (cabecalho || tamanho !== 13) throw invalida();
      const largura = dados.readUInt32BE(0);
      const altura = dados.readUInt32BE(4);
      if (!largura || !altura || largura > DIMENSAO_MAXIMA_ASSINATURA || altura > DIMENSAO_MAXIMA_ASSINATURA) {
        throw invalida(`A assinatura deve ter dimensões entre 1 e ${DIMENSAO_MAXIMA_ASSINATURA} pixels por eixo.`);
      }
      const profundidade = dados[8];
      const cor = dados[9];
      if (!PROFUNDIDADES[cor]?.includes(profundidade) || dados[10] !== 0 || dados[11] !== 0 || dados[12] > 1) throw invalida();
      cabecalho = {
        largura,
        altura,
        cor,
        profundidade,
        tamanhoEsperado: tamanhoDescomprimido(largura, altura, CANAIS[cor] * profundidade, dados[12]),
      };
    } else if (tipo === "IDAT") {
      if (dadosEncerrados || (cabecalho.cor === 3 && !entradasPaleta)) throw invalida();
      dadosImagem.push(dados);
    } else {
      if (dadosImagem.length) dadosEncerrados = true;
      if (tipo === "PLTE") {
        // pngjs cria um array para cada entrada: limite a paleta antes do decoder.
        if (entradasPaleta || transparencia || dadosImagem.length || ![2, 3, 6].includes(cabecalho.cor) ||
            !tamanho || tamanho > 768 || tamanho % 3 !== 0 ||
            (cabecalho.cor === 3 && tamanho / 3 > 2 ** cabecalho.profundidade)) throw invalida();
        entradasPaleta = tamanho / 3;
      } else if (tipo === "tRNS") {
        const tamanhoValido = (cabecalho.cor === 0 && tamanho === 2) ||
          (cabecalho.cor === 2 && tamanho === 6) ||
          (cabecalho.cor === 3 && tamanho > 0 && tamanho <= entradasPaleta);
        if (transparencia || dadosImagem.length || !tamanhoValido) throw invalida();
        transparencia = true;
      } else if (tipo === "IEND") {
        if (tamanho !== 0 || !dadosImagem.length || fim !== conteudo.length) throw invalida();
        terminou = true;
      } else if (["acTL", "fcTL", "fdAT"].includes(tipo)) {
        throw invalida("A assinatura deve ser uma imagem PNG estática.");
      } else if (!(conteudo[posicao + 4] & 32) && tipo !== "PLTE") {
        throw invalida();
      }
    }
    posicao = fim;
  }

  if (!terminou) throw invalida();
  // O limite impede bombas de descompressão, inclusive em imagens interlaçadas.
  const dadosComprimidos = Buffer.concat(dadosImagem);
  const { buffer: descomprimido, engine } = inflateSync(dadosComprimidos, {
    maxOutputLength: cabecalho.tamanhoEsperado,
    info: true,
  });
  if (descomprimido.length !== cabecalho.tamanhoEsperado || engine.bytesWritten !== dadosComprimidos.length) throw invalida();
  return cabecalho;
};

/** Aceita Base64 canônico com padding ou Data URL exata data:image/png;base64,... */
export const validarImagemAssinatura = (imagem) => {
  if (typeof imagem !== "string" || !imagem.length) throw invalida("A imagem da assinatura é obrigatória.");

  // Verifica o comprimento antes de regex, decodificação e descompressão.
  const tamanhoMaximoBase64 = 4 * Math.ceil(TAMANHO_MAXIMO_ASSINATURA / 3);
  if (imagem.length > tamanhoMaximoBase64 + PREFIXO_DATA_URL.length) throw invalida("A assinatura deve ter no máximo 2 MiB.");
  const base64 = imagem.startsWith(PREFIXO_DATA_URL) ? imagem.slice(PREFIXO_DATA_URL.length) : imagem;
  if (!base64.length) throw invalida("A imagem da assinatura é obrigatória.");
  if (base64.length > tamanhoMaximoBase64) throw invalida("A assinatura deve ter no máximo 2 MiB.");
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw invalida("A imagem da assinatura deve usar Base64 válido ou Data URL PNG.");

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if (base64.length / 4 * 3 - padding > TAMANHO_MAXIMO_ASSINATURA) throw invalida("A assinatura deve ter no máximo 2 MiB.");
  const conteudo = Buffer.from(base64, "base64");
  if (conteudo.toString("base64") !== base64) throw invalida("A imagem da assinatura deve usar Base64 canônico.");

  try {
    const { largura, altura } = inspecionarPng(conteudo);
    PNG.sync.read(conteudo, { checkCRC: true });
    return { conteudo, contentType: "image/png", largura, altura, tamanho: conteudo.length };
  } catch (erro) {
    if (erro.name === "ValidacaoError") throw erro;
    throw invalida();
  }
};
