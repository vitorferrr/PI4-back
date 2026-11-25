import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStorageContext } from "../config/supabase.js";
import storageService, { baixarArquivo, gerarUrlAssinada, removerArquivo, uploadArquivo } from "../services/storageService.js";
import tratarErro from "../utils/tratarErro.js";
import { validarImagemAssinatura } from "../utils/validarImagemAssinatura.js";

vi.mock("../config/supabase.js", () => ({ getStorageContext: vi.fn() }));

const download = vi.fn(), createSignedUrl = vi.fn(), getBucket = vi.fn(), upload = vi.fn();
const from = vi.fn();
const ref = { bucket: "documentos", path: "assinaturas/testes/imagem.png" };
const arquivo = { conteudo: Buffer.from("bytes validados"), contentType: "image/png", diretorio: "assinaturas" };
const bytes = Buffer.from([137, 80, 78, 71, 0, 255]);
let client;

beforeEach(() => {
  vi.resetAllMocks();
  client = { storage: { from, getBucket } };
  getStorageContext.mockReturnValue({ client, bucket: "documentos" });
  getBucket.mockResolvedValue({ data: { id: "documentos", public: false }, error: null });
  from.mockReturnValue({ download, createSignedUrl, upload });
  download.mockResolvedValue({ data: new Blob([bytes]), error: null });
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://projeto.supabase.co/storage/v1/object/sign/arquivo?token=temporario" }, error: null });
  upload.mockImplementation(async (path) => ({ data: { path }, error: null }));
});
afterEach(() => vi.restoreAllMocks());

describe("leitura privada", () => {
  it("baixa somente o objeto solicitado e converte Blob para Buffer", async () => {
    const resultado = await baixarArquivo(ref);
    expect(Buffer.isBuffer(resultado)).toBe(true);
    expect(resultado).toEqual(bytes);
    expect(getBucket).toHaveBeenCalledWith(ref.bucket);
    expect(from).toHaveBeenCalledWith(ref.bucket);
    expect(download).toHaveBeenCalledWith(ref.path);
    expect(storageService.baixarArquivo).toBe(baixarArquivo);
  });

  it("mantém Buffer adequado para um PDF previamente armazenado", async () => {
    const pdf = Buffer.from("%PDF-1.7\nconteudo ficticio");
    download.mockResolvedValue({ data: new Blob([pdf]), error: null });
    expect(await baixarArquivo({ ...ref, path: "pdfs/teste.pdf" })).toEqual(pdf);
    expect(download).toHaveBeenCalledWith("pdfs/teste.pdf");
  });

  it.each([
    { data: null, error: { message: "segredo do provedor" } }, undefined,
    { data: null, error: null }, { data: {}, error: null },
  ])("sanitiza falha/retorno inválido de download (%#)", async (resposta) => {
    download.mockResolvedValue(resposta);
    const erro = await baixarArquivo(ref).catch((falha) => falha);
    expect(erro).toMatchObject({ name: "StorageError", codigo: "STORAGE_DOWNLOAD_FALHOU" });
    expect(erro.cause).toBeUndefined();
    expect(String(erro)).not.toContain("segredo");
  });

  it("sanitiza exceção de comunicação no download", async () => {
    download.mockRejectedValue(new Error("sb_secret_NAO_EXIBIR"));
    const erro = await baixarArquivo(ref).catch((falha) => falha);
    expect(erro.codigo).toBe("STORAGE_DOWNLOAD_FALHOU");
    expect(String(erro)).not.toContain("NAO_EXIBIR");
  });

  it.each([
    { status: 404 }, { status: 400, statusCode: "404" }, { status: 400, code: "NoSuchKey" },
  ])("separa arquivo inexistente de falha de rede (%#)", async (falha) => {
    download.mockResolvedValue({ data: null, error: { message: "Object not found", ...falha } });
    const erro = await baixarArquivo(ref).catch((e) => e);
    expect(erro).toMatchObject({ name: "StorageError", codigo: "STORAGE_ARQUIVO_NAO_ENCONTRADO" });
    expect(String(erro)).not.toContain("Object not found");
  });

  it.each([{ status: 500 }, { status: 400, statusCode: "500" }])(
    "mantém falha do provedor como falha de download (%#)", async (falha) => {
      download.mockResolvedValue({ data: null, error: { message: "x", ...falha } });
      await expect(baixarArquivo(ref)).rejects.toMatchObject({ codigo: "STORAGE_DOWNLOAD_FALHOU" });
    }
  );

  it("sanitiza falha ao consumir o corpo baixado", async () => {
    download.mockResolvedValue({ data: { arrayBuffer: vi.fn().mockRejectedValue(new Error("segredo")) }, error: null });
    await expect(baixarArquivo(ref)).rejects.toMatchObject({ codigo: "STORAGE_DOWNLOAD_FALHOU" });
  });
});

