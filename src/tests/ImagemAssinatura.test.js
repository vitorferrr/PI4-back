import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import {
  validarImagemAssinatura,
  TAMANHO_MAXIMO_ASSINATURA,
  DIMENSAO_MAXIMA_ASSINATURA,
} from "../utils/validarImagemAssinatura.js";

const gerarPng = (largura = 2, altura = 3) => {
  const imagem = new PNG({ width: largura, height: altura });
  imagem.data.fill(255);
  return PNG.sync.write(imagem);
};

// Auxiliar para construir arquivos adversariais com CRC correto nos testes.
const criarChunk = (tipo, dados = Buffer.alloc(0)) => {
  const chunk = Buffer.alloc(dados.length + 12);
  chunk.writeUInt32BE(dados.length, 0);
  chunk.write(tipo, 4, "ascii");
  dados.copy(chunk, 8);
  let crc = -1;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ -1) >>> 0, chunk.length - 4);
  return chunk;
};

const trocarCabecalho = (imagem, alterar) => {
  const dados = Buffer.from(imagem.subarray(16, 29));
  alterar(dados);
  return Buffer.concat([imagem.subarray(0, 8), criarChunk("IHDR", dados), imagem.subarray(33)]);
};

const pngValido = gerarPng();
const base64Valido = pngValido.toString("base64");

afterEach(() => vi.restoreAllMocks());

