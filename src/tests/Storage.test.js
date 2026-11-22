import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStorageContext } from "../config/supabase.js";
import storageService, { removerArquivo, uploadArquivo } from "../services/storageService.js";

vi.mock("../config/supabase.js", () => ({ getStorageContext: vi.fn() }));

const upload = vi.fn();
const remove = vi.fn();
const from = vi.fn();
const getBucket = vi.fn();
const client = { storage: { from, getBucket } };
const arquivo = { conteudo: Buffer.from("bytes já validados pelo domínio"), contentType: "image/png", diretorio: "assinaturas" };
const referencia = { bucket: "documentos", path: "assinaturas/objeto.png" };

beforeEach(() => {
  vi.resetAllMocks();
  getStorageContext.mockReturnValue({ client, bucket: "documentos" });
  from.mockReturnValue({ upload, remove });
  getBucket.mockResolvedValue({ data: { id: "documentos", public: false }, error: null });
  upload.mockImplementation(async (path) => ({ data: { path }, error: null }));
  remove.mockResolvedValue({ data: [{ name: "objeto.png" }], error: null });
});

describe("upload reutilizável", () => {
  it("envia bytes ao bucket configurado e retorna referência estável sem sobrescrita", async () => {
    getStorageContext.mockReturnValue({ client, bucket: "arquivos" });
    getBucket.mockResolvedValue({ data: { id: "arquivos", public: false }, error: null });

    const resultado = await uploadArquivo(arquivo);

    expect(resultado).toEqual({ bucket: "arquivos", path: expect.stringMatching(/^assinaturas\/[0-9a-f-]{36}\.png$/) });
    expect(getBucket).toHaveBeenCalledWith("arquivos");
    expect(from).toHaveBeenCalledWith("arquivos");
    expect(upload).toHaveBeenCalledWith(resultado.path, arquivo.conteudo, { contentType: "image/png", upsert: false });
    expect(Object.keys(resultado).sort()).toEqual(["bucket", "path"]);
    expect(storageService.uploadArquivo).toBe(uploadArquivo);
  });

  it("organiza PDFs com extensão correspondente e aceita Uint8Array", async () => {
    const conteudo = new Uint8Array([37, 80, 68, 70]);
    const resultado = await uploadArquivo({ conteudo, contentType: "application/pdf", diretorio: "pdfs" });
    expect(resultado.path).toMatch(/^pdfs\/[0-9a-f-]{36}\.pdf$/);
    expect(upload).toHaveBeenCalledWith(resultado.path, conteudo, { contentType: "application/pdf", upsert: false });
  });

  it("gera UUIDs diferentes para uploads com o mesmo conteúdo", async () => {
    const primeiro = await uploadArquivo(arquivo);
    const segundo = await uploadArquivo(arquivo);
    expect(primeiro.path).not.toBe(segundo.path);
    expect(primeiro.path).toMatch(/\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/);
  });

  it.each([
    undefined, null, {}, { ...arquivo, conteudo: "base64" }, { ...arquivo, conteudo: Buffer.alloc(0) },
    { ...arquivo, conteudo: new ArrayBuffer(3) }, { ...arquivo, contentType: "image/jpeg" },
    { ...arquivo, contentType: "image/png; charset=utf-8" }, { ...arquivo, diretorio: "" },
    { ...arquivo, diretorio: "../assinaturas" }, { ...arquivo, diretorio: "/assinaturas" },
    { ...arquivo, diretorio: "assinaturas/../pdfs" }, { ...arquivo, diretorio: "assinaturas\\pdfs" },
    { ...arquivo, diretorio: "assinaturas/%2e%2e" }, { ...arquivo, diretorio: "assinaturas?token=segredo" },
    { ...arquivo, diretorio: "a".repeat(201) }, { ...arquivo, diretorio: "assinaturas\n" },
    { ...arquivo, diretorio: "assinaturas\r" }, { ...arquivo, diretorio: "assinaturas\u0000" },
  ])("rejeita parâmetros inválidos antes de acessar configuração ou SDK (%#)", async (entrada) => {
    await expect(uploadArquivo(entrada)).rejects.toMatchObject({ name: "StorageError", codigo: "STORAGE_PARAMETRO_INVALIDO" });
    expect(getStorageContext).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([true, undefined, null, "false"])("bloqueia bucket sem privacidade confirmada: %s", async (publico) => {
    getBucket.mockResolvedValue({ data: { id: "documentos", public: publico }, error: null });
    await expect(uploadArquivo(arquivo)).rejects.toMatchObject({ codigo: "STORAGE_BUCKET_NAO_PRIVADO" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("verifica privacidade novamente após mudança remota do bucket", async () => {
    await uploadArquivo(arquivo);
    getBucket.mockResolvedValue({ data: { id: "documentos", public: true }, error: null });
    await expect(uploadArquivo(arquivo)).rejects.toMatchObject({ codigo: "STORAGE_BUCKET_NAO_PRIVADO" });
    expect(getBucket).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: null, error: { message: "detalhe sensível" } }, undefined,
    { data: { id: "outro-bucket", public: false }, error: null },
  ])("bloqueia consulta de bucket sem sucesso (%#)", async (resposta) => {
    getBucket.mockResolvedValue(resposta);
    await expect(uploadArquivo(arquivo)).rejects.toMatchObject({ codigo: "STORAGE_BUCKET_INDISPONIVEL" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("sanitiza exceção inesperada na consulta do bucket", async () => {
    getBucket.mockRejectedValue(new Error("sb_secret_VALOR_SENSIVEL"));
    const erro = await uploadArquivo(arquivo).catch((falha) => falha);
    expect(erro).toMatchObject({ name: "StorageError", codigo: "STORAGE_BUCKET_INDISPONIVEL" });
    expect(erro.cause).toBeUndefined();
    expect(String(erro)).not.toContain("VALOR_SENSIVEL");
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: "sb_secret_VALOR_SENSIVEL" } }, undefined,
    { data: { path: "caminho-diferente.png" }, error: null },
  ])("trata retorno inválido de upload (%#)", async (resposta) => {
    upload.mockResolvedValue(resposta);
    const erro = await uploadArquivo(arquivo).catch((falha) => falha);
    expect(erro).toMatchObject({ name: "StorageError", codigo: "STORAGE_UPLOAD_FALHOU" });
    expect(erro.cause).toBeUndefined();
    expect(String(erro)).not.toContain("VALOR_SENSIVEL");
  });

  it("sanitiza exceção inesperada no upload", async () => {
    upload.mockRejectedValue(new Error("sb_secret_VALOR_SENSIVEL"));
    const erro = await uploadArquivo(arquivo).catch((falha) => falha);
    expect(erro.codigo).toBe("STORAGE_UPLOAD_FALHOU");
    expect(String(erro)).not.toContain("VALOR_SENSIVEL");
    expect(erro.cause).toBeUndefined();
  });

  it("propaga erro controlado de configuração sem tentar comunicar", async () => {
    const erro = Object.assign(new Error("configuração ausente"), { name: "StorageConfiguracaoError" });
    getStorageContext.mockImplementation(() => { throw erro; });
    await expect(uploadArquivo(arquivo)).rejects.toBe(erro);
    expect(getBucket).not.toHaveBeenCalled();
  });
});

describe("remoção exata para compensação", () => {
  it("remove apenas a referência solicitada sem consultar privacidade", async () => {
    await expect(removerArquivo(referencia)).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith("documentos");
    expect(remove).toHaveBeenCalledWith([referencia.path]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(getBucket).not.toHaveBeenCalled();
    expect(storageService.removerArquivo).toBe(removerArquivo);
  });

  it("aceita lista vazia de remoção para permitir nova tentativa de limpeza", async () => {
    remove.mockResolvedValue({ data: [], error: null });
    await expect(removerArquivo(referencia)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith([referencia.path]);
  });

  it.each([
    undefined, null, {}, { bucket: "outro", path: referencia.path },
    { ...referencia, path: "/assinaturas/objeto.png" }, { ...referencia, path: "assinaturas/../objeto.png" },
    { ...referencia, path: "assinaturas\\objeto.png" }, { ...referencia, path: "assinaturas/%2e%2e/objeto.png" },
    { ...referencia, path: "assinaturas/objeto.png?token=segredo" }, { ...referencia, path: "assinaturas/objeto.jpg" },
    { ...referencia, path: "assinaturas/" }, { ...referencia, path: [referencia.path] },
    { ...referencia, path: "assinaturas/objeto.png\n" }, { ...referencia, path: "assinaturas/objeto.png\r" },
  ])("rejeita referência inválida ou fora do bucket configurado (%#)", async (entrada) => {
    await expect(removerArquivo(entrada)).rejects.toMatchObject({ name: "StorageError" });
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([{ error: { message: "sb_secret_VALOR_SENSIVEL" }, data: null }, undefined, { data: null }])(
    "trata falha retornada na remoção (%#)", async (resposta) => {
      remove.mockResolvedValue(resposta);
      const erro = await removerArquivo(referencia).catch((falha) => falha);
      expect(erro).toMatchObject({ name: "StorageError", codigo: "STORAGE_REMOCAO_FALHOU" });
      expect(erro.cause).toBeUndefined();
      expect(String(erro)).not.toContain("VALOR_SENSIVEL");
    }
  );

  it("sanitiza exceção inesperada de remoção", async () => {
    remove.mockRejectedValue(new Error("sb_secret_VALOR_SENSIVEL"));
    const erro = await removerArquivo(referencia).catch((falha) => falha);
    expect(erro.codigo).toBe("STORAGE_REMOCAO_FALHOU");
    expect(String(erro)).not.toContain("VALOR_SENSIVEL");
    expect(erro.cause).toBeUndefined();
  });

  it("permite compensar upload quando persistência posterior falha", async () => {
    const salvar = vi.fn().mockRejectedValue(new Error("falha no banco"));
    const ref = await uploadArquivo(arquivo);
    try { await salvar(ref); } catch { await removerArquivo(ref); }
    expect(remove).toHaveBeenCalledWith([ref.path]);
  });
});