describe("URL assinada sob demanda", () => {
  it("retorna URL temporária do SDK com expiração padrão, sem logs", async () => {
    const log = vi.spyOn(console, "log"), warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
    const url = await gerarUrlAssinada(ref);
    expect(url).toBe((await createSignedUrl.mock.results[0].value).data.signedUrl);
    expect(createSignedUrl).toHaveBeenCalledWith(ref.path, 3600);
    expect(storageService.gerarUrlAssinada).toBe(gerarUrlAssinada);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([1, 60, 86400])("aceita expiração inteira de %s segundos", async (expiracao) => {
    await gerarUrlAssinada(ref, expiracao);
    expect(createSignedUrl).toHaveBeenCalledWith(ref.path, expiracao);
  });

  it.each([0, -1, 1.5, 86401, NaN, Infinity, "3600", null, {}, true])("rejeita expiração inválida (%#)", async (expiracao) => {
    await expect(gerarUrlAssinada(ref, expiracao)).rejects.toMatchObject({ name: "StorageError", codigo: "STORAGE_PARAMETRO_INVALIDO" });
    expect(getStorageContext).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    { error: { message: "token=NAO_EXIBIR" }, data: null }, undefined,
    { data: { signedUrl: "" }, error: null }, { data: { signedUrl: 42 }, error: null },
  ])("sanitiza falha/retorno inválido de URL (%#)", async (resposta) => {
    createSignedUrl.mockResolvedValue(resposta);
    const erro = await gerarUrlAssinada(ref).catch((falha) => falha);
    expect(erro).toMatchObject({ name: "StorageError", codigo: "STORAGE_URL_ASSINADA_FALHOU" });
    expect(erro.cause).toBeUndefined();
    expect(String(erro)).not.toContain("NAO_EXIBIR");
  });

  it("sanitiza exceção do SDK ao gerar URL", async () => {
    createSignedUrl.mockRejectedValue(new Error("https://secreto?token=NAO_EXIBIR"));
    const erro = await gerarUrlAssinada(ref).catch((falha) => falha);
    expect(erro.codigo).toBe("STORAGE_URL_ASSINADA_FALHOU");
    expect(String(erro)).not.toContain("NAO_EXIBIR");
  });
});

describe.each([
  ["download", baixarArquivo], ["URL assinada", gerarUrlAssinada], ["remoção", removerArquivo],
])("referência protegida em %s", (_nome, operacao) => {
  it.each([
    undefined, null, {}, { ...ref, bucket: "outro-bucket" },
    { ...ref, path: "../imagem.png" }, { ...ref, path: "/assinaturas/imagem.png" },
    { ...ref, path: "assinaturas/../imagem.png" }, { ...ref, path: "assinaturas\\imagem.png" },
    { ...ref, path: "assinaturas/%2e%2e/imagem.png" }, { ...ref, path: "imagem.jpg" },
    { ...ref, path: "imagem.png\n" }, { ...ref, path: "imagem.png\r" },
    { ...ref, path: "imagem.png\u2028" }, { ...ref, path: "imagem.png\u2029" },
    { ...ref, path: "imagem.png\u0000" }, { ...ref, path: "a".repeat(301) },
  ])("rejeita referência inválida sem operar no SDK (%#)", async (referencia) => {
    await expect(operacao(referencia)).rejects.toMatchObject({ name: "StorageError" });
    expect(from).not.toHaveBeenCalled();
    expect(getBucket).not.toHaveBeenCalled();
  });
});

describe("privacidade sem resultado obsoleto", () => {
  it.each([["download", baixarArquivo], ["URL", gerarUrlAssinada]])("bloqueia %s se o bucket estiver público", async (_nome, operacao) => {
    getBucket.mockResolvedValue({ data: { id: "documentos", public: true }, error: null });
    await expect(operacao(ref)).rejects.toMatchObject({ codigo: "STORAGE_BUCKET_NAO_PRIVADO" });
    expect(from).not.toHaveBeenCalled();
  });

  it("compartilha somente a consulta em andamento entre operações simultâneas", async () => {
    let resolver;
    getBucket.mockImplementation(() => new Promise((resolve) => { resolver = resolve; }));
    const primeiro = uploadArquivo(arquivo);
    const segundo = baixarArquivo(ref);
    const terceiro = gerarUrlAssinada(ref);
    expect(getBucket).toHaveBeenCalledTimes(1);
    resolver({ data: { id: "documentos", public: false }, error: null });
    await Promise.all([primeiro, segundo, terceiro]);
    getBucket.mockResolvedValue({ data: { id: "documentos", public: true }, error: null });
    await expect(uploadArquivo(arquivo)).rejects.toMatchObject({ codigo: "STORAGE_BUCKET_NAO_PRIVADO" });
    expect(getBucket).toHaveBeenCalledTimes(2);
  });

  it("compartilha falha concorrente e tenta nova consulta na operação seguinte", async () => {
    let rejeitar;
    getBucket.mockImplementation(() => new Promise((_resolve, reject) => { rejeitar = reject; }));
    const primeiro = uploadArquivo(arquivo), segundo = baixarArquivo(ref);
    const resultados = Promise.allSettled([primeiro, segundo]);
    rejeitar(new Error("erro sem exposição"));
    expect((await resultados).map((item) => item.reason.codigo)).toEqual(["STORAGE_BUCKET_INDISPONIVEL", "STORAGE_BUCKET_INDISPONIVEL"]);
    expect(from).not.toHaveBeenCalled();
    getBucket.mockResolvedValue({ data: { id: "documentos", public: false }, error: null });
    await uploadArquivo(arquivo);
    expect(getBucket).toHaveBeenCalledTimes(2);
  });

  it("isola consultas por cliente e bucket", async () => {
    const outroGetBucket = vi.fn().mockResolvedValue({ data: { id: "outro", public: false }, error: null });
    const outroClient = { storage: { from, getBucket: outroGetBucket } };
    const primeiro = uploadArquivo(arquivo);
    getStorageContext.mockReturnValue({ client: outroClient, bucket: "outro" });
    await Promise.all([primeiro, uploadArquivo(arquivo)]);
    expect(getBucket).toHaveBeenCalledWith("documentos");
    expect(outroGetBucket).toHaveBeenCalledWith("outro");
  });
});

describe("classificação HTTP pelo helper existente", () => {
  it("trata uso incorreto do Storage como falha interna 500", async () => {
    const erro = await uploadArquivo({}).catch((falha) => falha);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    vi.spyOn(console, "error").mockImplementation(() => {});
    tratarErro(res, erro, "Erro interno ao armazenar assinatura");
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Erro interno ao armazenar assinatura" });
  });

  it("mantém imagem inválida do usuário como 400", () => {
    let erro;
    try { validarImagemAssinatura("imagem inválida"); } catch (capturado) { erro = capturado; }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    tratarErro(res, erro, "Imagem inválida");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Imagem inválida", erros: [erro.message] });
  });
});

describe("âncora final JavaScript sem flag m", () => {
  it.each(["\n", "\r", "\r\n", "\u2028", "\u2029", "\u0000"])("rejeita terminador adicional %j tanto no padrão antigo quanto no simples", (fim) => {
    const antigo = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?![\s\S])/;
    const simples = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
    expect(antigo.test(`assinaturas${fim}`)).toBe(false);
    expect(simples.test(`assinaturas${fim}`)).toBe(false);
  });
});
