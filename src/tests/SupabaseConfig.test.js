import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { getStorageContext } from "../config/supabase.js";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const cliente = { storage: {} };
const configurar = () => {
  vi.stubEnv("SUPABASE_URL", "https://projeto.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_apenas_para_teste");
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", "documentos");
};

beforeEach(() => {
  vi.resetAllMocks();
  configurar();
  createClient.mockReturnValue(cliente);
});

afterEach(() => vi.unstubAllEnvs());

describe("configuração do Supabase Storage", () => {
  it("não inicializa nem valida configuração durante o import", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "");
    vi.resetModules();

    await expect(import("../config/supabase.js")).resolves.toBeDefined();
    expect(createClient).not.toHaveBeenCalled();
    expect(() => getStorageContext()).toThrow();
  });

  it("utiliza o bucket configurado e desabilita sessão persistente", () => {
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "outro-bucket");
    expect(getStorageContext()).toEqual({ client: cliente, bucket: "outro-bucket" });
    expect(createClient).toHaveBeenCalledWith(
      "https://projeto.supabase.co",
      "sb_secret_apenas_para_teste",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );
  });

  it.each(["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_STORAGE_BUCKET"])(
    "rejeita ausência de %s sem criar cliente",
    (variavel) => {
      vi.stubEnv(variavel, "");
      expect(() => getStorageContext()).toThrow(
        expect.objectContaining({ name: "StorageConfiguracaoError", codigo: "STORAGE_CONFIGURACAO_INVALIDA" })
      );
      expect(createClient).not.toHaveBeenCalled();
    }
  );

  it.each([
    "endereco-invalido", "http://projeto.supabase.co", "https://usuario:senha@projeto.supabase.co",
    "https://projeto.supabase.co/storage/v1", "https://projeto.supabase.co?token=secreto",
    "https://projeto.supabase.co#segredo",
  ])("rejeita URL inválida ou com informação adicional: %s", (url) => {
    vi.stubEnv("SUPABASE_URL", url);
    expect(() => getStorageContext()).toThrow(expect.objectContaining({ name: "StorageConfiguracaoError" }));
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["sb_publishable_publica", "sb_secret_", "chave-arbitraria", "header.!!!!.signature"])(
    "rejeita credencial inválida ou pública: %s",
    (chave) => {
      vi.stubEnv("SUPABASE_SECRET_KEY", chave);
      expect(() => getStorageContext()).toThrow(expect.objectContaining({ name: "StorageConfiguracaoError" }));
      expect(createClient).not.toHaveBeenCalled();
    }
  );

  it.each(["anon", "authenticated"])("rejeita JWT com role %s", (role) => {
    const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
    vi.stubEnv("SUPABASE_SECRET_KEY", `header.${payload}.signature`);
    expect(() => getStorageContext()).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("aceita chave service_role legada sem tratá-la como JWT autenticado", () => {
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    const chave = `header.${payload}.signature`;
    vi.stubEnv("SUPABASE_SECRET_KEY", chave);
    expect(getStorageContext().client).toBe(cliente);
    expect(createClient.mock.calls[0][1]).toBe(chave);
  });

  it.each(["../documentos", "documentos/assinaturas", "documentos?token", " "])(
    "rejeita nome de bucket inválido: %s",
    (bucket) => {
      vi.stubEnv("SUPABASE_STORAGE_BUCKET", bucket);
      expect(() => getStorageContext()).toThrow();
      expect(createClient).not.toHaveBeenCalled();
    }
  );

  it("não propaga segredos de erros inesperados do SDK", () => {
    createClient.mockImplementation(() => { throw new Error("sb_secret_VALOR_SENSIVEL"); });
    let erro;
    try { getStorageContext(); } catch (capturado) { erro = capturado; }
    expect(erro).toMatchObject({ name: "StorageConfiguracaoError", codigo: "STORAGE_CONFIGURACAO_INVALIDA" });
    expect(String(erro)).not.toContain("VALOR_SENSIVEL");
    expect(erro.cause).toBeUndefined();
  });
});