describe("validarImagemAssinatura", () => {
  it.each([base64Valido, `data:image/png;base64,${base64Valido}`])("valida PNG e retorna conteúdo e metadados", (entrada) => {
    const resultado = validarImagemAssinatura(entrada);
    expect(resultado).toEqual({
      conteudo: pngValido,
      contentType: "image/png",
      largura: 2,
      altura: 3,
      tamanho: pngValido.length,
    });
    expect(Buffer.isBuffer(resultado.conteudo)).toBe(true);
  });

  it.each([undefined, null, 42, Buffer.from("imagem"), "", "data:image/png;base64,"])("rejeita entrada vazia ou de tipo incorreto", (entrada) => {
    expect(() => validarImagemAssinatura(entrada)).toThrow(expect.objectContaining({ name: "ValidacaoError" }));
  });

  it.each([
    "%%%?", "a", "AAAA=", "AAAA===", "a===", "AA=A", "AAAA\n", " AA==",
    "AB==", "AAB=", "data:image/jpeg;base64,AAAA", "data:image/png;charset=utf-8;base64,AAAA",
  ])("rejeita Base64 inválido, não canônico ou prefixo incompatível: %s", (entrada) => {
    const decodificar = vi.spyOn(PNG.sync, "read");
    expect(() => validarImagemAssinatura(entrada)).toThrow(expect.objectContaining({ name: "ValidacaoError" }));
    expect(decodificar).not.toHaveBeenCalled();
  });

  it("rejeita outros arquivos mesmo com prefixo PNG", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(60)]).toString("base64");
    expect(() => validarImagemAssinatura(`data:image/png;base64,${jpeg}`)).toThrow(/PNG íntegra/);
  });

  it("rejeita Base64 muito grande antes de decodificar PNG", () => {
    const decodificar = vi.spyOn(PNG.sync, "read");
    const entrada = "A".repeat(4 * Math.ceil(TAMANHO_MAXIMO_ASSINATURA / 3) + 24);
    expect(() => validarImagemAssinatura(entrada)).toThrow(/2 MiB/);
    expect(decodificar).not.toHaveBeenCalled();
  });

  it("verifica o tamanho binário, inclusive quando o comprimento Base64 cabe no limite", () => {
    const entrada = Buffer.alloc(TAMANHO_MAXIMO_ASSINATURA + 1).toString("base64");
    const decodificar = vi.spyOn(PNG.sync, "read");
    expect(() => validarImagemAssinatura(entrada)).toThrow(/2 MiB/);
    expect(decodificar).not.toHaveBeenCalled();
  });

  it.each([
    [DIMENSAO_MAXIMA_ASSINATURA + 1, 3], [2, DIMENSAO_MAXIMA_ASSINATURA + 1], [0, 3], [2, 0], [0xffffffff, 3],
  ])("rejeita dimensões %s x %s antes de descomprimir ou alocar bitmap", (largura, altura) => {
    const imagem = trocarCabecalho(pngValido, (dados) => {
      dados.writeUInt32BE(largura, 0);
      dados.writeUInt32BE(altura, 4);
    });
    const decodificar = vi.spyOn(PNG.sync, "read");
    // Arquivo só com cabeçalho e IEND: dimensões devem falhar antes mesmo de procurar IDAT.
    const somenteCabecalho = Buffer.concat([imagem.subarray(0, 33), criarChunk("IEND")]);
    expect(() => validarImagemAssinatura(somenteCabecalho.toString("base64"))).toThrow(/dimensões/);
    expect(decodificar).not.toHaveBeenCalled();
  });

  it("aceita um eixo exatamente no limite", () => {
    expect(validarImagemAssinatura(gerarPng(DIMENSAO_MAXIMA_ASSINATURA, 1).toString("base64")).largura).toBe(4096);
  });

  it("rejeita arquivo truncado", () => {
    expect(() => validarImagemAssinatura(pngValido.subarray(0, -4).toString("base64"))).toThrow(/PNG íntegra/);
  });

  it("valida PNG com paleta e transparência", () => {
    const cabecalho = trocarCabecalho(gerarPng(1, 1), (dados) => { dados[9] = 3; });
    const indexado = Buffer.concat([
      cabecalho.subarray(0, 33), criarChunk("PLTE", Buffer.from([0, 0, 0])),
      criarChunk("tRNS", Buffer.from([255])), criarChunk("IDAT", deflateSync(Buffer.from([0, 0]))), criarChunk("IEND"),
    ]);
    expect(validarImagemAssinatura(indexado.toString("base64"))).toEqual(expect.objectContaining({ largura: 1, altura: 1 }));
  });

  it.each([Buffer.alloc(0), Buffer.alloc(771), Buffer.alloc(4)])("rejeita paleta fora dos limites PNG antes de alocar suas entradas", (dados) => {
    const cabecalho = trocarCabecalho(pngValido, (ihdr) => { ihdr[9] = 2; });
    const adulterado = Buffer.concat([cabecalho.subarray(0, 33), criarChunk("PLTE", dados), cabecalho.subarray(33)]);
    const decoder = vi.spyOn(PNG.sync, "read");
    expect(() => validarImagemAssinatura(adulterado.toString("base64"))).toThrow(/PNG íntegra/);
    expect(decoder).not.toHaveBeenCalled();
  });

  it.each(["duplicada", "depois de IDAT"])("rejeita paleta %s antes do decoder", (caso) => {
    const cabecalho = trocarCabecalho(pngValido, (dados) => { dados[9] = 2; });
    const paleta = criarChunk("PLTE", Buffer.from([0, 0, 0]));
    const adulterado = caso === "duplicada"
      ? Buffer.concat([cabecalho.subarray(0, 33), paleta, paleta, cabecalho.subarray(33)])
      : Buffer.concat([cabecalho.subarray(0, -12), paleta, criarChunk("IEND")]);
    const decoder = vi.spyOn(PNG.sync, "read");
    expect(() => validarImagemAssinatura(adulterado.toString("base64"))).toThrow(/PNG íntegra/);
    expect(decoder).not.toHaveBeenCalled();
  });

  it("rejeita tRNS incompatível com PNG que já possui canal alpha", () => {
    const adulterado = Buffer.concat([pngValido.subarray(0, 33), criarChunk("tRNS", Buffer.from([255])), pngValido.subarray(33)]);
    const decoder = vi.spyOn(PNG.sync, "read");
    expect(() => validarImagemAssinatura(adulterado.toString("base64"))).toThrow(/PNG íntegra/);
    expect(decoder).not.toHaveBeenCalled();
  });

  it("valida PNG Adam7 de um pixel", () => {
    const interlacado = trocarCabecalho(gerarPng(1, 1), (dados) => { dados[12] = 1; });
    expect(validarImagemAssinatura(interlacado.toString("base64"))).toEqual(expect.objectContaining({ largura: 1, altura: 1 }));
  });

  it("rejeita CRC corrompido", () => {
    const corrompido = Buffer.from(pngValido);
    corrompido[32] ^= 1;
    expect(() => validarImagemAssinatura(corrompido.toString("base64"))).toThrow(/PNG íntegra/);
  });

  it("rejeita conteúdo comprimido inválido mesmo com CRC válido", () => {
    const invalido = Buffer.concat([
      pngValido.subarray(0, 33), criarChunk("IDAT", Buffer.from("não é zlib")), criarChunk("IEND"),
    ]);
    expect(() => validarImagemAssinatura(invalido.toString("base64"))).toThrow(/PNG íntegra/);
  });

  it("rejeita checksum zlib corrompido mesmo com CRC de chunk correto", () => {
    const dados = deflateSync(Buffer.alloc(27));
    dados[dados.length - 1] ^= 1;
    const adulterado = Buffer.concat([pngValido.subarray(0, 33), criarChunk("IDAT", dados), criarChunk("IEND")]);
    expect(() => validarImagemAssinatura(adulterado.toString("base64"))).toThrow(/PNG íntegra/);
  });

  it("rejeita pixels com filtro PNG inválido mesmo com zlib e CRC corretos", () => {
    const dados = Buffer.alloc(27);
    dados[0] = 5;
    const adulterado = Buffer.concat([pngValido.subarray(0, 33), criarChunk("IDAT", deflateSync(dados)), criarChunk("IEND")]);
    expect(() => validarImagemAssinatura(adulterado.toString("base64"))).toThrow(/PNG íntegra/);
  });

  it("bloqueia expansão maior do que o tamanho declarado antes do decoder", () => {
    const bomba = Buffer.concat([
      pngValido.subarray(0, 33), criarChunk("IDAT", deflateSync(Buffer.alloc(1024 * 1024))), criarChunk("IEND"),
    ]);
    const decodificar = vi.spyOn(PNG.sync, "read");
    expect(() => validarImagemAssinatura(bomba.toString("base64"))).toThrow(/PNG íntegra/);
    expect(decodificar).not.toHaveBeenCalled();
  });

  it("limita também a descompressão de PNG interlaçado", () => {
    const cabecalho = trocarCabecalho(pngValido, (dados) => { dados[12] = 1; });
    const bomba = Buffer.concat([
      cabecalho.subarray(0, 33), criarChunk("IDAT", deflateSync(Buffer.alloc(1024 * 1024))), criarChunk("IEND"),
    ]);
    const decoder = vi.spyOn(PNG.sync, "read");
    expect(() => validarImagemAssinatura(bomba.toString("base64"))).toThrow(/PNG íntegra/);
    expect(decoder).not.toHaveBeenCalled();
  });

  it("rejeita segundo IHDR para impedir mudança de dimensões após a checagem", () => {
    const adulterado = Buffer.concat([
      pngValido.subarray(0, 33), pngValido.subarray(8, 33), pngValido.subarray(33),
    ]);
    expect(() => validarImagemAssinatura(adulterado.toString("base64"))).toThrow(/PNG íntegra/);
  });

  it("rejeita bytes extras após IEND", () => {
    const adulterado = Buffer.concat([pngValido, Buffer.from("dados adicionais")]);
    expect(() => validarImagemAssinatura(adulterado.toString("base64"))).toThrow(/PNG íntegra/);
  });

  it("rejeita PNG animado", () => {
    const animado = Buffer.concat([
      pngValido.subarray(0, 33), criarChunk("acTL", Buffer.alloc(8)), pngValido.subarray(33),
    ]);
    expect(() => validarImagemAssinatura(animado.toString("base64"))).toThrow(/estática/);
  });

  it("verifica CRC também nos chunks auxiliares", () => {
    const auxiliar = criarChunk("tEXt", Buffer.from("nota\0teste"));
    auxiliar[auxiliar.length - 1] ^= 1;
    const adulterado = Buffer.concat([pngValido.subarray(0, 33), auxiliar, pngValido.subarray(33)]);
    expect(() => validarImagemAssinatura(adulterado.toString("base64"))).toThrow(/PNG íntegra/);
  });

  it("rejeita combinação inválida de profundidade e cor", () => {
    const invalido = trocarCabecalho(pngValido, (dados) => { dados[8] = 1; });
    expect(() => validarImagemAssinatura(invalido.toString("base64"))).toThrow(/PNG íntegra/);
  });

  it("preserva mensagens controladas sem incluir entrada nem erro interno", () => {
    vi.spyOn(PNG.sync, "read").mockImplementation(() => { throw new Error("segredo do decoder"); });
    try {
      validarImagemAssinatura(base64Valido);
      expect.fail("Deveria rejeitar o decoder");
    } catch (erro) {
      expect(erro.name).toBe("ValidacaoError");
      expect(erro.message).not.toContain("segredo");
      expect(erro.message).not.toContain(base64Valido);
      expect(erro.cause).toBeUndefined();
    }
  });
});
